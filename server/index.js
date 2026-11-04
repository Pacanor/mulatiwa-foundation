const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const express = require("express");
const dotenv = require("dotenv");
const cron = require("node-cron");
const { createCaptureContext } = require("./cybersource");
const { enrichDonation } = require("./donations");
const {
  recordDonation,
  ledgerReady,
  readDonations,
  readLocalDonations,
  donationsToCsv,
  CSV_LEDGER,
  DATA_DIR,
  SHEET_ID,
} = require("./ledger");
const {
  sendDonationEmails,
  sendFailedDonationEmail,
  donorThankYouHtml,
  donorFailedHtml,
  staffNotifyHtml,
} = require("./mail");
const { verifyReportToken } = require("./report-token");
const { renderReportPage, resolveRange, filterDonations } = require("./report-page");
const { runWeeklyReport } = require("./weekly-report");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.PORT) || 8080;
const ALLOWED_CURRENCIES = new Set(["USD", "ZMW"]);
const MAX_AMOUNT = {
  USD: 25000,
  ZMW: 500000,
};
const MIN_AMOUNT = {
  USD: 1,
  ZMW: 10,
};

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function normalizeOrigin(value) {
  return String(value || "")
    .trim()
    .replace(/\/$/, "");
}

function parseAllowedOrigins() {
  const raw = process.env.TARGET_ORIGINS || "";
  const fromEnv = raw
    .split(",")
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean)
    .filter((origin) => origin.startsWith("https://"));

  const publicSite = normalizeOrigin(process.env.PUBLIC_SITE_URL);
  if (publicSite.startsWith("https://") && !fromEnv.includes(publicSite)) {
    fromEnv.push(publicSite);
  }

  return fromEnv;
}

function requestSelfOrigin(req) {
  const host = normalizeOrigin(req.get("x-forwarded-host") || req.get("host"));
  if (!host) return null;
  const proto = String(req.get("x-forwarded-proto") || "https")
    .split(",")[0]
    .trim();
  if (proto !== "https") return null;
  // Host may include a port; Origin never includes default 443.
  const hostname = host.split(",")[0].trim();
  return normalizeOrigin(`https://${hostname}`);
}

function resolveRequestOrigin(req) {
  const allowed = new Set(parseAllowedOrigins());
  const selfOrigin = requestSelfOrigin(req);
  // Always trust the deployment's own HTTPS origin (covers new App Platform URLs).
  if (selfOrigin) {
    allowed.add(selfOrigin);
  }

  const headerOrigin = normalizeOrigin(req.get("origin"));
  if (headerOrigin && allowed.has(headerOrigin)) {
    return headerOrigin;
  }

  const referer = String(req.get("referer") || "").trim();
  if (referer) {
    try {
      const refererOrigin = normalizeOrigin(new URL(referer).origin);
      if (allowed.has(refererOrigin)) {
        return refererOrigin;
      }
    } catch {
      // ignore invalid referer
    }
  }

  // Same-origin fetch from the donate page may omit Origin in some proxies;
  // fall back to this host when it is HTTPS.
  if (selfOrigin && allowed.has(selfOrigin)) {
    return selfOrigin;
  }

  return null;
}

function normalizeAmount(value, currency) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return null;
  }
  const rounded = Math.round(amount * 100) / 100;
  if (rounded < MIN_AMOUNT[currency] || rounded > MAX_AMOUNT[currency]) {
    return null;
  }
  return rounded.toFixed(2);
}

function loadDevHttpsOptions() {
  const keyPath = path.join(__dirname, "certs", "dev-key.pem");
  const certPath = path.join(__dirname, "certs", "dev-cert.pem");
  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    return null;
  }
  return {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  };
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));

app.get("/api/health", async (_req, res) => {
  let donationCount = 0;
  try {
    donationCount = (await readDonations()).length;
  } catch {
    try {
      donationCount = readLocalDonations().length;
    } catch {
      donationCount = 0;
    }
  }
  res.json({
    status: "ok",
    cybs_env: process.env.CYBS_ENV || "test",
    donate_ready: Boolean(
      process.env.MERCHANT_ID && process.env.CYBS_KEY_ID && process.env.CYBS_SECRET_KEY,
    ),
    mail_ready: Boolean(process.env.RESEND_API_KEY),
    ledger_ready: ledgerReady(),
    ledger_sheet: Boolean(process.env.DONATION_LEDGER_WEBHOOK_URL),
    ledger_dir: DATA_DIR,
    google_sheet_id: SHEET_ID,
    donation_count: donationCount,
  });
});

