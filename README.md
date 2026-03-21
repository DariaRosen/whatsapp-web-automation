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

### Securing the dashboard (production)

Set `DASHBOARD_TOKEN` to a long random string. Then either:

- Open `/dashboard?token=YOUR_TOKEN` once (saved in browser `localStorage`), or  
- Paste the token in the dashboard footer and click **Save**, or  
- Send header `x-dashboard-token: YOUR_TOKEN` (or `Authorization: Bearer YOUR_TOKEN`) on API calls.

`GET /health` stays **unauthenticated** for Render health checks.

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
- **Build**: `npm install` (or leave default).
- **Start**: `npm start` (runs `node src/server.js`).
- **Environment**: In Render dashboard, set `MONGO_URL` (and optionally `DB_NAME`, `PORT`; Render sets `PORT` for Web Services).
- **Persistent disk (important)**:
  - WhatsApp session is stored on disk (LocalAuth). Without a persistent disk, every deploy or restart will lose the session and require a new QR scan.
  - In Render: add a **Disk** to the service and mount it (e.g. `/data`).
  - Set env var: `WWEBJS_AUTH_PATH=/data/.wwebjs_auth` so session files live on the persistent volume.
- **Health**: For Web Service, set health path to `GET /health`. Render will use it to decide if the instance is healthy.
- **Graceful shutdown**: The app handles `SIGTERM` (and `SIGINT`): it closes the HTTP server, destroys the WhatsApp client, and disconnects MongoDB before exiting.

## Behavior summary

- **Startup**: Connects to MongoDB, initializes WhatsApp client, starts HTTP server with `/health`.
- **Auth**: Uses LocalAuth; first time shows QR in logs (scan with phone).
- **Reconnect**: On disconnect or init failure, destroys client, waits with exponential backoff (5s → 10s → 30s), then reinitializes. Reconnect count resets when `ready` fires.
- **Messages**: Only processes incoming, text messages (ignores own messages, status, non-text). Extracts phone, name, first message; deduplicates by `phone` and saves new leads to MongoDB.
- **Stability**: Global `uncaughtException` and `unhandledRejection` handlers log and trigger graceful shutdown instead of crashing.
