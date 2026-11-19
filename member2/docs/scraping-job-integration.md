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
   60-second lease, a 15-second heartbeat, and a 5-second heartbeat safety
   margin. The heartbeat interval plus its margin must be less than the lease.
   Worker hosts must have synchronized UTC clocks. Use a persistent Mongo
   repository when multiple processes share the job store; the in-memory
   repository is only suitable for one process and isolated development/tests.
5. **Configure MongoDB transactions.** Mongo ownership-checked execution and
   result writes, plus job/execution finalization, run in transactions that
   conditionally write the owning job document before writing child records.
   MongoDB must run as a replica set or sharded cluster with transaction
   support; standalone MongoDB deployments are not supported for these paths.
   This implementation has not been validated against a live MongoDB
   deployment. The in-memory tests verify repository semantics, not MongoDB
   transaction atomicity.
6. **Account for old running records and synchronous scrapers.** Recovery
   requires a recorded lease expiration. Legacy `running` records without lease
   metadata are intentionally not assumed expired; after old workers are
   stopped, handle those records through an explicit migration or operator
   action. A stale worker cannot finalize after ownership changes. An expired
   job is not retryable until `JobManagementConfig.scraper_execution_timeout_seconds`
   plus one lease duration after recovery finalization. The total execution
   timeout defaults to 900 seconds and is distinct from each job's per-request
   HTTP timeout. Mongo finalization first commits a retry-pending gate with the
   job and execution changes, then uses a generation-fenced post-commit update
   to set the quarantine deadline. If that post-commit update fails, manual
   retry remains blocked; the next retry attempt persists a conservative
   deadline before returning a conflict. Slow history loading and transaction
   commit time therefore do not consume the intended quarantine.
   Built-in scrapers use a monotonic total deadline,
   check it between requests/pages, and bound each new request timeout by the
   remaining budget; they do not return partial results as successful
   executions. Playwright launch, navigation, selector waits, text extraction,
   and attribute reads use explicit timeouts when supported. Synchronous page
   creation, locator `count`/`all`, browser cleanup, and other in-flight
   operations without timeout support cannot be forcibly interrupted. Custom
   two-argument scraper callbacks can only be checked before and after the
   callback. Lease expiry does not terminate a
   call: a suspended or nonresponsive process can outlive this finite
   quarantine, so strict prevention of all overlap requires cooperative
   cancellation or process supervision outside this subsystem.
   Recovery finalizes every recorded `running` execution as failed with an
   interruption error in the same transaction as the job. If history cannot
   be loaded or any child execution cannot be updated, recovery leaves the job
   recoverable rather than finalizing it with unresolved running history.
7. **Reconcile inconsistent terminal history.** The worker also scans terminal
   jobs that still have `running` executions. It finalizes every such execution
   only when its recorded owner and generation match the terminal job's
   retained final owner and generation. Reconciliation is idempotent and uses a
   transaction in MongoDB. It does not guess ownership for legacy records with
   missing or conflicting owner/generation metadata; those remain visible as
   unresolved history and require operator repair or a separately reviewed
   migration. History-load and persistence failures are logged and retried on
   later worker iterations. Reconciliation is not reported as successful while
   any execution remains running.
8. **Handle legacy retry metadata conservatively.** New jobs record a retry
   policy version even when no quarantine deadline is intended. A failed
   legacy job missing that version and lacking `retry_not_before` receives one
   conservative delay of the configured total scraper timeout plus one lease
   duration on its first manual retry attempt. The policy version and deadline
   are persisted before the retry is rejected. This avoids treating an absent
   legacy field as an intentional immediate retry; operators can inspect the
   stored metadata, but no bulk migration is required.
9. **Configure API security and routing.** The host must provide its own
   authentication/authorization and CORS policy. The Member 2 router does not
   add either. The frontend can configure its route prefix and methods through
   its existing scraping API configuration.
10. **Decide where scraped Products are consumed.** Successful strict
   frontend-compatible Products are retained in the execution-results
   repository and can be retrieved through the results endpoint. The Member 2
   implementation does not write to the Main Backend catalog, offers, or
   price-history collections. A future host integration must explicitly decide
   whether and how to upsert those records.
11. **Coordinate progress and in-flight controls.** Execution responses expose
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

## Retailer product scrapers

