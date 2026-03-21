/**
 * WhatsApp Listener Service – entry point.
 *
 * Deploy to Render:
 * - Use Web Service (for /health, /dashboard, /qr).
 * - Start command: npm start
 * - Set env: MONGO_URL (or MONGO_URI), optionally DB_NAME, PORT, WWEBJS_AUTH_PATH.
 * - Optional DASHBOARD_TOKEN: require ?token= or x-dashboard-token for /dashboard, /qr, /api/*
 * - Attach a persistent Disk and set WWEBJS_AUTH_PATH=/data/.wwebjs_auth
 * - Health path: GET /health
 */
require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });

const http = require("http");
const mongoose = require("mongoose");
const logger = require("./logger");
const Lead = require("./models/Lead");
const { initializeClient, destroyClient } = require("./whatsappClient");
const { createExpressApp } = require("./expressApp");

const PORT = Number(process.env.PORT) || 3000;
const MONGO_URL = process.env.MONGO_URL || process.env.MONGO_URI || "mongodb://localhost:27017/whatsapp-leads";
const DB_NAME = process.env.DB_NAME || null;

let isShuttingDown = false;
let httpServer = null;

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

async function connectMongo() {
  const options = DB_NAME ? { dbName: DB_NAME } : {};
  await mongoose.connect(MONGO_URL, options);
  logger.info("MongoDB connected" + (DB_NAME ? " (db: " + DB_NAME + ")" : ""));
}

async function disconnectMongo() {
  try {
    await mongoose.disconnect();
    logger.info("MongoDB disconnected");
  } catch (err) {
    logger.error("MongoDB disconnect error: " + err.message);
  }
}

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

async function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info("Shutting down...");
  if (httpServer) {
    await new Promise((resolve) => {
      httpServer.close(() => {
        logger.info("HTTP server closed");
        resolve();
      });
    });
  }
  destroyClient();
  await disconnectMongo();
}

process.on("SIGINT", () => {
  shutdown().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  shutdown().finally(() => process.exit(0));
});

async function main() {
  logger.info("Service starting");

  await connectMongo();
  initializeClient(handleNewLead);

  const app = createExpressApp();
  httpServer = http.createServer(app);
  httpServer.listen(PORT, () => {
    logger.info("Server listening on port " + PORT);
    logger.info("Dashboard: GET /dashboard  |  QR: GET /qr  |  Health: GET /health");
  });
}

main().catch((err) => {
  logger.error("Startup failed: " + err.message);
  process.exit(1);
});
