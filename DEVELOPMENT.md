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