The registry includes `Adorama`, `Amazon`, and `Walmart` in addition to the
existing demo/API scrapers. Each retailer binding requires a non-empty
`keyword`. Configure `StoreScraperBinding.source_identity` with the exact
source name and use an explicitly approved existing managed `store_id` in
`JobManagementConfig.store_bindings` and `source_to_store`; these scrapers do
not create stores or infer source-to-store relationships. The backend jobs API
uses the store binding's configured keyword when a job is executed.

| Source identity | Discovery strategy | Bounded behavior |
| --- | --- | --- |
| `Adorama` | Match keywords against robots-advertised product sitemaps, then read candidate product pages. | At most 6 advertised sitemap files, 6 child sitemaps per file, and 8 product pages per run. It does not call the site's disallowed search endpoint. |
| `Amazon` | Read the public `/s` search results and follow its next-page link when allowed by robots.txt. | At most 2 search pages, 20 distinct products, and 5 detail pages per run. Search cards provide listing data; detail pages fill missing fields. |
| `Walmart` | Match keywords against robots-advertised product sitemap shards, then read candidate product pages. | At most 8 sitemap shards and 8 product pages per run. It does not call the site's disallowed `/search` path; shard limits can produce incomplete or empty keyword results. |

The scrapers send a transparent `Member2PriceComparisonBot/1.0` user agent,
honor robots rules and crawl delays, restrict redirects to each retailer's
hosts, and use bounded timeouts. HTTP refusals, CAPTCHA or human-verification
pages, and other detected anti-bot responses are surfaced as failures; the
scrapers do not switch to a browser, impersonate a user agent, retry a block,
or bypass access controls. Robots permission alone does not establish
permission under a retailer's terms. Verify the applicable terms and obtain
approval before enabling live or production scraping.

Product fields are extracted from listing markup, product pages, and
Schema.org JSON-LD when present. Missing values remain missing; invalid prices
are not converted into guessed prices. The existing normalizer still requires
an approved category, currency, and store mapping to persist a result. An
unmapped retailer category is not inferred and will be reported as a
normalization issue.

Unit tests use mocked responses and run with the normal Member 2 suite. Live
retailer requests are opt-in and never contact MongoDB:

```powershell
$env:RUN_LIVE_ECOMMERCE_SCRAPERS = "1"
python -m pytest member2\tests\test_ecommerce_scrapers_live.py -q -rs
Remove-Item Env:RUN_LIVE_ECOMMERCE_SCRAPERS
```

The live tests report retailer blocks or network/HTTP unavailability as skips;
an empty result or product without a valid extracted price is a failure, not a
successful live scrape.

## Current retailer access blockers and permitted alternatives

The last direct-access attempts failed before usable product records were
extracted:

* Adorama's robots-advertised sitemap was readable, but a candidate product
  page returned HTTP 403. The scraper surfaces that refusal and does not retry
  the page through another client.
* Amazon's public search request returned HTTP 503. The request fails before
  the search-result parser runs, so changing selectors would not address it.
* Walmart's search path is disallowed by robots.txt. Product sitemap shards
  were readable, but product pages returned a robot/human verification
  challenge; those pages are rejected rather than parsed as product data.

No alternate access provider is currently configured. Potential partner routes
to investigate are Amazon's [Creators API](https://affiliate-program.amazon.com/creatorsapi/docs),
the [Walmart Affiliate Program](https://affiliates.walmart.com/) and its
Affiliate Marketing API, and Adorama's
[Affiliate Program](https://www.adorama.com/g/adorama-affiliate-program).
They require partner enrollment and/or credentials, and their terms may limit
price display, caching, storage, and comparison use. Adorama's public
affiliate-program page advertises partner tools, but a product-price feed/API
and permission for this application's use have not been verified.

A commercial data provider is another option, but none is enabled or required
by this package. For example, SerpApi publishes a
[Walmart product endpoint](https://serpapi.com/walmart-product-api) and
[pricing](https://serpapi.com/pricing). Provider coverage for all three
retailers, current pricing, allowed retention, and availability of Adorama
offers must be confirmed before selecting it. Do not add provider credentials
or incur charges until that route is explicitly approved. After approval, keep
keys in the ignored local environment file and add only the selected
provider's required variable names to the local setup instructions.
