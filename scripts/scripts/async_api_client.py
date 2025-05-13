import asyncio
import io
import logging
import random
import zlib
from pathlib import Path

import httpx
import pandas as pd

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logging.getLogger("httpx").setLevel(logging.WARNING)


class APIClient:
    """A class to interact with a web API for classification tasks."""

    def __init__(self, username, password, base_url="http://localhost:8000/"):
        self.username = username
        self.password = password
        self.base_url = base_url
        self.login_url = f"{self.base_url}login"
        self.data_url = f"{self.base_url}get_data/"
        self.post_url = f"{self.base_url}post"
        self.client = httpx.AsyncClient()

    def classify_sync(self, n_classifications, login=False, speed=0.0):
        asyncio.run(
            self.classify(
                n_classifications=n_classifications,
                login=login,
                speed=speed,
            )
        )

    async def classify(self, n_classifications, login=False, speed=0.0):
        if login:
            await self.login()

        data_response = await self.fetch_data()

        for idx in range(n_classifications):
            logging.debug(f"{self.username} starts {idx + 1}/{n_classifications}")
            await asyncio.sleep(speed)

            # Example request data for posting
            request_data = {
                "certainty": 3,
                "file_id_user": int(data_response.headers.get("file_id", 1)),
                "time": [0.0],
                "view_index_user": int(data_response.headers.get("view_index", 1)),
            }

            data_response = await self.post_and_fetch_data(request_data)

    async def login(self):
        login_page = await self.client.get(self.login_url)  # Await the get method
        if not login_page.is_success:
            raise Exception(
                f"Failed to fetch login page: {login_page.status_code} {login_page.text}"
            )

        response = await self.client.post(
            self.login_url,
            json={
                "username": self.username,
                "password": self.password,
            },
            follow_redirects=True,
        )

        if not response.is_success or "Invalid username or password" in response.text:
            raise Exception(f"Login failed: {response.status_code} {response.text}")

        f"{self.username} logged in successfully!"

    async def fetch_data(self, token=None):
        if token:
            data_response = await self.client.get(
                f"{self.data_url}{token}", cookies=dict(self.client.cookies)
            )
        else:
            data_response = await self.client.get(
                self.data_url, cookies=dict(self.client.cookies)
            )

        if not data_response.is_success:
            raise Exception(
                f"Failed to fetch data: {data_response.status_code} {data_response.text}"
            )

        logging.info(
            f"{self.username} "
            f"successfully fetched file {data_response.headers.get('file_id', 1)} "
            + f"with view index {data_response.headers.get('view_index', 1)} "
            + ("with download token." if token else "without download token.")
        )
        return data_response

    async def post_data(self, request_data):
        response = await self.client.post(
            self.post_url, json=request_data, cookies=dict(self.client.cookies)
        )
        response.raise_for_status()
        response_data = response.json()
        return response_data

    async def post_and_fetch_data(self, request_data):
        response_data = await self.post_data(request_data)
        download_token = response_data.get("downloadToken")
        data_response = await self.fetch_data(download_token)
        return data_response

    @staticmethod
    def parse_data_response(data_response):
        decompressed_data = zlib.decompress(data_response.content)
        return pd.read_csv(io.BytesIO(decompressed_data))


def parse_args():
    import argparse

    parser = argparse.ArgumentParser(description="Classify images using the HTD API.")
    parser.add_argument(
        "--user_table_path",
        type=str,
        default=Path(__file__).parent / "output/users.csv",
        help="Path to the users table.",
    )
    parser.add_argument(
        "--base_url",
        type=str,
        default="http://localhost:8000/",
        help="Base URL of the API.",
    )
    parser.add_argument(
        "--speed",
        type=float,
        default=0.0,
        help="Speed of classification in seconds.",
    )
    parser.add_argument(
        "--randomize_speed",
        action="store_true",
        help="Randomize the classification speed.",
    )
    parser.add_argument(
        "--n_classifications",
        type=int,
        default=5,
        help="Number of classifications to perform.",
    )

    return parser.parse_args()


async def main(
    user_table_path,
    base_url,
    n_classifications,
    speed,
    randomize_speed,
):
    df = pd.read_csv(Path(user_table_path))

    tasks = []
    for _, row in df.iterrows():
        username = row["username"]
        password = row["password"]
        speed = row.get("speed", float(speed))

        if randomize_speed:
            speed *= random.uniform(0.5, 2)
            logging.info(
                f"{username}: classifies with a randomized speed of {speed:.2f} seconds."
            )

        client = APIClient(username, password, base_url=base_url)
        task = client.classify(
            n_classifications,
            login=True,
            speed=speed,
        )
        tasks.append(task)

    await asyncio.gather(*tasks)


if __name__ == "__main__":
    args = parse_args()
    asyncio.run(
        main(
            user_table_path=args.user_table_path,
            n_classifications=args.n_classifications,
            speed=args.speed,
            randomize_speed=args.randomize_speed,
            base_url=args.base_url,
        )
    )
