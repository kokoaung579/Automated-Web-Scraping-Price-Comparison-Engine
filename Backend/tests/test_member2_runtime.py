import asyncio
import ssl
import threading
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from truststore import extract_from_ssl as original_extract_from_ssl

from app import main, member2_runtime
from member2.app.job_config import JobManagementConfig
from member2.app.job_models import CreateScrapingJobInput
from member2.app.job_repository import InMemoryJobRepository
from member2.app.job_service import ScrapingJobService
from member2.app.routers.jobs import get_job_service
from member2.app.job_worker import ScrapingJobWorker


class FakeCollection:
    def __init__(self, name, client):
        self.name = name
        self.client = client
        self.indexes = []

    def create_index(self, keys):
        self.client.index_threads.append(threading.get_ident())
        if self.client.fail_index:
            raise RuntimeError("index creation failed")
        self.indexes.append(keys)


class FakeDatabase:
    def __init__(self, client):
        self.client = client
        self.collections = {}

    def __getitem__(self, name):
        if name not in self.collections:
            self.collections[name] = FakeCollection(name, self.client)
        return self.collections[name]


class FakeAdmin:
    def __init__(self, client):
        self.client = client
        self.commands = []

    def command(self, name):
        self.commands.append(name)
        if name == "hello":
            return self.client.topology
        return {"ok": 1}


class FakeMongoClient:
    instances = []
    topology = {"setName": "test-rs"}
    fail_index = False

    def __init__(self, uri):
        self.uri = uri
        self.topology = type(self).topology
        self.fail_index = type(self).fail_index
        self.admin = FakeAdmin(self)
        self.database = FakeDatabase(self)
        self.database_name = None
        self.closed = False
        self.init_thread = threading.get_ident()
        self.index_threads = []
        self.close_thread = None
        type(self).instances.append(self)

    def __getitem__(self, name):
        self.database_name = name
        return self.database

    def close(self):
        self.closed = True
        self.close_thread = threading.get_ident()


def reset_fake_client():
    FakeMongoClient.instances = []
    FakeMongoClient.topology = {"setName": "test-rs"}
    FakeMongoClient.fail_index = False


class FakeStoresCollection:
    def __init__(self, documents):
        self.documents = documents

    async def find_one(self, query):
        return self.documents.get(query["_id"])


class UnexpectedStoresCollection:
    async def find_one(self, query):
        pytest.fail(f"Unexpected store lookup: {query!r}")


def test_runtime_injects_sync_database_initializes_indexes_and_builds_service(
    monkeypatch,
):
    reset_fake_client()
    monkeypatch.setattr(member2_runtime, "MongoClient", FakeMongoClient)
    config = JobManagementConfig(poll_interval_seconds=0.25)

    runtime = member2_runtime._build_member2_runtime(
        "mongodb://test-host:27017",
        "Member2_jobs_test",
        config,
    )

    client = FakeMongoClient.instances[0]
    assert client.uri == "mongodb://test-host:27017"
    assert client.admin.commands == ["ping", "hello"]
    assert client.database_name == "Member2_jobs_test"
    assert runtime.repository._database is client.database
    assert sum(
        len(collection.indexes)
        for collection in client.database.collections.values()
    ) == 5
    assert runtime.service.config is config
    assert runtime.service.repository is runtime.repository
    assert runtime.worker.service is runtime.service
    assert runtime.worker.poll_interval_seconds == (
        runtime.service.config.poll_interval_seconds
    )
    assert client.closed is False


def test_runtime_rejects_standalone_mongodb_and_closes_client(monkeypatch):
    reset_fake_client()
    FakeMongoClient.topology = {"isWritablePrimary": True}
    monkeypatch.setattr(member2_runtime, "MongoClient", FakeMongoClient)

    with pytest.raises(RuntimeError, match="replica set or sharded deployment"):
        member2_runtime._build_member2_runtime(
            "mongodb://test-host:27017",
            "Member2_jobs_test",
        )

    assert FakeMongoClient.instances[0].closed is True


def test_transaction_topology_accepts_sharded_deployments():
    member2_runtime._require_transaction_capable_topology(
        {"msg": "isdbgrid"}
    )


