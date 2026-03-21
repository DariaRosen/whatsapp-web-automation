# WhatsApp Listener Service

Production-ready Node.js service that listens for incoming WhatsApp messages to your WhatsApp Business number and stores new leads in MongoDB. Built for long-running deployment (e.g. Render) with reconnection and graceful shutdown.

## Tech stack

- **Node.js** (≥18)
- **whatsapp-web.js** – WhatsApp Web client
- **qrcode-terminal** – QR code in terminal for first-time auth
- **mongoose** – MongoDB ODM
- **dotenv** – Environment variables
- **winston** – Logging
- **express** – Web server (dashboard + API)
- **qrcode** – QR image for the `/qr` page

## Project structure

```
/public
  dashboard.html     # Leads table (sort, filter, print, statuses, EN/HE)
  qr.html            # WhatsApp QR for scanning after deploy
/src
  server.js          # Entry: MongoDB, WhatsApp, HTTP server
  expressApp.js      # Routes: /health, /dashboard, /qr, /api/*
  whatsappClient.js  # WhatsApp client lifecycle, reconnect, message handler
  whatsappState.js   # In-memory QR for the web page
  models/Lead.js     # Lead schema (+ status)
  constants/leadStatuses.js
  logger.js
package.json
.env.example
```

## Quick start

1. **Clone and install**

   ```bash
   cd whatsapp-web-automation
   npm install
   ```

2. **Environment**

   Copy `.env.example` to `.env` and set:

   - `MONGO_URL` – MongoDB connection string (e.g. `mongodb://localhost:27017` or full URI)
   - `DB_NAME` – Database name (e.g. `whatsapp-leads`); optional if the DB is in the URL
   - `PORT` – HTTP port (default `3000`)

   You can use `.env` or `.env.local`; `.env.local` overrides `.env`.

   ```bash
   cp .env.example .env
   # Or create .env.local with MONGO_URL and DB_NAME
   ```

3. **Run**

   ```bash
   npm start
   ```

   On first run you’ll see a QR code in the terminal. Scan it with WhatsApp (phone linked to your Business account). The session is stored under `.wwebjs_auth` (or `WWEBJS_AUTH_PATH`) so you usually won’t need to scan again after restarts.

4. **Web UI**

   - **Dashboard:** `http://localhost:3000/dashboard` — leads table (sort, filter, print), **Export Excel** (UTF-8 CSV that opens in Excel; respects current filter & sort), **ערכת נושא / theme** (dark, light, or system — saved in the browser), status column saved to MongoDB, English / עברית.
   - **QR page:** `http://localhost:3000/qr` — WhatsApp QR when login is needed, or “connected” when the session is active.

5. **Health check**

   ```bash
   curl http://localhost:3000/health
   # {"status":"ok","database":"connected","leadsCount":…}
   ```

## Environment variables

| Variable           | Required | Description                                                        |
|--------------------|----------|--------------------------------------------------------------------|
| `MONGO_URL`        | Yes      | MongoDB connection string (or use `MONGO_URI`)                    |
| `DB_NAME`          | No       | Database name (e.g. `whatsapp-leads`); used if set                  |
| `PORT`             | No       | HTTP port (default `3000`)                                        |
| `WWEBJS_AUTH_PATH` | No       | Directory for WhatsApp session (default `.wwebjs_auth`)            |
| `LOG_LEVEL`        | No       | Winston level (default `info`)                                     |
| `DASHBOARD_TOKEN`  | No       | If set, required for `/dashboard`, `/qr`, and `/api/*` (see below) |
| `DASHBOARD_DISABLE_QUERY_TOKEN` | No | If `1` or `true`, ignore `?token=` (use `/login` only; breaks legacy bookmarked URLs with token) |

### Securing the dashboard (production)

Set `DASHBOARD_TOKEN` to a long random string. Then either:

- Open **`/login`** on your deployed URL — paste the token and click **Connect**. The server sets an **HttpOnly** session cookie (the token is **not** put in the URL).  
- Paste the token in the dashboard footer and click **Save** (same cookie-based session).  
- For scripts or `curl`, send header `x-dashboard-token: YOUR_TOKEN` (or `Authorization: Bearer YOUR_TOKEN`).  
- Legacy: `?token=` in the URL is still accepted once and then exchanged for the cookie (avoid sharing links with the token in them). Set `DASHBOARD_DISABLE_QUERY_TOKEN=1` to **disable** query-string auth (stricter; use **`/login` only** — old `?token=` bookmarks will not work).

`GET /health` stays **unauthenticated** for Render health checks.

### Security model (what this app does / does not do)

**Implemented**

- **HttpOnly + Secure (production) + `SameSite=Strict`** session cookie — not readable by JavaScript; mitigates theft via typical XSS `document.cookie`.
- **No token in the URL** after sign-in; optional **query token disabled** via env (see above).
- **Timing-safe comparison** for the shared secret (reduces timing side-channels vs naive `===`).
- **Rate limiting** on `POST /api/auth/dashboard-session` (brute-force resistance per IP behind your proxy).
- **Helmet** security headers including **CSP** (tightened for this app; inline scripts are still allowed where required by the static HTML — see note below).
- **Short-lived browser session** (cookie max-age **7 days**); sign in again after expiry.

**Limits (honest)**

