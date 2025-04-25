import logging
import re
import secrets
import string
from pathlib import Path
from typing import Optional

import bcrypt
import pandas as pd
from mysql_database import MySQLDatabase

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)


def check_for_existing_users(db: MySQLDatabase):
    current_user_table = db.query_to_dataframe("SELECT * FROM users")
    if current_user_table is None:
        raise ValueError("Error loading the users table.")
    elif current_user_table.shape[0] > 0:
        logging.warning(f"Warning: The users table is not empty: {current_user_table}.")


def generate_users(
    db: MySQLDatabase,
    num_useres: int,
    password_length: int = 5,
) -> pd.DataFrame:
    """Generate num_useres users with usernames and passwords of length password_length."""
    check_for_existing_users(db)

    users = []
    encrypted_users = []
    for i in range(1, num_useres + 1):
        username = f"user{i}"
        password = "".join(
            secrets.choice(string.ascii_letters + string.digits)
            for _ in range(password_length)
        )
        users.append((username, password))
        encrypted_users.append(
            (username, bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=10)))
        )

    users = pd.DataFrame(
        users, columns=["username", "password"], index=range(1, len(users) + 1)
    ).rename_axis("id")

    db.insert_records("users", encrypted_users, columns=["username", "password"])
    return users


class UserHandoutGenerator:
    def __init__(
        self, users: pd.DataFrame, width=40, output_dir: Optional[Path] = None
    ):
        self.users = users
        self.width = width
        self.handouts = self.generate_handouts()
        self.output_dir = Path.cwd() if output_dir is None else output_dir
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def generate_handouts(self) -> dict:
        """Generates handouts for each user."""
        handouts = {}
        for _, user_info in self.users.iterrows():
            filename = f"{user_info['username']}.txt"
            message = (
                "=" * self.width
                + "\n"
                + "User Information".center(self.width)
                + "\n"
                + "=" * self.width
                + "\n"
                + f"Username: {user_info['username']}".center(self.width)
                + "\n"
                + f"Password: {user_info['password']}".center(self.width)
                + "\n"
                + "=" * self.width
                + "\n"
            )
            handouts[filename] = message

        return handouts

    def save_handouts_as_rtf(self, font_size=24, bold=True):
        """Converts handouts to RTF format and saves them to files."""
        for filename, message in self.handouts.items():
            rtf_filename = filename.replace(".txt", ".rtf")
            rtf_content = (
                self._generate_rtf_header(font_size)
                + self._apply_bold(self._format_message(message), bold)
                + "\\par}"
            )

            # Save the RTF file
            with open(self.output_dir / rtf_filename, "w") as file:
                file.write(rtf_content)

    def save_handouts_in_combined_rtf(
        self,
        font_size=24,
        bold=True,
        rtf_filename="combined_handouts.rtf",
    ):
        """Converts handouts to RTF format and saves them to a single file."""
        output_path = self.output_dir / rtf_filename
        rtf_content = self._generate_rtf_header(font_size)

        # Prepare the content for the RTF file
        content = []
        separator = "\\line" + "-" * self.width + "\\line" + "\\line" + "\n"

        for i, (_, message) in enumerate(self.handouts.items()):
            content.append(self._format_message(message))

            # Add a separator between handouts
            if (i + 1) % 4 == 0:
                content.append("\\line" + "\\line" + "\\line")
                content.append("\\page" + "\n")
            else:
                content.append(separator)

        # Join the content with the separator
        rtf_content += self._apply_bold("\n".join(content), bold) + "\\par}"

        # Save the RTF file
        with open(output_path, "w") as file:
            file.write(rtf_content)

    def _generate_rtf_header(self, font_size: int) -> str:
        """Generates the RTF header."""
        return (
            "{\\rtf1\\ansi\\ansicpg1252\\deff0\\nouicompat\\deflang1033"
            "{\\fonttbl{\\f0\\fnil\\fcharset0 Courier New;}}"
            "{\\*\\generator Riched20 10.0.18362;}\\viewkind4\\uc1 "
            f"\\pard\\f0\\fs{font_size * 2} "
        )

    def _apply_bold(self, content: str, bold: bool) -> str:
        """Applies bold formatting to the content if specified."""
        return f"\\b {content}\\b0" if bold else content

    def _format_message(self, message: str) -> str:
        """Formats the message for RTF by replacing newlines."""
        return re.sub(r"\n", r"\\line\\n", message)

    @classmethod
    def populate_users(
        cls, db: MySQLDatabase, num_useres: int, password_length: int = 5, **kwargs
    ) -> "UserHandoutGenerator":
        """Populates the users DataFrame from the database."""
        users = generate_users(
            db, num_useres=num_useres, password_length=password_length
        )
        return cls(users=users, **kwargs)


def parse_args():
    import argparse

    parser = argparse.ArgumentParser(description="Generate users and user handouts.")
    parser.add_argument(
        "--num_users", type=int, default=10, help="Number of users to generate."
    )
    parser.add_argument(
        "--password_length",
        type=int,
        default=5,
        help="Length of the generated passwords.",
    )
    parser.add_argument(
        "--output_dir",
        type=str,
        default=Path(__file__).parent / "output",
        help="Directory to save handouts.",
    )
    parser.add_argument(
        "--mode",
        type=str,
        default="development",
        help="Config mode (development/production).",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    db = MySQLDatabase.from_config(mode=args.mode)
    logging.info(
        f"Generating {args.num_users} users with password length {args.password_length}."
    )
    users = generate_users(
        db=db, num_useres=args.num_users, password_length=args.password_length
    )
    user_handout_generator = UserHandoutGenerator(
        users=users,
        output_dir=Path(args.output_dir),
    )
    user_handout_generator.save_handouts_in_combined_rtf()
    # users to json
    users.to_csv(
        Path(args.output_dir) / "users.csv",
        index=False,
    )
