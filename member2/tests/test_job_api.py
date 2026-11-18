from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from member2.app.job_config import JobManagementConfig, StoreScraperBinding
from member2.app.job_repository import InMemoryJobRepository
from member2.app.main import create_app


def make_client():
    binding = StoreScraperBinding(
        store_id="store-1",
        store_name="Configured Store",
        website_url="https://store.example",
        source_identity="DummyJSON",
        keyword="phone",
    )
    config = JobManagementConfig(
        store_bindings={"store-1": binding},
        source_to_store={"DummyJSON": "store-1"},
        worker_enabled=False,
    )
    app = create_app(InMemoryJobRepository(), config)
    return TestClient(app)


def test_job_api_implements_frontend_actions_and_job_shapes():
    client = make_client()
    response = client.post(
        "/jobs",
        json={
            "store_id": "store-1",
            "interval_minutes": 60,
            "scheduled_at": (
                datetime.now(timezone.utc) + timedelta(hours=1)
            ).isoformat(),
            "request_timeout_seconds": 30,
            "retry_attempts": 2,
        },
    )

    assert response.status_code == 201
    job = response.json()
    assert job["status"] == "queued"
    assert job["store_name"] == "Configured Store"
    assert job["executions"] == []

    assert client.get("/jobs").json()[0]["id"] == job["id"]
    assert client.get(f"/jobs/{job['id']}").status_code == 200
    assert client.get(f"/jobs/{job['id']}/executions").json() == []

    paused = client.post(f"/jobs/{job['id']}/pause")
    assert paused.status_code == 200
    assert paused.json()["status"] == "paused"
    assert client.post(f"/jobs/{job['id']}/start").status_code == 409

    resumed = client.post(f"/jobs/{job['id']}/resume")
    assert resumed.status_code == 200
    assert resumed.json()["status"] == "queued"

    cancelled = client.post(f"/jobs/{job['id']}/cancel")
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"


def test_job_api_rejects_unconfigured_stores_and_unknown_jobs():
    client = make_client()
    assert client.get("/").status_code == 200
    assert client.get("/health").json()["status"] == "healthy"

    response = client.post(
        "/jobs",
        json={
            "store_id": "not-configured",
            "interval_minutes": 60,
            "scheduled_at": (
                datetime.now(timezone.utc) + timedelta(hours=1)
            ).isoformat(),
            "request_timeout_seconds": 30,
            "retry_attempts": 2,
        },
    )

    assert response.status_code == 422
    assert client.get("/jobs/unknown").status_code == 404
    assert client.post("/jobs/unknown/start").status_code == 404
