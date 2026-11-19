# SmartPrice API

The FastAPI backend stores the catalog, price offers/history, alerts, watchlist,
notifications, and scraping-log examples in MongoDB. It does not run scraping
jobs. On startup, demo catalog data is inserted into each seed collection only
when that collection is empty; existing records are left unchanged.

## Setup

From the repository root, create a local environment file and install the
backend requirements:

```powershell
if (-not (Test-Path Backend\.env)) { Copy-Item Backend\.env.example Backend\.env }
if (-not (Test-Path Backend\venv\Scripts\python.exe)) { python -m venv Backend\venv }
Backend\venv\Scripts\python.exe -m pip install -r Backend\requirements.txt
```

Set `MONGODB_URL` in `Backend\.env` to your MongoDB connection string. The API
fails at startup with a clear message if it is missing or MongoDB cannot be
reached. `DATABASE_NAME` defaults to `PriceComparison`.
Set `CHANNEL3_API_KEY` in the same file to enable live Channel3 product
searches. Keep the key in the backend environment only; do not add it to
frontend environment variables or commit it.

Run the API from the `Backend` directory:

```powershell
cd Backend
$repositoryRoot = (Resolve-Path ..).Path
if ($env:PYTHONPATH) {
  $env:PYTHONPATH = "$repositoryRoot;$env:PYTHONPATH"
} else {
  $env:PYTHONPATH = $repositoryRoot
}
.\venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

The repository root is added to `PYTHONPATH` so the backend can import the
sibling `member2` package without changing `sys.path` at runtime.

For Member 2 integration testing only, set
`MEMBER2_INTEGRATION_TEST_MODE=true`,
`MEMBER2_TEST_MONGODB_URI`, and `MEMBER2_TEST_DATABASE_NAME` in the process
environment. The test URI must not include a database path, and the database
name must end in `_test`. When test mode is selected, both the main backend
client and any injected Member 2 client use these dedicated settings; invalid
or incomplete test settings fail startup instead of falling back to the normal
MongoDB configuration. Startup seeding therefore also targets the selected
test database. Use a transaction-capable replica set or sharded deployment;
do not use a standalone MongoDB server for job transaction tests. Never put
test credentials in tracked files.

The local Vite origin `http://localhost:5173` is allowed by CORS (as is
`http://127.0.0.1:5173`). Interactive API documentation is available at
`http://127.0.0.1:8000/docs`.

## Import Channel3 products

Import up to 150 products from a retailer website into MongoDB and upsert
their offers by Channel3 product ID:

```powershell
cd Backend
.\venv\Scripts\python.exe -m app.import_channel3_products amazon.com
```

The importer resolves the website through Channel3, follows its browse
pagination cap, and stores products under `channel3-<product-id>`. Products
without USD offers are skipped because the catalog requires a comparable price.
Re-run the command to update existing imported products and offers.

## API

- `GET /api/health`
- `GET /api/products`
- `GET /api/products/{product_id}/channel3`
- `GET /api/channel3/search?q={query}&limit={limit}`
- `GET /api/products/{product_id}/offers`
- `GET /api/products/{product_id}/history?period=7D|30D|90D|1Y`
- `GET /api/alerts`, `POST /api/alerts`, `PUT /api/alerts/{id}`,
  `DELETE /api/alerts/{id}`
- `GET /api/watchlist`, `PUT /api/watchlist/{product_id}`,
  `DELETE /api/watchlist/{product_id}`
- `GET /api/notifications`, `POST /api/notifications`,
  `PUT /api/notifications/{id}/read`, `POST /api/notifications/read-all`,
  `DELETE /api/notifications/{id}`, `DELETE /api/notifications`
- `GET /api/scraping-logs`

Request bodies for alerts and notifications use the frontend's complete
`PriceAlert` and `DemoNotification` shapes. Watchlist upserts accept
`{"addedAt":"..."}`. Invalid bodies receive validation errors, and unknown
resource IDs receive `404` responses. Successful deletes and read actions
return `204 No Content`.
