import json
import logging
from pathlib import Path
from typing import List, Literal, Optional, Tuple

import mysql.connector
import pandas as pd
from sqlalchemy import Engine, create_engine

PROJECT_BASE = Path(__file__).parent.parent


class ConfigLoader:
    def __init__(
        self, mode: Literal["development", "test", "production"] = "development"
    ):
        self.mode = mode
        self._config = self._load_config()

    @property
    def config(self):
        return self._config[self.mode]

    def get(self, key: str, default=None):
        return self.config.get(key, default)

    def _load_config(self):
        config_path = PROJECT_BASE / "config" / "config.json"
        if not config_path.exists():
            raise FileNotFoundError(f"Config file not found: {config_path}")

        with open(config_path, "r") as file:
            config = json.load(file)

        return config

    def __getattr__(self, name):
        if name in self.config:
            return self.config[name]
        raise AttributeError(f"Config has no attribute '{name}'")

    def __repr__(self) -> str:
        return f"ConfigLoader(mode={self.mode}, config={self.config})"


class MySQLDatabase:
    """
    MySQLDatabase is a class for interacting with a MySQL database using SQLAlchemy.
    It provides methods to execute queries and return results in various formats.

    Attributes
    ----------
    database : str
        The name of the database.
    username : str
        The username for the database.
    password : str or None
        The password for the database.
    host : str
        The host address of the database.

    Methods
    -------
    query_to_dataframe(query: str) -> Optional[pd.DataFrame]
        Executes a query and returns the results as a DataFrame.

    query(query: str)
        Executes a query and returns the results as a list of tuples.

    Examples
    --------
    >>> db = MySQLDatabase(
    ...     database="myDatabse",
    ...     username="myUsername",
    ...     password="myPassword",
    ...     host="localhost"
    ... )
    >>> df = db.query_to_dataframe("SELECT * FROM myTable")
    >>> print(df)
    """

    def __init__(
        self,
        database: str,
        username: str,
        password: Optional[str] = None,
        host: str = "localhost",
        port: int = 3306,
    ):
        self.database = database
        self.username = username
        self.password = password
        self.host = host
        self.port = port
        self.engine = self._create_engine()

    def query_to_dataframe(self, query: str) -> Optional[pd.DataFrame]:
        """Executes a query and returns the results as a DataFrame."""
        try:
            try:
                results = pd.read_sql_query(query, self.engine, index_col="id")
            except KeyError:
                results = pd.read_sql_query(query, self.engine)
            return results
        except mysql.connector.Error as error:
            logging.error(f"Error querying MySQL database: {error}")

    def query(self, query: str):
        """Executes a query and returns the results as a list of tuples."""
        connection = None
        cursor = None
        try:
            # Connect to the database
            connection = mysql.connector.connect(
                user=self.username,
                password=self.password,
                database=self.database,
                host=self.host,
            )
            cursor = connection.cursor()
            cursor.execute(query)
            results = cursor.fetchall()

        except mysql.connector.Error as error:
            logging.error(f"Error querying MySQL database: {error}")
            results = None

        finally:
            self._close_cursor(cursor)
            self._close_connection

        return results

    def insert_record(
        self, table: str, record: Tuple, columns: Optional[List[str]] = None
    ):
        """Inserts a single record into a specified table with optional columns."""
        if not record:
            logging.warning("No record to insert.")
            return

        # Determine the number of columns from the record
        num_columns = len(record)

        # If columns are provided, ensure they match the number of record fields
        if columns:
            if len(columns) != num_columns:
                logging.error(
                    "Number of columns does not match number of record fields."
                )
                return
            column_names = ", ".join(columns)
        else:
            column_names = ""

        # Create the insert query
        placeholders = ", ".join(["%s"] * num_columns)
        insert_query = (
            f"INSERT INTO {table} "
            + (f"({column_names})" if column_names else "")
            + f" VALUES ({placeholders})"
        )

        connection = None
        cursor = None
        try:
            connection = mysql.connector.connect(
                user=self.username,
                password=self.password,
                database=self.database,
                host=self.host,
            )
            cursor = connection.cursor()
            cursor.execute(insert_query, record)
            connection.commit()
            logging.info(f"Inserted record into {table}.")
            success = True
        except mysql.connector.Error as error:
            logging.error(f"Error inserting record into {table}: {error}")
            success = False
        finally:
            self._close_cursor(cursor)
            self._close_connection(connection)

        return success

    def insert_records(
        self, table: str, records: List[Tuple], columns: Optional[List[str]] = None
    ):
        """Inserts multiple records into a specified table with optional columns."""
        if not records:
            logging.warning("No records to insert.")
            return

        # Determine the number of columns from the first record
        num_columns = len(records[0])

        # If columns are provided, ensure they match the number of records
        if columns:
            if len(columns) != num_columns:
                logging.error("Number of columns does not match number of records.")
                return
            column_names = ", ".join(columns)
        else:
            column_names = ""

        # Create the insert query
        placeholders = ", ".join(["%s"] * num_columns)
        insert_query = (
            f"INSERT INTO {table} "
            + (f"({column_names})" if column_names else "")
            + f"VALUES ({placeholders})"
        )

        connection = None
        cursor = None
        try:
            connection = mysql.connector.connect(
                user=self.username,
                password=self.password,
                database=self.database,
                host=self.host,
            )
            cursor = connection.cursor()
            cursor.executemany(insert_query, records)
            connection.commit()
            logging.info(f"Inserted {len(records)} records into {table}.")
        except mysql.connector.Error as error:
            logging.error(f"Error inserting records into {table}: {error}")
        finally:
            self._close_cursor(cursor)
            self._close_connection(connection)

    def fetch_user_ids(self) -> List[int]:
        """Fetches all user IDs from the users table."""
        results = self.query("SELECT id FROM users")
        # Sort numerically
        return sorted([row[0] for row in results]) if results else []

    def _create_engine(self) -> Engine:
        """Constructs the SQLAlchemy engine for MySQL."""
        url = self._create_url()
        return create_engine(url)

    def _create_url(self) -> str:
        """Constructs the SQLAlchemy URL for MySQL."""
        url = (
            f"mysql+mysqlconnector://{self.username}"
            + (f":{self.password}" if self.password else "")
            + f"@{self.host}:{self.port}/{self.database}"
        )
        return url

    def reset(self):
        """Resets the database by dropping and recreating all tables."""
        try:
            connection = mysql.connector.connect(
                user=self.username,
                password=self.password,
                database=self.database,
                host=self.host,
            )
            cursor = connection.cursor()

            # Disable foreign key checks to avoid constraint violations
            cursor.execute("SET FOREIGN_KEY_CHECKS=0")
            cursor.execute("SHOW TABLES")
            tables = [table[0] for table in cursor.fetchall()]
            for table in tables:
                cursor.execute(f"DROP TABLE IF EXISTS {table}")

            database_structure_path = (
                PROJECT_BASE / "migrations" / "database_structure.sql"
            )
            if not database_structure_path.exists():
                raise FileNotFoundError(
                    f"SQL file not found: {database_structure_path}"
                )

            with open(database_structure_path, "r") as file:
                sql_script = file.read()
                for result in cursor.execute(sql_script, multi=True):
                    pass  # Process each result to avoid "commands out of sync" error

            connection.commit()
            logging.info("Database reset and structure recreated.")
        except mysql.connector.Error as error:
            logging.error(f"Error resetting database: {error}")
        finally:
            self._close_cursor(cursor)
            self._close_connection(connection)

    @staticmethod
    def _close_cursor(cursor):
        """Closes a cursor."""
        if cursor:
            try:
                cursor.close()
            except Exception:
                print("Error closing cursor")

    @staticmethod
    def _close_connection(connection):
        """Closes a connection."""
        if connection:
            try:
                connection.close()
            except Exception:
                print("Error closing connection")

    @classmethod
    def from_config(
        cls, mode: Literal["development", "test", "production"] = "development"
    ) -> "MySQLDatabase":
        """Creates a MySQLDatabase instance using the configuration loader."""
        config_loader = ConfigLoader(mode=mode)
        if config_loader is None:
            raise ValueError("ConfigLoader instance is None")
        if not config_loader.config:
            raise ValueError("ConfigLoader config is empty")

        return cls(
            **{
                item: config_loader.get(item)
                for item in ["database", "username", "password", "host", "port"]
                if item in config_loader.config
            }
        )