app.post("/api/donate/session", async (req, res) => {
  try {
    const currency = String(req.body?.currency || "")
      .trim()
      .toUpperCase();
    if (!ALLOWED_CURRENCIES.has(currency)) {
      return res.status(400).json({
        error: "Please choose USD or ZMW to continue.",
      });
    }

    const amount = normalizeAmount(req.body?.amount, currency);
    if (!amount) {
      return res.status(400).json({
        error: `Please enter an amount between ${MIN_AMOUNT[currency]} and ${MAX_AMOUNT[currency].toLocaleString("en-ZM")} ${currency}.`,
      });
    }

    // Unified Checkout requires every listed targetOrigin to match the page.
    // Send only the caller's origin (must be in TARGET_ORIGINS allowlist).
    const requestOrigin = resolveRequestOrigin(req);
    if (!requestOrigin) {
      return res.status(403).json({
        error: "We're having some trouble proceeding right now. Please try again later.",
      });
    }

    const session = await createCaptureContext({
      merchantId: requireEnv("MERCHANT_ID"),
      keyId: requireEnv("CYBS_KEY_ID"),
      secretKey: requireEnv("CYBS_SECRET_KEY"),
      env: process.env.CYBS_ENV === "production" ? "production" : "test",
      targetOrigins: [requestOrigin],
      amount,
      currency,
    });

    return res.json({
      amount,
      currency,
      capture_context: session.capture_context,
      client_library: session.client_library,
      client_library_integrity: session.client_library_integrity,
    });
  } catch (error) {
    console.error("[donate/session]", error.message, error.details || "");
    const status = error.status && error.status >= 400 && error.status < 600 ? error.status : 502;
    return res.status(status).json({
      error: "We're having some trouble proceeding right now. Please try again later.",
      detail: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

app.post("/api/donate/complete", async (req, res) => {
  try {
    const status = String(req.body?.status || "approved").toLowerCase();
    const currency = String(req.body?.currency || "")
      .trim()
      .toUpperCase();
    const amount = normalizeAmount(req.body?.amount, currency);
    if (!amount || !ALLOWED_CURRENCIES.has(currency)) {
      return res.status(400).json({ error: "Invalid donation details." });
    }

    const normalizedStatus =
      status === "approved" ? "approved" : status === "declined" ? "declined" : "failed";

    const donation = await enrichDonation({
      amount,
      currency,
      reference: req.body?.reference || "",
      resultJwt: req.body?.result_jwt || "",
      status: normalizedStatus,
      errorMessage: req.body?.error_message || "",
    });

    // Prefer client-provided contact fields when Payment Details is unavailable.
    if (!donation.email && req.body?.email) donation.email = String(req.body.email).trim();
    if (!donation.name && req.body?.name) donation.name = String(req.body.name).trim();

    // Allow backdated SEED-* rows for report demos without affecting live checkout.
    if (
      String(donation.reference || "").startsWith("SEED-") &&
      req.body?.when_iso &&
      !Number.isNaN(Date.parse(req.body.when_iso))
    ) {
      donation.whenIso = new Date(req.body.when_iso).toISOString();
    }

    await recordDonation(donation);

    if (normalizedStatus === "approved") {
      await sendDonationEmails(donation);
    } else {
      await sendFailedDonationEmail(donation);
    }

    return res.json({
      ok: true,
      recorded: true,
      donor_email_sent: Boolean(donation.email),
      reference: donation.reference,
      status: normalizedStatus,
    });
  } catch (error) {
    console.error("[donate/complete]", error.message);
    return res.status(500).json({
      error: "We're having some trouble proceeding right now. Please try again later.",
    });
  }
});

// Obscure staff donations log — requires signed ?t= token from donation emails.
app.get("/internal/giving", async (req, res) => {
  const token = String(req.query.t || "");
  if (!verifyReportToken(token)) {
    return res.redirect(302, "/");
  }

  try {
    const donations = await readDonations();
    res.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    res.set("Cache-Control", "no-store");
    res.type("html").send(
      renderReportPage({
        periodInput: req.query.period,
        fromInput: req.query.from,
        toInput: req.query.to,
        token,
        donations,
      }),
    );
  } catch (error) {
    console.error("[giving]", error.message);
    return res.status(500).type("text").send("Could not load donations log.");
  }
});

app.get("/internal/giving.csv", async (req, res) => {
  const token = String(req.query.t || "");
  if (!verifyReportToken(token)) {
    return res.redirect(302, "/");
  }

  try {
    const donations = await readDonations();
    const { from, to } = resolveRange({
      periodInput: req.query.period,
      fromInput: req.query.from,
      toInput: req.query.to,
    });
    const rows = filterDonations(donations, from, to);
    res.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    res.set("Cache-Control", "no-store");
    res.set(
      "Content-Disposition",
      `attachment; filename="mulatiwa-donations-${req.query.period || "custom"}.csv"`,
    );
    res.type("text/csv").send(donationsToCsv(rows));
  } catch (error) {
    console.error("[giving.csv]", error.message);
    return res.status(500).type("text").send("Could not export donations.");
  }
});

app.post("/internal/giving/weekly-preview", async (req, res) => {
  const token = String(req.body?.t || req.query.t || "");
  if (!verifyReportToken(token)) {
    return res.status(403).json({ error: "Invalid or expired report link." });
  }

  try {
    const to = String(req.body?.email || "papiasb@gmail.com").trim();
    const summary = await runWeeklyReport({ to });
    return res.json({
      ok: true,
      sent_to: to,
      approved: summary.count,
      totals: summary.totals,
    });
  } catch (error) {
    console.error("[weekly-preview]", error.message);
    return res.status(500).json({ error: error.message });
  }
});

// Browser preview of branded donation emails (no send).
app.get("/api/donate/email-preview", (req, res) => {
  const kind = String(req.query.kind || "donor").toLowerCase();
  const donation = {
    amount: req.query.amount || "50.00",
    currency: String(req.query.currency || "USD").toUpperCase(),
    name: req.query.name || "Papias",
    email: req.query.email || "papiasb@gmail.com",
    reference: req.query.reference || "PREVIEW-REF",
    whenIso: new Date().toISOString(),
    error_message: req.query.error || "The issuing bank declined this payment.",
  };

  let html = donorThankYouHtml(donation);
  if (kind === "staff") html = staffNotifyHtml(donation);
  if (kind === "failed") html = donorFailedHtml(donation);
  res.type("html").send(html);
});

// Dev helper: send sample donor + staff emails without a live payment.
app.post("/api/donate/test-email", async (req, res) => {
  const allowed =
    process.env.ALLOW_TEST_EMAIL === "true" || process.env.NODE_ENV !== "production";
  if (!allowed) {
    return res.status(403).json({ error: "Test email endpoint disabled." });
  }
  if (!process.env.RESEND_API_KEY) {
    return res.status(400).json({
      error: "Set RESEND_API_KEY in .env before testing emails.",
    });
  }

  try {
    const donation = {
      amount: req.body?.amount || "50.00",
      currency: String(req.body?.currency || "USD").toUpperCase(),
      name: req.body?.name || "Test Donor",
      email: req.body?.email || process.env.TEST_DONOR_EMAIL || "",
      reference: req.body?.reference || `TEST-${Date.now()}`,
      whenIso: new Date().toISOString(),
      status: "approved",
    };

    if (!donation.email) {
      return res.status(400).json({
        error: "Provide email in the body, or set TEST_DONOR_EMAIL in .env.",
      });
    }

    await sendDonationEmails(donation);
    return res.json({
      ok: true,
      sent_to_donor: donation.email,
      sent_to_staff: process.env.DONATION_NOTIFY_EMAIL || "e.munalula@mulatiwafoundation.org",
    });
  } catch (error) {
    console.error("[donate/test-email]", error.message);
    return res.status(500).json({ error: error.message });
  }
});

app.use(express.static(ROOT, { extensions: ["html"], index: "index.html" }));

app.use((_req, res) => {
  res.status(404).type("text").send("Not found");
});

if (process.env.WEEKLY_REPORT_CRON !== "false") {
  // Monday 08:30 Africa/Lusaka (CAT)
  cron.schedule(
    "30 8 * * 1",
    () => {
      runWeeklyReport().catch((error) => {
        console.error("[weekly-report]", error.message);
      });
    },
    { timezone: "Africa/Lusaka" },
  );
  console.log("Weekly donation report scheduled for Mondays 08:30 Africa/Lusaka");
}

const useHttps = process.env.DEV_HTTPS !== "false";
const httpsOptions = useHttps ? loadDevHttpsOptions() : null;

function logLedgerStartup() {
  try {
    const count = readLocalDonations().length;
    console.log(`[ledger] DATA_DIR=${DATA_DIR} file=${CSV_LEDGER} rows=${count}`);
  } catch (error) {
    console.warn("[ledger] startup check failed:", error.message);
  }
}

if (httpsOptions) {
  https.createServer(httpsOptions, app).listen(PORT, () => {
    console.log(`Mulatiwa Foundation listening on https://localhost:${PORT}`);
    console.log("Accept the self-signed certificate warning once, then open /donate.html");
    logLedgerStartup();
  });
} else {
  http.createServer(app).listen(PORT, () => {
    console.log(`Mulatiwa Foundation listening on http://localhost:${PORT}`);
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "Cybersource requires HTTPS targetOrigins. Add server/certs or set TARGET_ORIGINS to your HTTPS deploy URL.",
      );
    }
    logLedgerStartup();
  });
}