def test_runtime_closes_client_when_index_initialization_fails(monkeypatch):
    reset_fake_client()
    FakeMongoClient.fail_index = True
    monkeypatch.setattr(member2_runtime, "MongoClient", FakeMongoClient)

    with pytest.raises(RuntimeError, match="index creation failed"):
        member2_runtime._build_member2_runtime(
            "mongodb://test-host:27017",
            "Member2_jobs_test",
        )

    assert FakeMongoClient.instances[0].closed is True


def test_runtime_initialization_is_off_loop_and_shutdown_awaits_worker(
    monkeypatch,
):
    reset_fake_client()
    monkeypatch.setattr(member2_runtime, "MongoClient", FakeMongoClient)
    events = []

    class RecordingWorker:
        def __init__(self, service, *, poll_interval_seconds):
            self.service = service
            self.poll_interval_seconds = poll_interval_seconds
            self.started = threading.Event()
            self.stop_requested = threading.Event()

        async def run(self):
            self.started.set()
            await asyncio.to_thread(self.stop_requested.wait)
            events.append("worker_finished")

        def stop(self):
            events.append("worker_stopped")
            self.stop_requested.set()

    monkeypatch.setattr(member2_runtime, "ScrapingJobWorker", RecordingWorker)

    async def scenario():
        event_loop_thread = threading.get_ident()
        runtime = await member2_runtime.start_member2_runtime(
            "mongodb://test-host:27017",
            "Member2_jobs_test",
        )
        client = FakeMongoClient.instances[0]
        assert await asyncio.to_thread(runtime.worker.started.wait, 1)
        await member2_runtime.stop_member2_runtime(runtime)
        assert client.init_thread != event_loop_thread
        assert client.index_threads
        assert all(
            thread_id != event_loop_thread
            for thread_id in client.index_threads
        )
        assert client.close_thread != event_loop_thread
        assert events == ["worker_stopped", "worker_finished"]
        assert client.closed is True

    asyncio.run(scenario())


def test_worker_offloads_synchronous_service_calls():
    class SyncService:
        config = SimpleNamespace(heartbeat_interval_seconds=0.01)

        def __init__(self):
            self.thread_ids = []
            self.claim_called = threading.Event()

        def recover_expired_jobs(self, **kwargs):
            self.thread_ids.append(threading.get_ident())

        def reconcile_terminal_jobs(self):
            self.thread_ids.append(threading.get_ident())

        def claim_next_job(self, *, worker_id):
            self.thread_ids.append(threading.get_ident())
            self.claim_called.set()
            return None

    service = SyncService()

    async def scenario():
        event_loop_thread = threading.get_ident()
        worker = ScrapingJobWorker(service, poll_interval_seconds=0.01)
        worker_task = asyncio.create_task(worker.run())
        assert await asyncio.to_thread(service.claim_called.wait, 1)
        worker.stop()
        await asyncio.wait_for(worker_task, timeout=1)
        assert service.thread_ids
        assert all(
            thread_id != event_loop_thread
            for thread_id in service.thread_ids
        )

    asyncio.run(scenario())


def test_member2_jobs_router_is_mounted_under_admin_api_with_admin_access():
    assert "/api/admin/jobs" in main.app.openapi()["paths"]

    main.app.state.database = object()
    client = TestClient(main.app)
    try:
        response = client.get("/api/admin/jobs")
    finally:
        client.close()
        del main.app.state.database

    assert response.status_code == 401
    assert response.json()["detail"] == "Sign in to continue."


def test_jobs_router_resolves_the_backend_service_state():
    service = object()
    request = SimpleNamespace(
        app=SimpleNamespace(
            state=SimpleNamespace(scraping_job_service=service),
        ),
    )

    assert get_job_service(request) is service


def test_jobs_router_reports_missing_backend_service():
    request = SimpleNamespace(
        app=SimpleNamespace(state=SimpleNamespace()),
    )

    with pytest.raises(HTTPException) as error:
        get_job_service(request)

    assert error.value.status_code == 503


