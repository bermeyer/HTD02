import logging
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
from mysql_database import MySQLDatabase

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)


def count_files() -> int:
    data_dir = Path(__file__).parent.parent.parent / "data"
    return len(list(data_dir.glob("file*.zlib"))) // 2


def create_user_view_mapping(
    db: MySQLDatabase,
    n_images: int,
    n_views: int,
    shuffle_images=True,
    rng: np.random.RandomState = np.random.RandomState(42),
) -> pd.DataFrame:
    """
    Generate a DataFrame mapping user IDs to image IDs for classification tasks,
    ensuring that each image is viewed by a specific number of different users.
    """
    user_ids = db.fetch_user_ids()
    if n_views > len(user_ids):
        raise ValueError("n_views must be less than or equal to the number of users")

    file_ids = np.arange(0, n_images )
    # if shuffle_images:
    #     rng.shuffle(file_ids)
    total_assignments = n_images * n_views
    user_cycle = np.tile(user_ids, total_assignments // len(user_ids) + 1)[
        :total_assignments
    ]
    # logging.info(f"nr of views for image 1: {np.count_nonzero(user_cycle == 1)}")
    # logging.info(f"nr of views for image 10: {np.count_nonzero(user_cycle == 10)}")

    assignments = np.column_stack(
        [
            user_cycle,  # Users are evenly distributed
            np.repeat(file_ids, n_views),  # Repeat image IDs accordingly
        ]
    )
    # logging.info(f"nr of views for image 1 before shuffle: {np.count_nonzero(assignments == 1)}")
    # logging.info(f"nr of views for image 10 before shuffle: {np.count_nonzero(assignments == 10)}")

    if shuffle_images:
        rng.shuffle(assignments)
    logging.info(f"nr of views for image 1 after shuffle: {np.count_nonzero(assignments == 1)}")
    logging.info(f"nr of views for image 10 after shuffle: {np.count_nonzero(assignments == 10)}")
    df = pd.DataFrame(assignments, columns=["user_id", "file_id"])
    df["view_order"] = df.groupby("user_id").cumcount() + 1

    return df


def create_user_view_mapping_with_and_without_transits(
    db: MySQLDatabase,
    n_images: int,
    n_views: int,
    shuffle_images=True,
    rng: np.random.RandomState = np.random.RandomState(42),
    delay: int = 10,
) -> pd.DataFrame:
    """
    Generate a DataFrame mapping user IDs to image IDs for classification tasks,
    ensuring that each image is viewed by a specific number of different users,
    and that each participant who sees image i also sees image n_images + i
    with a delay of 20 images.

    The effective median delay distance is 2 * delay - 1. That is for a delay of 10,
    the distance between the two images is 19, except for some of the first and last images.
    """
    df = create_user_view_mapping(db, n_images, n_views, shuffle_images, rng).drop(
        columns=["view_order"]
    )

    transit_df = df.copy()
    transit_df["file_id"] += n_images


    transit_df = transit_df.reindex(index=np.roll(df.index, -delay))

    mask = np.random.rand(len(df)) < 0.5
    df.iloc[mask], transit_df.iloc[mask] = (
        transit_df.iloc[mask].copy(),
        df.iloc[mask].copy(),
    )

    combined_df = pd.concat([df, transit_df], ignore_index=True)
    combined_df.iloc[0::2, :] = df
    combined_df.iloc[1::2, :] = transit_df

    combined_df["view_order"] = combined_df.groupby("user_id").cumcount() + 1
    for user in combined_df["user_id"].unique():
    

        indices = combined_df.loc[combined_df["user_id"] == user].iloc[1::2].index  # Get the index of every second row
        combined_df.loc[indices, 'view_order'] = np.roll(combined_df.loc[indices, 'view_order'].values, -delay)
        indices2 = combined_df.loc[combined_df["user_id"] == user].iloc[::2].index  # Get the index of every second row
        combined_df.loc[indices2, 'view_order'] = np.roll(combined_df.loc[indices2, 'view_order'].values, delay)
        indices3 = combined_df.loc[combined_df["user_id"] == user].iloc[::3].index  # Get the index of every third row
        combined_df.loc[indices3, 'view_order'] = np.roll(combined_df.loc[indices3, 'view_order'].values, delay*3)
        indices4 = combined_df.loc[combined_df["user_id"] == user].iloc[1::3].index  # Get the index of every third row
        combined_df.loc[indices4, 'view_order'] = np.roll(combined_df.loc[indices4, 'view_order'].values, -delay*3)


    return combined_df


def insert_dataframe_into_database(db: MySQLDatabase, records):
    records = [tuple(row) for row in records.to_numpy().astype(int).tolist()]
    db.insert_records(
        "UserViews", records, columns=["user_id", "file_id", "view_order"]
    )


def insert_user_image_views(
    db: MySQLDatabase, n_images: int, n_views: int, delay: Optional[int] = None
):
    if delay is not None:
        records = create_user_view_mapping_with_and_without_transits(
            db, n_images, n_views, delay=delay
        )
    else:
        records = create_user_view_mapping(db, n_images, n_views)

    insert_dataframe_into_database(db, records)


def parse_args():
    """Parse command line arguments.
    Example
    -------
    >>> python create_user_views.py --n_views 10 --delay 3 --n_images 20 --mode production
    """
    import argparse

    parser = argparse.ArgumentParser(
        description="Create user image views for classification tasks."
    )
    parser.add_argument(
        "--n_views", type=int, default=5, help="Number of views per image."
    )
    parser.add_argument(
        "--delay", type=int, default=5, help="Delay for transit images."
    )
    parser.add_argument(
        "--n_images", type=int, default=count_files(), help="Number of images."
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
    logging.info(
        f"Creating user image views with {args.n_images} images, {args.n_views} views per image, "
        f"and a delay of {args.delay}."
    )
    db = MySQLDatabase.from_config(mode=args.mode)
    insert_user_image_views(
        db, n_images=args.n_images, n_views=args.n_views, delay=args.delay
    )
