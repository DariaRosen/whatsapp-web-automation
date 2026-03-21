const express = require("express");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const QRCode = require("qrcode");
const mongoose = require("mongoose");
const Lead = require("./models/Lead");
const { isValidStatus, LEAD_STATUS_DEFAULT } = require("./constants/leadStatuses");
const { isValidServiceTypesArray, SERVICE_TYPE_KEYS } = require("./constants/serviceTypes");
const { normalizePhoneInput } = require("./utils/phone");
const { timingSafeEqualStrings } = require("./utils/cryptoUtils");
const { isHttpsRequest } = require("./utils/httpsRequest");
const whatsappState = require("./whatsappState");
const logger = require("./logger");

const publicDir = path.join(__dirname, "..", "public");

/** HttpOnly session cookie (value matches DASHBOARD_TOKEN; not exposed to JS). */
const DASHBOARD_COOKIE_NAME = "dashboard_auth";

function isQueryTokenDisabled() {
  const v = process.env.DASHBOARD_DISABLE_QUERY_TOKEN;
  return v === "1" || v === "true";
}

/**
 * Optional gate for dashboard + API. If unset, everything is open (dev only).
 */
function dashboardAuth(req, res, next) {
  const token = process.env.DASHBOARD_TOKEN;
  if (!token) return next();

  const fromHeader =
    req.headers["x-dashboard-token"] ||
    (req.headers.authorization && req.headers.authorization.replace(/^Bearer\s+/i, ""));
  const fromCookie = req.cookies && req.cookies[DASHBOARD_COOKIE_NAME];
  const fromQuery = isQueryTokenDisabled() ? undefined : req.query.token;

  const candidates = [fromHeader, fromQuery, fromCookie].filter((x) => typeof x === "string" && x.length > 0);
  for (const c of candidates) {
    if (timingSafeEqualStrings(token, c)) return next();
  }

  if (req.path.startsWith("/api")) {
    return res.status(401).json({
      error: "Unauthorized",
      hint: "Sign in at /login, send x-dashboard-token / Bearer, or use session cookie",
    });
  }
  const returnTo = req.originalUrl || req.url || "/dashboard";
  const nextParam = encodeURIComponent(returnTo);
  return res.redirect(302, "/login?next=" + nextParam);
}