def test_jobs_api_returns_configuration_error_without_a_store_mapping():
    repository = InMemoryJobRepository()
    main.app.state.database = object()
    main.app.state.scraping_job_service = ScrapingJobService(
        repository,
        JobManagementConfig(),
    )
    main.app.dependency_overrides[main.require_admin] = lambda: {"role": "Admin"}
    client = TestClient(main.app)
    try:
        response = client.post(
            "/api/admin/jobs",
            json={
                "store_id": "unmapped-test-store",
                "interval_minutes": 60,
                "scheduled_at": "2099-01-01T00:00:00Z",
                "request_timeout_seconds": 30,
                "retry_attempts": 1,
            },
        )
    finally:
        client.close()
        main.app.dependency_overrides.pop(main.require_admin, None)
        del main.app.state.database
        del main.app.state.scraping_job_service

    assert response.status_code == 422
    assert "No scraper configuration is registered" in response.json()["detail"]
    assert repository.list_jobs() == []


def test_missing_local_member2_mappings_leave_job_config_empty(monkeypatch):
    monkeypatch.delenv("MEMBER2_STORE_SCRAPER_MAPPINGS", raising=False)
    database = SimpleNamespace(stores=UnexpectedStoresCollection())

    async def build_config():
        return await member2_runtime.build_member2_job_config(database)

    config = asyncio.run(build_config())

    assert config.store_bindings == {}
    assert config.source_to_store == {}


def test_explicit_member2_config_enables_job_creation(monkeypatch):
    monkeypatch.setenv(
        "MEMBER2_STORE_SCRAPER_MAPPINGS",
        '{"test-store":{"source_identity":"DummyJSON","keyword":"test query"}}',
    )
    database = SimpleNamespace(
        stores=FakeStoresCollection({
            "test-store": {
                "_id": "test-store",
                "store_name": "Test Store",
                "website_url": "https://example.test",
                "status": "Active",
            },
        }),
    )

    async def build_config():
        return await member2_runtime.build_member2_job_config(database)

    config = asyncio.run(build_config())
    binding = config.store_bindings["test-store"]
    assert binding.keyword == "test query"
    assert config.source_to_store == {"DummyJSON": "test-store"}
    service = ScrapingJobService(InMemoryJobRepository(), config)

    job = service.create_job(
        CreateScrapingJobInput(
            store_id=binding.store_id,
            interval_minutes=60,
            scheduled_at="2099-01-01T00:00:00Z",
            request_timeout_seconds=30,
            retry_attempts=1,
        )
    )

    assert job.store_id == binding.store_id
    assert job.store_name == binding.store_name
    assert job.website_url == binding.website_url


def test_member2_config_rejects_unregistered_source(monkeypatch):
    monkeypatch.setenv(
        "MEMBER2_STORE_SCRAPER_MAPPINGS",
        '{"test-store":{"source_identity":"UnregisteredSource"}}',
    )
    database = SimpleNamespace(
        stores=FakeStoresCollection({
            "test-store": {
                "_id": "test-store",
                "store_name": "Test Store",
                "website_url": "https://example.test",
                "status": "Active",
            },
        }),
    )

    async def build_config():
        return await member2_runtime.build_member2_job_config(database)

    with pytest.raises(RuntimeError, match="No product scraper is registered"):
        asyncio.run(build_config())


