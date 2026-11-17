import httpx

from app.config import get_apify_api_token, get_apify_actor_id


APIFY_API_BASE_URL = "https://api.apify.com/v2"


async def start_apify_actor(actor_input: dict) -> dict:
    """
    Start an Apify Actor run using the configured Actor ID.
    """

    api_token = get_apify_api_token()
    actor_id = get_apify_actor_id()

    if not api_token:
        raise ValueError("APIFY_API_TOKEN is not configured.")

    if not actor_id:
        raise ValueError("APIFY_ACTOR_ID is not configured.")

    url = (
        f"{APIFY_API_BASE_URL}/acts/"
        f"{actor_id.replace('/', '~')}/runs"
    )

    headers = {
        "Authorization": f"Bearer {api_token}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            url,
            json=actor_input,
            headers=headers,
        )

        response.raise_for_status()

        result = response.json()

    return result["data"]


async def get_apify_run(run_id: str) -> dict:
    """
    Retrieve the status and details of an Apify Actor run.
    """

    api_token = get_apify_api_token()

    if not api_token:
        raise ValueError("APIFY_API_TOKEN is not configured.")

    url = f"{APIFY_API_BASE_URL}/actor-runs/{run_id}"

    headers = {
        "Authorization": f"Bearer {api_token}",
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.get(
            url,
            headers=headers,
        )

        response.raise_for_status()

        result = response.json()

    return result["data"]


async def get_apify_dataset_items(dataset_id: str) -> list:
    """
    Retrieve product items from an Apify Dataset.
    """

    api_token = get_apify_api_token()

    if not api_token:
        raise ValueError("APIFY_API_TOKEN is not configured.")

    url = f"{APIFY_API_BASE_URL}/datasets/{dataset_id}/items"

    headers = {
        "Authorization": f"Bearer {api_token}",
    }

    params = {
        "clean": "true",
        "format": "json",
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.get(
            url,
            headers=headers,
            params=params,
        )

        response.raise_for_status()

        return response.json()