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

Registration, login, and admin user management use the MongoDB `users`
collection. Configure `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_USERNAME`,
and `BOOTSTRAP_ADMIN_PASSWORD` together to create the first administrator
when that email is not already registered. The password must be at least
12 characters; there is no default admin password. Keep these values only in
`Backend\.env` or the deployment secret manager. `APP_ENV=development` enables
the local HTTP session cookie; leave it unset or use a non-development value
for HTTPS deployments.

When an administrator first opens User Management, existing browser-local
accounts are offered for a one-time import into MongoDB. Existing password
hashes are retained for sign-in and upgraded after a successful login;
imported roles are set to `User`, and the configured administrator account is
not overwritten. The browser copy is not deleted.

Run the API from the `Backend` directory:

```powershell
cd Backend
.\venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

The local Vite origins on ports `5173` and `5175` are allowed by CORS
(including `localhost` and `127.0.0.1`). Interactive API documentation is
available at `http://127.0.0.1:8000/docs`.

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

Admin-managed products and scraped Amazon products use the same MongoDB
`products` collection as the public catalog, so they appear in the user-facing
product list. Admin price changes also update the matching store offer and add
the current price to price history. Existing records from the former
`admin_products` collection are copied into `products` at startup if missing;
the migration does not overwrite existing catalog records after its first run.

## How workspace pages relate

- **Products** shows the catalog price at the product's listed store.
- **Price comparison** includes that store offer alongside other recorded
  store offers. The cheapest offer can differ from the catalog price when a
  different store is cheaper.
- **Price history** shows stored observations. Admin and scraping price
  changes add a point; it does not substitute a generated trend for backend
  history.
- **Watchlist** and **Alerts** refer to catalog product IDs. Deleting a
  product removes its store offers, watchlist entry, and alerts; existing
  notifications remain as historical records.
- **Alerts** evaluate the same listed-store catalog price shown on Products.
  When the workspace loads, active alerts whose target has been reached are
  marked triggered. If in-app alerts are enabled, a linked notification is
  created once. Email delivery is not configured.
- **Settings** preferences are saved in the current browser. Theme, in-app
  alerts, and system-update display are user preferences, not product prices.

## API

- `GET /api/health`
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/session`,
  `POST /api/auth/logout`
- `GET /api/admin/users`, `PATCH /api/admin/users/{email}/status`,
  `POST /api/admin/users/import-browser` (admin session required)
- `GET /api/admin/products`, `POST /api/admin/products`,
  `PUT /api/admin/products/{product_id}`, `DELETE /api/admin/products/{product_id}`
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