def test_main_lifespan_stops_member2_before_closing_async_client(monkeypatch):
    events = []
    async_client = SimpleNamespace(
        close=lambda: _record_async_close(events),
    )
    service = object()
    runtime = SimpleNamespace(service=service)
    application = FastAPI()
    database = object()

    monkeypatch.setattr(
        main,
        "get_mongodb_config",
        lambda: ("mongodb://test-host:27017", "Member2_jobs_test"),
    )
    monkeypatch.setattr(main.sys, "version_info", (3, 15, 0))

    def restore_ssl_context():
        original_extract_from_ssl()
        events.append("ssl_restore")

    monkeypatch.setattr(main, "extract_from_ssl", restore_ssl_context)

    async def connect_db():
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.options |= ssl.OP_NO_SSLv2
        events.append("main_connect")
        return async_client, database

    async def build_job_config(received_database):
        assert received_database is database
        events.append("member2_config")
        return JobManagementConfig()

    async def start_runtime(uri, database_name, config):
        assert uri == "mongodb://test-host:27017"
        assert database_name == "Member2_jobs_test"
        assert isinstance(config, JobManagementConfig)
        events.append("member2_start")
        return runtime

    async def stop_runtime(received_runtime):
        assert received_runtime is runtime
        events.append("member2_stop")

    async def no_op(_database):
        pass

    monkeypatch.setattr(main, "connect_db", connect_db)
    monkeypatch.setattr(main, "initialize_auth_database", no_op)
    monkeypatch.setattr(main, "ensure_bootstrap_admin", no_op)
    monkeypatch.setattr(main, "migrate_legacy_admin_products", no_op)
    monkeypatch.setattr(main, "sync_existing_admin_product_prices", no_op)
    monkeypatch.setattr(main, "build_member2_job_config", build_job_config)
    monkeypatch.setattr(main, "start_member2_runtime", start_runtime)
    monkeypatch.setattr(main, "stop_member2_runtime", stop_runtime)

    async def scenario():
        async with main.lifespan(application):
            assert application.state.mongo_client is async_client
            assert application.state.scraping_job_service is service
            assert application.state.member2_job_runtime is runtime
            assert events == [
                "ssl_restore",
                "main_connect",
                "member2_config",
                "member2_start",
            ]

    asyncio.run(scenario())
    assert events == [
        "ssl_restore",
        "main_connect",
        "member2_config",
        "member2_start",
        "member2_stop",
        "main_async_close",
    ]


def test_main_lifespan_closes_async_client_after_member2_startup_failure(
    monkeypatch,
):
    events = []
    async_client = SimpleNamespace(
        close=lambda: _record_async_close(events),
    )
    application = FastAPI()
    database = object()

    monkeypatch.setattr(
        main,
        "get_mongodb_config",
        lambda: ("mongodb://test-host:27017", "Member2_jobs_test"),
    )
    monkeypatch.setattr(main.sys, "version_info", (3, 15, 0))
    monkeypatch.setattr(main, "extract_from_ssl", lambda: None)

    async def connect_db():
        events.append("main_connect")
        return async_client, database

    async def build_job_config(received_database):
        assert received_database is database
        return JobManagementConfig()

    async def fail_start(uri, database_name, config):
        _ = uri, database_name, config
        events.append("member2_start_failed")
        raise RuntimeError("index initialization failed")

    async def no_op(_database):
        pass

    monkeypatch.setattr(main, "connect_db", connect_db)
    monkeypatch.setattr(main, "initialize_auth_database", no_op)
    monkeypatch.setattr(main, "ensure_bootstrap_admin", no_op)
    monkeypatch.setattr(main, "migrate_legacy_admin_products", no_op)
    monkeypatch.setattr(main, "sync_existing_admin_product_prices", no_op)
    monkeypatch.setattr(main, "build_member2_job_config", build_job_config)
    monkeypatch.setattr(main, "start_member2_runtime", fail_start)

    async def scenario():
        with pytest.raises(RuntimeError, match="index initialization failed"):
            async with main.lifespan(application):
                pass

    asyncio.run(scenario())
    assert events == [
        "main_connect",
        "member2_start_failed",
        "main_async_close",
    ]


def test_main_lifespan_requires_mongodb_configuration_before_connect(monkeypatch):
    application = FastAPI()

    def missing_mongodb_configuration():
        raise RuntimeError("MongoDB configuration is required")

    async def connect_db():
        pytest.fail("Main MongoDB must not connect without test selection.")

    monkeypatch.setattr(
        main,
        "get_mongodb_config",
        missing_mongodb_configuration,
    )
    monkeypatch.setattr(main, "connect_db", connect_db)

    async def scenario():
        with pytest.raises(RuntimeError, match="MongoDB configuration"):
            async with main.lifespan(application):
                pass

    asyncio.run(scenario())


async def _record_async_close(events):
    events.append("main_async_close")
