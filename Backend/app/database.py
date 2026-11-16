from pymongo import AsyncMongoClient

from app.config import get_database_name, get_mongodb_url
from app.seed_data import seed_database


async def connect_db():
    client = AsyncMongoClient(get_mongodb_url())
    try:
        await client.admin.command("ping")
        database = client[get_database_name()]
        await seed_database(database)
    except Exception:
        await client.close()
        raise
    return client, database
