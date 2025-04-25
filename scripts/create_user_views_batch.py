import logging

import numpy as np
import pandas as pd
from create_user_views import count_files, insert_dataframe_into_database
from mysql_database import MySQLDatabase


def batch_generator(
    n_images, n_batches=2, rng: np.random.RandomState = np.random.RandomState(42)
):
    file_ids = np.arange(1, n_images + 1)
    rng.shuffle(file_ids)
    batches = np.array_split(file_ids, n_batches)

    batch_df = pd.DataFrame(
        {
            "batch_id": np.repeat(
                np.arange(n_batches), [len(batch) for batch in batches]
            ),
            "file_id": np.concatenate(batches),
        }
    )
    return batch_df


def create_batch_view_mapping_with_and_without_transits(
    n_images, n_batches=2, delay=10
):
    df = batch_generator(n_images=n_images, n_batches=n_batches)
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

    combined_df["view_order"] = combined_df.groupby("batch_id").cumcount() + 1

    combined_df.sort_values(by=["batch_id", "view_order"], inplace=True)

    return combined_df.reset_index(drop=True)


def assign_batches_to_users(
    db: MySQLDatabase,
    n_images: int,
    n_batches: int = 2,
    delay: int = 10,
    batches_per_users: int = 2,
):
    batch_df = create_batch_view_mapping_with_and_without_transits(
        n_images, n_batches=n_batches, delay=delay
    )
    user_ids = db.fetch_user_ids()

    user_view_df = pd.DataFrame(columns=["user_id", "batch_id", "file_id"])
    batch_ids = batch_df["batch_id"].unique()

    index = 0
    for user_index in range(len(user_ids)):
        for _ in range(batches_per_users):
            user_batch_ids = batch_ids[index % n_batches]
            index += 1

            # Get the file IDs for the current user
            user_file_ids = batch_df[batch_df["batch_id"] == user_batch_ids][
                "file_id"
            ].values

            user_view_df = pd.concat(
                [
                    user_view_df,
                    pd.DataFrame(
                        {
                            "user_id": user_ids[user_index],
                            "batch_id": user_batch_ids,
                            "file_id": user_file_ids,
                        }
                    ),
                ],
                ignore_index=True,
            )

    user_view_df["view_order"] = user_view_df.groupby("user_id").cumcount() + 1

    return user_view_df


def insert_user_image_views(
    db: MySQLDatabase,
    n_images: int,
    n_batches: int = 2,
    delay: int = 10,
    batches_per_users: int = 2,
):
    records = assign_batches_to_users(
        db=db,
        n_images=n_images,
        n_batches=n_batches,
        delay=delay,
        batches_per_users=batches_per_users,
    )
    insert_dataframe_into_database(db, records)


def parse_args():
    """Parse command line arguments.
    Example
    -------
    >>> python create_user_views_batch.py --n_batches 10 --delay 3
    """
    import argparse

    parser = argparse.ArgumentParser(
        description="Create user image views for classification tasks."
    )
    parser.add_argument(
        "--delay", type=int, default=5, help="Delay for transit images."
    )
    parser.add_argument(
        "--n_images", type=int, default=count_files(), help="Number of images."
    )
    parser.add_argument("--n_batches", type=int, default=5, help="Number of batches.")
    parser.add_argument(
        "--batches_per_users",
        type=int,
        default=2,
        help="Number of batches per user.",
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
        db,
        n_images=args.n_images,
        n_batches=args.n_batches,
        delay=args.delay,
        batches_per_users=args.batches_per_users,
    )
