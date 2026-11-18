# Member 2 scraping job integration requirements

The job router, service, repository interface, and worker are implemented
inside the `member2.app` package. The standalone
`member2.app.main` application is a development and
testing entry point; its default repository is in-memory and does not provide
restart-safe persistence.

## Requirements for Main Backend integration

1. **Inject the host database.** Create `MongoJobRepository` using the
   database supplied by the host application's lifespan. The repository does
   not create a MongoDB client, read environment files, or depend on the
   standalone application. Production job and execution history require this
   persistent repository, not `InMemoryJobRepository`.
2. **Inject approved source and store configuration.** Supply
   `JobManagementConfig.store_bindings` and `source_to_store` from authoritative
   managed-store data. The API's existing `CreateScrapingJobInput` contains
   `store_id`, interval, first schedule, timeout, and retry count, but no
   scraper selector or search keyword. `DummyJSON` therefore needs an
   explicitly configured keyword for each applicable store. Unknown stores,
   sources, and missing keywords are rejected; no store, category, or currency
   mappings are inferred.
3. **Mount the router and inject the service.** Include
   `member2.app.routers.jobs.router` in the host app and set
   `app.state.scraping_job_service` to a `ScrapingJobService` constructed with
   the host's repository and configuration. This preserves the route/service
   boundary and avoids moving the business logic into either app entry point.
4. **Start workers with host lifespan and configure leases.** Start each
   `ScrapingJobWorker.run()` task during host startup and stop it during
   shutdown. Workers receive unique identities, atomically claim due jobs, and
   renew their ownership leases while executions run. Expired jobs are claimed
   by a recovery worker before being finalized as failed; active leases are not
   failed when another worker starts. `JobManagementConfig` defaults to a
   60-second lease and a 15-second heartbeat; configure both values for the
   deployment, with the heartbeat no greater than the lease. Worker hosts must
   have synchronized UTC clocks. Use a persistent Mongo repository when
   multiple processes share the job store; the in-memory repository is only
   suitable for one process and isolated development/tests. Mongo operations
   use conditional atomic updates, but this implementation has not been tested
   against a live MongoDB deployment.
5. **Account for old running records and synchronous scrapers.** Recovery
   requires a recorded lease expiration. Legacy `running` records without lease
   metadata are intentionally not assumed expired; after old workers are
   stopped, handle those records through an explicit migration or operator
   action. Ownership checks prevent a stale worker from finalizing the job.
   A synchronous scraper call already in progress cannot be forcibly
   interrupted safely and may run until its request timeout; an operator retry
   during that interval could overlap the stale call.
6. **Configure API security and routing.** The host must provide its own
   authentication/authorization and CORS policy. The Member 2 router does not
   add either. The frontend can configure its route prefix and methods through
   its existing scraping API configuration.
7. **Decide where scraped Products are consumed.** Successful strict
   frontend-compatible Products are retained in the execution-results
   repository and can be retrieved through the results endpoint. The Member 2
   implementation does not write to the Main Backend catalog, offers, or
   price-history collections. A future host integration must explicitly decide
   whether and how to upsert those records.
8. **Coordinate progress and in-flight controls.** Execution responses expose
   stage progress, but the current frontend execution type does not render
   these additional fields. Running Pause and Cancel requests take effect only
   after the current execution finishes scraping, normalization, and result
   persistence; existing scrapers do not expose resumable checkpoints. Truly
   interruptible/resumable pagination requires a separate cooperative scraper
   interface and persisted cursor/partial-result state.

The frontend's existing create request and Product contract are unchanged.
`GET /jobs/{job_id}/executions/{execution_id}/results` returns only records that
pass the existing strict Product normalization contract. Ingestion and
conversion errors remain attached to execution history.

## Standalone development use

`member2.app.main:create_app(repository, config)` accepts a repository and configuration
for tests or local wiring. The module-level `app` intentionally uses
`InMemoryJobRepository` and an empty store registry. It supports lifecycle/API
development but is volatile and rejects job creation until explicit store and
source configuration is supplied. Do not treat this default as a production
job store.