- This is still a **single shared secret** (`DASHBOARD_TOKEN`), not per-user accounts, **2FA**, or **OAuth**. Anyone with the secret (or a stolen cookie) has full dashboard/API access until the cookie expires or you **rotate the secret** in hosting and invalidate sessions.
- **XSS**: HttpOnly helps against *cookie exfiltration*, but malicious script on your origin can still **call your API** in the victim’s browser while the session is active. CSP reduces some attack classes; `'unsafe-inline'` is required for the current inline dashboard/login scripts — migrating to external JS + nonces would tighten this further.
- **CSRF**: `SameSite=Strict` materially reduces cross-site cookie submission; state-changing APIs are not a separate “banking-grade” CSRF-token flow.
- **Brute force**: Rate limiting helps; for higher assurance add network controls (e.g. allowlist IPs / VPN / Cloudflare Access) in front of the app.
- **Multi-instance**: The cookie stores the same value the server compares to env — no server-side session store, so revocation is “change `DASHBOARD_TOKEN`” (all sessions invalid).

**Checklist for stronger real-world posture**

1. **HTTPS only** in production (e.g. Render) — already assumed for `Secure` cookies.  
2. **Secret**: generate `DASHBOARD_TOKEN` with a CSPRNG (e.g. `openssl rand -hex 32`); never commit it.  
3. **Rotate** the token if it may be exposed; treat it like a root password.  
4. Optionally set **`DASHBOARD_DISABLE_QUERY_TOKEN=1`** once everyone uses `/login`.  
5. For **maximum** isolation, put the dashboard behind **VPN**, **IP allowlist**, or an **identity proxy** (e.g. Cloudflare Access, Google IAP) — defense in depth beyond app code.

## Lead schema (MongoDB)

- **phone** (String) – unique among **active** leads only (see `removedAt`); normalized input (no `@c.us`)
- **removedAt** (Date | null) – when set, lead is hidden from the dashboard; **WhatsApp will not create a new lead** for the same phone (user chose “remove”). Manual add can **reactivate** the same row.
- **name** (String) – contact name if available
- **firstMessage** (String) – first incoming text
- **status** (String) – one of: `none`, `didnt_answer`, `not_interested`, `callback_later`, `waiting_more_details`, `waiting_client_details` (labels are EN/HE in the UI)
- **notes** (String) – free-text הערות, edited in the dashboard
- **serviceTypes** (String[]) – multi-select: `business_card`, `landing_page`, `website`, `lead_management_system`, `ai_agent` (כרטיס ביקור, דף נחיתה, אתר, מערכת ניהול לידים, סוכן AI)
- **createdAt** (Date)

Only the first message per phone is stored for **active** leads; later messages from the same number are ignored (deduplication by `phone`). Removed phones stay in the DB with `removedAt` set so they are not re-added from WhatsApp.

**API:** `GET /api/leads` (active only), `POST /api/leads` (manual add; reactivates a removed lead with the same phone), `DELETE /api/leads/:id` (soft-delete).

**MongoDB migration:** If you upgraded from a version with a global unique index on `phone`, drop the old index once so Mongoose can create the partial unique index: in Compass or `mongosh`, `db.leads.dropIndex("phone_1")` (name may vary), then restart the app to sync indexes.

## Deploying to Render

- **Service type**: Use a **Web Service** (so Render can hit `GET /health` for liveness) or a **Background Worker** if you only need the process to run and don’t care about HTTP.
- **Build**: `npm install` (or leave default). This runs **`postinstall`**, which downloads **Chrome for Puppeteer** into `./.cache/puppeteer` (required — `whatsapp-web.js` needs a real browser). If the build times out, increase the build timeout or use a larger instance. To skip the download locally, use `SKIP_PUPPETEER_CHROME=1 npm install` (WhatsApp will not work until you run `npm run install-chrome`).
- **Start**: `npm start` (runs `node src/server.js`).
- **Environment**: In Render dashboard, set `MONGO_URL` (and optionally `DB_NAME`, `PORT`; Render sets `PORT` for Web Services).
- **Persistent disk (important)**:
  - WhatsApp session is stored on disk (LocalAuth). Without a persistent disk, every deploy or restart will lose the session and require a new QR scan.
  - In Render: add a **Disk** to the service and mount it (e.g. `/data`).
  - Set env var: `WWEBJS_AUTH_PATH=/data/.wwebjs_auth` so session files live on the persistent volume.
- **QR not showing on `/qr`**: The page polls the server; a QR appears only after the WhatsApp client emits a `qr` event (usually within 1–2 minutes while Chromium starts). If you only see “disconnected” or a status line, open **Render → Logs** — look for Puppeteer/Chromium errors (`init_error`, sandbox, memory). Free/small instances often need a **paid** plan or more RAM for headless Chrome. After deploys, confirm the latest code is live and `WWEBJS_AUTH_PATH` points to a **persistent** disk.
- **Health**: For Web Service, set health path to `GET /health`. Render will use it to decide if the instance is healthy.
- **Graceful shutdown**: The app handles `SIGTERM` (and `SIGINT`): it closes the HTTP server, destroys the WhatsApp client, and disconnects MongoDB before exiting.

## Behavior summary

- **Startup**: Connects to MongoDB, initializes WhatsApp client, starts HTTP server with `/health`.
- **Auth**: Uses LocalAuth; first time shows QR in logs (scan with phone).
- **Reconnect**: On disconnect or init failure, destroys client, waits with exponential backoff (5s → 10s → 30s), then reinitializes. Reconnect count resets when `ready` fires.
- **Messages**: Only processes incoming, text messages (ignores own messages, status, non-text). Extracts phone, name, first message; deduplicates by `phone` and saves new leads to MongoDB.
- **Stability**: Global `uncaughtException` and `unhandledRejection` handlers log and trigger graceful shutdown instead of crashing.
