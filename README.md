# WhatsApp Listener Service

Production-ready Node.js service that listens for incoming WhatsApp messages to your WhatsApp Business number and stores new leads in MongoDB. Built for long-running deployment (e.g. Render) with reconnection and graceful shutdown.

## Tech stack

- **Node.js** (≥18)
- **whatsapp-web.js** – WhatsApp Web client
- **qrcode-terminal** – QR code in terminal for first-time auth
- **mongoose** – MongoDB ODM
- **dotenv** – Environment variables
- **winston** – Logging

## Project structure

```
/src
  server.js          # Entry: env, MongoDB, health endpoint, shutdown
  whatsappClient.js  # WhatsApp client lifecycle, reconnect, message handler
  models/Lead.js     # Lead schema (phone, name, firstMessage, createdAt)
  logger.js          # Winston logger
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

   - `PORT` – HTTP port (default `3000`)
   - `MONGO_URI` – MongoDB connection string

   ```bash
   cp .env.example .env
   # Edit .env with your MONGO_URI and optional PORT
   ```

3. **Run**

   ```bash
   npm start
   ```

   On first run you’ll see a QR code in the terminal. Scan it with WhatsApp (phone linked to your Business account). The session is stored under `.wwebjs_auth` (or `WWEBJS_AUTH_PATH`) so you usually won’t need to scan again after restarts.

4. **Health check**

   ```bash
   curl http://localhost:3000/health
   # {"status":"ok"}
   ```

## Environment variables

| Variable         | Required | Description                                      |
|------------------|----------|--------------------------------------------------|
| `PORT`           | No       | HTTP port (default `3000`)                      |
| `MONGO_URI`      | Yes      | MongoDB connection string                        |
| `WWEBJS_AUTH_PATH` | No     | Directory for WhatsApp session (default `.wwebjs_auth`) |
| `LOG_LEVEL`      | No       | Winston level (default `info`)                   |

## Lead schema (MongoDB)

- **phone** (String, unique) – normalized (no `@c.us`)
- **name** (String) – contact name if available
- **firstMessage** (String) – first incoming text
- **createdAt** (Date)

Only the first message per phone is stored; later messages from the same number are ignored (deduplication by `phone`).

## Deploying to Render

- **Service type**: Use a **Web Service** (so Render can hit `GET /health` for liveness) or a **Background Worker** if you only need the process to run and don’t care about HTTP.
- **Build**: `npm install` (or leave default).
- **Start**: `npm start` (runs `node src/server.js`).
- **Environment**: In Render dashboard, set `MONGO_URI` (and optionally `PORT`; Render sets `PORT` for Web Services).
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