function createExpressApp() {
  const app = express();

  app.set("trust proxy", 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "blob:"],
          connectSrc: ["'self'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    })
  );

  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  const dashboardLoginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 8,
    message: { error: "Too many sign-in attempts. Try again in a few minutes." },
    standardHeaders: true,
    legacyHeaders: false,
    validate: { trustProxy: true },
  });

  app.get("/health", async (req, res) => {
    const dbConnected = mongoose.connection.readyState === 1;
    const payload = {
      status: dbConnected ? "ok" : "degraded",
      database: dbConnected ? "connected" : "disconnected",
    };
    if (dbConnected) {
      try {
        payload.leadsCount = await Lead.countDocuments({ removedAt: null });
      } catch (err) {
        payload.leadsCount = null;
        payload.dbError = err.message;
      }
    }
    res.status(dbConnected ? 200 : 503).json(payload);
  });

  app.get("/", (req, res) => {
    res.redirect(302, "/dashboard");
  });

  /** Public sign-in page when DASHBOARD_TOKEN is set (must be before dashboardAuth). */
  app.get("/login", (req, res) => {
    res.setHeader("Cache-Control", "private, no-store, must-revalidate");
    res.sendFile(path.join(publicDir, "login.html"));
  });

  /**
   * Exchange the dashboard secret for an HttpOnly session cookie (no token in URL).
   * Must stay before dashboardAuth.
   */
  app.post("/api/auth/dashboard-session", dashboardLoginLimiter, (req, res) => {
    const expected = process.env.DASHBOARD_TOKEN;
    if (!expected) {
      return res.status(400).json({ error: "DASHBOARD_TOKEN is not configured" });
    }
    const bodyToken = typeof req.body?.token === "string" ? req.body.token.trim() : "";
    if (!timingSafeEqualStrings(expected, bodyToken)) {
      logger.info("Dashboard sign-in failed (invalid token)");
      return res.status(401).json({ error: "Invalid token" });
    }
    const cookieSecure = isHttpsRequest(req);
    res.cookie(DASHBOARD_COOKIE_NAME, bodyToken, {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    return res.json({ ok: true });
  });

  app.post("/api/auth/dashboard-logout", (req, res) => {
    res.clearCookie(DASHBOARD_COOKIE_NAME, {
      path: "/",
      secure: isHttpsRequest(req),
      sameSite: "lax",
    });
    return res.json({ ok: true });
  });

  app.use(dashboardAuth);

  app.get("/dashboard", (req, res) => {
    res.setHeader("Cache-Control", "private, no-store, must-revalidate");
    res.sendFile(path.join(publicDir, "dashboard.html"));
  });

  app.get("/qr", (req, res) => {
    res.setHeader("Cache-Control", "private, no-store, must-revalidate");
    res.sendFile(path.join(publicDir, "qr.html"));
  });

  function formatLeadDoc(doc) {
    if (!doc) return null;
    return {
      ...doc,
      status: doc.status || "none",
      notes: doc.notes != null ? doc.notes : "",
      serviceTypes: Array.isArray(doc.serviceTypes) ? doc.serviceTypes : [],
    };
  }

  app.get("/api/leads", async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store, must-revalidate");
    try {
      const leads = await Lead.find({ removedAt: null }).sort({ createdAt: -1 }).lean();
      res.json({ leads: leads.map(formatLeadDoc) });
    } catch (err) {
      logger.error("GET /api/leads: " + err.message);
      res.status(500).json({ error: "Failed to load leads" });
    }
  });

  app.patch("/api/leads/:id", async (req, res) => {
    const { status, notes, serviceTypes } = req.body || {};
    const $set = {};

    if (status !== undefined) {
      if (!isValidStatus(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }
      $set.status = status;
    }
    if (notes !== undefined) {
      if (typeof notes !== "string") {
        return res.status(400).json({ error: "Invalid notes" });
      }
      $set.notes = notes.slice(0, 8000);
    }
    if (serviceTypes !== undefined) {
      if (!isValidServiceTypesArray(serviceTypes)) {
        return res.status(400).json({ error: "Invalid serviceTypes" });
      }
      const order = new Map(SERVICE_TYPE_KEYS.map((k, i) => [k, i]));
      $set.serviceTypes = [...new Set(serviceTypes)].sort((a, b) => order.get(a) - order.get(b));
    }

    if (Object.keys($set).length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    try {
      const current = await Lead.findById(req.params.id).lean();
      if (!current || current.removedAt) return res.status(404).json({ error: "Lead not found" });

      const updated = await Lead.findByIdAndUpdate(
        req.params.id,
        { $set },
        { new: true, runValidators: true }
      ).lean();
      if (!updated) return res.status(404).json({ error: "Lead not found" });
      res.json({ lead: formatLeadDoc(updated) });
    } catch (err) {
      logger.error("PATCH /api/leads/:id: " + err.message);
      res.status(500).json({ error: "Failed to update lead" });
    }
  });

  app.delete("/api/leads/:id", async (req, res) => {
    try {
      const updated = await Lead.findOneAndUpdate(
        { _id: req.params.id, removedAt: null },
        { $set: { removedAt: new Date() } },
        { new: true }
      ).lean();
      if (!updated) return res.status(404).json({ error: "Lead not found" });
      logger.info("Lead soft-deleted: " + updated.phone);
      res.json({ ok: true, id: String(updated._id) });
    } catch (err) {
      logger.error("DELETE /api/leads/:id: " + err.message);
      res.status(500).json({ error: "Failed to remove lead" });
    }
  });

  app.post("/api/leads", async (req, res) => {
    const body = req.body || {};
    const phone = normalizePhoneInput(body.phone);
    const firstMessage = typeof body.firstMessage === "string" ? body.firstMessage.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";

    if (!phone) {
      return res.status(400).json({ error: "phone is required" });
    }
    if (!firstMessage) {
      return res.status(400).json({ error: "firstMessage is required" });
    }

    const status =
      body.status !== undefined && isValidStatus(body.status) ? body.status : LEAD_STATUS_DEFAULT;
    let notes = "";
    if (body.notes !== undefined) {
      if (typeof body.notes !== "string") {
        return res.status(400).json({ error: "Invalid notes" });
      }
      notes = body.notes.slice(0, 8000);
    }
    let serviceTypes = [];
    if (body.serviceTypes !== undefined) {
      if (!isValidServiceTypesArray(body.serviceTypes)) {
        return res.status(400).json({ error: "Invalid serviceTypes" });
      }
      const order = new Map(SERVICE_TYPE_KEYS.map((k, i) => [k, i]));
      serviceTypes = [...new Set(body.serviceTypes)].sort((a, b) => order.get(a) - order.get(b));
    }

    try {
      const existing = await Lead.findOne({ phone }).lean();
      if (existing && !existing.removedAt) {
        return res.status(409).json({ error: "A lead with this phone already exists" });
      }

      if (existing && existing.removedAt) {
        const updated = await Lead.findByIdAndUpdate(
          existing._id,
          {
            $set: {
              removedAt: null,
              name,
              firstMessage,
              status,
              notes,
              serviceTypes,
            },
          },
          { new: true, runValidators: true }
        ).lean();
        return res.status(200).json({ lead: formatLeadDoc(updated), reactivated: true });
      }

      const created = await Lead.create({
        phone,
        name,
        firstMessage,
        status,
        notes,
        serviceTypes,
      });
      const doc = created.toObject();
      res.status(201).json({ lead: formatLeadDoc(doc), reactivated: false });
    } catch (err) {
      logger.error("POST /api/leads: " + err.message);
      if (err.code === 11000) {
        return res.status(409).json({ error: "A lead with this phone already exists" });
      }
      res.status(500).json({ error: "Failed to create lead" });
    }
  });

  app.get("/api/whatsapp/qr", async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store, must-revalidate");
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
