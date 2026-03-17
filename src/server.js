/**
 * WhatsApp Listener Service – entry point.
 *
 * Deploy to Render:
 * - Use Web Service (for /health) or Background Worker.
 * - Start command: npm start
 * - Set env: MONGO_URI (required), optionally PORT, WWEBJS_AUTH_PATH.
 * - Attach a persistent Disk and set WWEBJS_AUTH_PATH=/data/.wwebjs_auth
 *   so the WhatsApp session survives restarts and redeploys.
 * - Health path: GET /health → { status: "ok" }
 */
require("dotenv").config();

const http = require("http");
const mongoose = require("mongoose");
const logger = require("./logger");
const Lead = require("./models/Lead");
const { initializeClient, destroyClient } = require("./whatsappClient");

const PORT = Number(process.env.PORT) || 3000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/whatsapp-leads";

let isShuttingDown = false;

// ---------------------------------------------------------------------------
// Global error handlers (prevent crashes from uncaught errors)
// ---------------------------------------------------------------------------

process.on("uncaughtException", (err) => {
  logger.error("uncaughtException: " + (err?.message || String(err)));
  if (err?.stack) logger.error(err.stack);
  if (!isShuttingDown) {
    isShuttingDown = true;
    shutdown().finally(() => process.exit(1));
  }
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("unhandledRejection: " + (reason?.message || String(reason)));
  if (!isShuttingDown) {
    logger.error("Promise: " + String(promise));
  }
});

// ---------------------------------------------------------------------------
// MongoDB
// ---------------------------------------------------------------------------

async function connectMongo() {
  await mongoose.connect(MONGO_URI);
  logger.info("MongoDB connected");
}

async function disconnectMongo() {
  try {
    await mongoose.disconnect();
    logger.info("MongoDB disconnected");
  } catch (err) {
    logger.error("MongoDB disconnect error: " + err.message);
  }
}

// ---------------------------------------------------------------------------
// Lead deduplication and save (called from WhatsApp message handler)
// ---------------------------------------------------------------------------

async function handleNewLead(data) {
  const { phone, name, firstMessage } = data;
  if (!phone || !firstMessage) return;

  try {
    const existing = await Lead.findOne({ phone }).lean();
    if (existing) {
      logger.debug("Lead already exists for phone " + phone + ", skipping");
      return;
    }
    await Lead.create({ phone, name: name || "", firstMessage });
    logger.info("Lead saved: " + phone);
  } catch (err) {
    if (err.code === 11000) {
      logger.debug("Lead already exists (duplicate key) for phone " + phone);
      return;
    }
    logger.error("Failed to save lead: " + err.message);
  }
}

// ---------------------------------------------------------------------------
// HTTP health endpoint (for Render and load balancers)
// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  if (req.method === "GET" && (req.url === "/health" || req.url === "/")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }
  res.writeHead(404);
  res.end();
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info("Shutting down...");
  server.close(() => logger.info("HTTP server closed"));
  destroyClient();
  await disconnectMongo();
}

process.on("SIGINT", () => {
  shutdown().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  shutdown().finally(() => process.exit(0));
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  logger.info("Service starting");

  await connectMongo();
  initializeClient(handleNewLead);

  server.listen(PORT, () => {
    logger.info("Health endpoint listening on port " + PORT + " (GET /health)");
  });
}

main().catch((err) => {
  logger.error("Startup failed: " + err.message);
  process.exit(1);
});
