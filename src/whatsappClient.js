const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const logger = require("./logger");
const whatsappState = require("./whatsappState");

const RECONNECT_BACKOFF_MS = [5000, 10000, 30000];
const MAX_BACKOFF_INDEX = RECONNECT_BACKOFF_MS.length - 1;

let client = null;
let reconnectAttempt = 0;
let onNewLeadCallback = null;

/**
 * Normalize phone from WhatsApp id (e.g. "1234567890@c.us") to digits only.
 * @param {string} raw - Raw id from message.from
 * @returns {string} Normalized phone
 */
function normalizePhone(raw) {
  if (!raw || typeof raw !== "string") return "";
  return raw.replace(/@c\.us$/i, "").trim();
}

/**
 * Get delay in ms for current reconnect attempt (exponential backoff).
 * @returns {number}
 */
function getReconnectDelayMs() {
  const index = Math.min(reconnectAttempt, MAX_BACKOFF_INDEX);
  return RECONNECT_BACKOFF_MS[index];
}

/**
 * Destroy the current WhatsApp client. Idempotent.
 */
function destroyClient() {
  if (!client) return;
  try {
    client.removeAllListeners();
    client.destroy();
  } catch (err) {
    logger.error("Error destroying WhatsApp client: " + err.message);
  } finally {
    client = null;
  }
}

/**
 * Set up event handlers on the WhatsApp client.
 * @param {import("whatsapp-web.js").Client} c - Client instance
 */
function setupClientEvents(c) {
  c.on("qr", (qr) => {
    logger.info("QR code received. Scan with WhatsApp on your phone.");
    qrcode.generate(qr, { small: true });
    whatsappState.setQr(qr);
  });

  c.on("ready", () => {
    reconnectAttempt = 0;
    logger.info("WhatsApp client is ready and connected.");
    whatsappState.setReady(true);
  });

  c.on("authenticated", () => {
    logger.info("WhatsApp session authenticated.");
    // Do NOT clearQr here — "authenticated" can fire before "ready"; clearing would drop the
    // QR string from /api/whatsapp/qr while the user still needs to finish pairing. setReady(true) clears it.
  });

  c.on("auth_failure", (msg) => {
    const detail = msg || "Unknown reason";
    logger.error("WhatsApp authentication failed: " + detail);
    whatsappState.setDisconnected("auth_failure: " + String(detail));
  });

  c.on("disconnected", (reason) => {
    logger.warn("WhatsApp client disconnected. Reason: " + (reason || "unknown"));
    whatsappState.setDisconnected(reason || "disconnected");
    destroyClient();
    const delayMs = getReconnectDelayMs();
    reconnectAttempt += 1;
    logger.info(
      `Reconnect attempt ${reconnectAttempt}. Reinitializing in ${delayMs / 1000}s...`
    );
    setTimeout(() => {
      initializeClient(onNewLeadCallback);
    }, delayMs);
  });

  c.on("message", async (message) => {
    try {
      if (message.fromMe) return;
      const from = String(message.from || "");
      if (from.includes("status") || from.includes("@g.us") || from.includes("@newsletter")) return;
      const body = message.body;
      if (!body || typeof body !== "string" || !body.trim()) return;

      const phone = normalizePhone(message.from);
      if (!phone) return;

      let name = "";
      try {
        const contact = await message.getContact();
        name = (contact.pushname || contact.name || "").trim();
      } catch {
        // ignore contact fetch errors
      }

      logger.info("Incoming message from " + phone + (name ? ` (${name})` : ""));

      if (onNewLeadCallback) {
        await onNewLeadCallback({ phone, name, firstMessage: body.trim() });
      }
    } catch (err) {
      logger.error("Error processing message: " + err.message);
    }
  });
}

/**
 * Initialize the WhatsApp client and start listening.
 * @param {(data: { phone: string, name: string, firstMessage: string }) => Promise<void>} onNewLead - Called for each new incoming text lead (caller handles deduplication)
 */
function initializeClient(onNewLead) {
  onNewLeadCallback = onNewLead;

  const authPath = process.env.WWEBJS_AUTH_PATH || ".wwebjs_auth";
  const puppeteerOpts = {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu",
    ],
  };
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    puppeteerOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  const clientOptions = {
    authStrategy: new LocalAuth({ dataPath: authPath }),
    puppeteer: puppeteerOpts,
  };

  client = new Client(clientOptions);
  setupClientEvents(client);

  client.initialize().catch((err) => {
    whatsappState.setDisconnected("init_error: " + err.message);
    logger.error("WhatsApp client failed to initialize: " + err.message);
    destroyClient();
    const delayMs = getReconnectDelayMs();
    reconnectAttempt += 1;
    logger.info(
      `Reconnect attempt ${reconnectAttempt}. Reinitializing in ${delayMs / 1000}s...`
    );
    setTimeout(() => initializeClient(onNewLeadCallback), delayMs);
  });
}

module.exports = {
  initializeClient,
  destroyClient,
  normalizePhone,
};
