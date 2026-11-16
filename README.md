# Automated Web Scraping Price Comparison Engine

The React/Vite frontend connects to the FastAPI backend through `/api`. The
backend stores product catalog data, offers and price history, alerts,
watchlist entries, notifications, and scraping logs in MongoDB. The existing
screens and styling are unchanged; backend failures keep the demo data visible
for the affected view. Initial connection failures and failed write actions are
reported with an in-app error.

## Run locally

Requirements: Node.js, Python, and a reachable MongoDB instance.

1. Configure MongoDB and `CHANNEL3_API_KEY` in `Backend\.env` using
   `Backend\.env.example` as a template. Keep your existing `.env` values if
   already configured; never expose the Channel3 key in frontend code.
2. In a terminal, install and start the backend:

   ```powershell
   cd Backend
   python -m venv venv
   .\venv\Scripts\python.exe -m pip install -r requirements.txt
   .\venv\Scripts\python.exe -m uvicorn app.main:app --reload
   ```

3. In a second terminal at the repository root, install and start the frontend:

   ```powershell
   npm install
   npm run dev
   ```

The Vite dev server forwards `/api` requests to `http://127.0.0.1:8000`.
Check `http://127.0.0.1:8000/api/health` or open the interactive API docs at
`http://127.0.0.1:8000/docs`. Backend setup and endpoint details are in
[Backend/README.md](./Backend/README.md).

On startup, demo catalog/history and example logs are seeded into collections
that are empty. Existing collection data is left untouched. The backend API
does not run scraping jobs; a scraper can write product prices, offers, and
history to MongoDB for the frontend to display.

For production, configure the hosting/reverse proxy to route `/api` to the
FastAPI service; the Vite proxy is for local development.

On the Products page, searching also queries Channel3. Matching results update
their database product's displayed offer; Channel3-only results appear in the
same catalog and link to an available offer.
