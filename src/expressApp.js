const express = require("express");
const path = require("path");
const QRCode = require("qrcode");
const mongoose = require("mongoose");
const Lead = require("./models/Lead");
const { isValidStatus } = require("./constants/leadStatuses");
const whatsappState = require("./whatsappState");
const logger = require("./logger");

const publicDir = path.join(__dirname, "..", "public");

/**
 * Optional gate for dashboard + API. If unset, everything is open (dev only).
 */
function dashboardAuth(req, res, next) {
  const token = process.env.DASHBOARD_TOKEN;
  if (!token) return next();

  const fromHeader =
    req.headers["x-dashboard-token"] ||
    (req.headers.authorization && req.headers.authorization.replace(/^Bearer\s+/i, ""));
  const provided = fromHeader || req.query.token;
  if (provided === token) return next();

  if (req.path.startsWith("/api")) {
    return res.status(401).json({ error: "Unauthorized", hint: "Send x-dashboard-token or Bearer token" });
  }
  return res.status(401).type("html").send(getUnauthorizedHtml());
}

function getUnauthorizedHtml() {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Unauthorized</title></head><body>
<p>Set <code>DASHBOARD_TOKEN</code> in the server environment, then open:</p>
<p><code>/dashboard?token=YOUR_TOKEN</code> or <code>/qr?token=YOUR_TOKEN</code></p>
<p>Or save the token in the dashboard (localStorage) after loading with <code>?token=</code> once.</p>
</body></html>`;
}

function createExpressApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", async (req, res) => {
    const dbConnected = mongoose.connection.readyState === 1;
    const payload = {
      status: dbConnected ? "ok" : "degraded",
      database: dbConnected ? "connected" : "disconnected",
    };
    if (dbConnected) {
      try {
        payload.leadsCount = await Lead.countDocuments();
      } catch (err) {
        payload.leadsCount = null;
        payload.dbError = err.message;
      }
    }
    res.status(dbConnected ? 200 : 503).json(payload);
  });

  app.get("/", (req, res) => {
    const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    res.redirect(302, "/dashboard" + qs);
  });

  app.use(dashboardAuth);

  app.get("/dashboard", (req, res) => {
    res.sendFile(path.join(publicDir, "dashboard.html"));
  });

  app.get("/qr", (req, res) => {
    res.sendFile(path.join(publicDir, "qr.html"));
  });

  app.get("/api/leads", async (req, res) => {
    try {
      const leads = await Lead.find().sort({ createdAt: -1 }).lean();
      const normalized = leads.map((doc) => ({
        ...doc,
        status: doc.status || "none",
      }));
      res.json({ leads: normalized });
    } catch (err) {
      logger.error("GET /api/leads: " + err.message);
      res.status(500).json({ error: "Failed to load leads" });
    }
  });

  app.patch("/api/leads/:id", async (req, res) => {
    const { status } = req.body || {};
    if (!isValidStatus(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    try {
      const updated = await Lead.findByIdAndUpdate(
        req.params.id,
        { $set: { status } },
        { new: true, runValidators: true }
      ).lean();
      if (!updated) return res.status(404).json({ error: "Lead not found" });
      res.json({ lead: updated });
    } catch (err) {
      logger.error("PATCH /api/leads/:id: " + err.message);
      res.status(500).json({ error: "Failed to update lead" });
    }
  });

  app.get("/api/whatsapp/qr", async (req, res) => {
    try {
      const state = whatsappState.getState();
      if (state.ready) {
        return res.json({ ready: true, needsScan: false, qrDataUrl: null });
      }
      if (state.qrString) {
        const qrDataUrl = await QRCode.toDataURL(state.qrString, {
          width: 320,
          margin: 2,
          errorCorrectionLevel: "M",
        });
        return res.json({ ready: false, needsScan: true, qrDataUrl });
      }
      return res.json({
        ready: false,
        needsScan: false,
        qrDataUrl: null,
        lastDisconnectReason: state.lastDisconnectReason,
      });
    } catch (err) {
      logger.error("GET /api/whatsapp/qr: " + err.message);
      res.status(500).json({ error: "Failed to build QR" });
    }
  });

  app.use(express.static(publicDir));

  app.use((req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  return app;
}

module.exports = { createExpressApp };
