# Local development

Run the frontend locally with:

```sh
npm install
npm run dev
```

In development mode, PricePilot seeds one Admin account in this browser's
existing local authentication store. Sign in at `/login` with:

- Email: `admin@pricepilot.local`
- Username: `pilot-admin`
- Password: `PilotAdmin!2026`

The seed runs only in the Vite development build. It creates a local Admin
account without creating a login session. Normal public registration continues
to create `User` accounts only. If the demo Admin email already belongs to a
normal local account, remove that account from this browser's site data and
reload the development app; the seed will not promote a normal account.

This is frontend-only demo authentication backed by localStorage. The Admin
role and demo credentials are not production security controls.

## Scraping API integration

Scraping Management remains in **DEMO MODE** unless both
`VITE_SCRAPING_API_BASE_URL` and `VITE_SCRAPING_API_ENDPOINTS` are provided.
Set these in an untracked local `.env.local` file; do not commit credentials.
The base URL is public frontend configuration, not a place for API secrets.

No backend route names are assumed by the frontend. The endpoint variable must
be a JSON object mapping every operation to a relative `path` and HTTP
`method`. Job-specific paths use the `{jobId}` placeholder. For example, the
following paths are illustrative configuration only and are not implemented or
promised backend endpoints:

```dotenv
VITE_SCRAPING_API_BASE_URL=https://api.example.test
VITE_SCRAPING_API_ENDPOINTS={"createJob":{"path":"/scraping/jobs","method":"POST"},"getJobs":{"path":"/scraping/jobs","method":"GET"},"getJobDetails":{"path":"/scraping/jobs/{jobId}","method":"GET"},"startJob":{"path":"/scraping/jobs/{jobId}/start","method":"POST"},"pauseJob":{"path":"/scraping/jobs/{jobId}/pause","method":"POST"},"resumeJob":{"path":"/scraping/jobs/{jobId}/resume","method":"POST"},"cancelJob":{"path":"/scraping/jobs/{jobId}/cancel","method":"POST"},"getExecutionHistory":{"path":"/scraping/jobs/{jobId}/executions","method":"GET"}}
```

The typed client expects JSON responses: a job for create/details/action
operations, an array of jobs for `getJobs`, and an array of execution records
for execution history. `CreateScrapingJobInput` includes a managed `store_id`,
interval, first scheduled run, timeout, and retry count. Action requests return
the updated job. The UI polls `getJobs` every 10 seconds in live mode. The
backend must provide these contracts, authorization, CORS, persistence, job
execution/scheduling, and product/offer updates. Frontend mode does not execute
scrapers.

Scraped product results use the existing `Product` type from
`src/types/product.ts`; the frontend does not merge or overwrite manual
products. Backend ingestion must preserve that schema and the existing
store-specific offer model.
