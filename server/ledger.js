const fs = require("fs");
const path = require("path");

const SHEET_ID =
  process.env.GOOGLE_SHEET_ID || "1-BfsegzvrqhRZAafrS43MGjfCKCUQ5jKHEIuLZ8zF1s";

function resolveDataDir() {
  if (process.env.DATA_DIR) {
    return path.resolve(process.env.DATA_DIR);
  }
  const volumeDir = "/data";
  try {
    if (fs.existsSync(volumeDir)) {
      fs.accessSync(volumeDir, fs.constants.W_OK);
      return volumeDir;
    }
  } catch {
    // fall through
  }
  return path.join(__dirname, "..", "data");
}

const DATA_DIR = resolveDataDir();
const CSV_LEDGER = path.join(DATA_DIR, "donations.csv");

const CSV_HEADERS = [
  "recorded_at",
  "status",
  "amount",
  "currency",
  "donor_name",
  "donor_email",
  "reference",
  "error_message",
];

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsvRow(row) {
  return CSV_HEADERS.map((key) => csvEscape(row[key] ?? "")).join(",");
}

function ensureCsvHeader() {
  ensureDataDir();
  if (!fs.existsSync(CSV_LEDGER)) {
    fs.writeFileSync(CSV_LEDGER, `${CSV_HEADERS.join(",")}\n`, "utf8");
  }
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

function appendLocalCsv(row) {
  ensureCsvHeader();
  fs.appendFileSync(CSV_LEDGER, `${toCsvRow(row)}\n`, "utf8");
}

function readLocalCsv() {
  if (!fs.existsSync(CSV_LEDGER)) return [];
  const lines = fs
    .readFileSync(CSV_LEDGER, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length <= 1) return [];
  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const row = {};
    header.forEach((key, index) => {
      row[key] = cells[index] ?? "";
    });
    return row;
  });
}

function webhookUrl() {
  return String(process.env.DONATION_LEDGER_WEBHOOK_URL || "").trim();
}

function exportUrl() {
  return String(
    process.env.DONATION_LEDGER_EXPORT_URL || process.env.DONATION_LEDGER_WEBHOOK_URL || "",
  ).trim();
}

async function appendRemoteSheet(row) {
  const webhook = webhookUrl();
  if (!webhook) return { skipped: true };

  const response = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(row),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Sheet webhook failed (${response.status}): ${text}`);
  }
  return { ok: true, body: text };
}

async function readRemoteSheet() {
  const url = exportUrl();
  if (!url) return null;

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Sheet export failed (${response.status})`);
  }
  const payload = await response.json();
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.donations)) return payload.donations;
  return [];
}

function toRow(donation) {
  return {
    recorded_at: donation.whenIso || donation.recorded_at || new Date().toISOString(),
    status: donation.status || "approved",
    amount: donation.amount,
    currency: donation.currency,
    donor_name: donation.name || donation.donor_name || "",
    donor_email: donation.email || donation.donor_email || "",
    reference: donation.reference || "",
    error_message: donation.error_message || "",
  };
}

async function recordDonation(donation) {
  const row = toRow(donation);

  // Local mirror helps local testing; production durability is the Sheet.
  try {
    appendLocalCsv(row);
  } catch (error) {
    console.warn("[ledger] local csv append failed:", error.message);
  }

  try {
    const remote = await appendRemoteSheet(row);
    if (remote?.skipped) {
      console.warn(
        "[ledger] DONATION_LEDGER_WEBHOOK_URL missing; saved locally only (ephemeral on App Platform)",
      );
    }
  } catch (error) {
    // Never fail the donor experience if the Sheet webhook is down.
    console.error("[ledger] sheet append failed:", error.message);
  }

  return row;
}

async function readDonations() {
  try {
    const remote = await readRemoteSheet();
    if (remote) return remote;
  } catch (error) {
    console.warn("[ledger] sheet read failed, falling back to local:", error.message);
  }
  return readLocalCsv();
}

function readLocalDonations() {
  return readLocalCsv();
}

function summarizeWeek(donations, now = new Date()) {
  const end = new Date(now);
  const start = new Date(now);
  const day = start.getDay();
  const daysSinceMonday = (day + 6) % 7;
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - daysSinceMonday - 7);
  end.setTime(start.getTime());
  end.setDate(start.getDate() + 7);

  const approved = donations.filter((row) => {
    if (row.status && row.status !== "approved") return false;
    const at = new Date(row.recorded_at);
    return at >= start && at < end;
  });

  const totals = { USD: 0, ZMW: 0 };
  approved.forEach((row) => {
    const currency = String(row.currency || "").toUpperCase();
    if (totals[currency] == null) totals[currency] = 0;
    totals[currency] += Number(row.amount) || 0;
  });

  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    count: approved.length,
    totals,
    rows: approved,
  };
}

function ledgerReady() {
  if (webhookUrl()) return true;
  try {
    ensureDataDir();
    fs.accessSync(DATA_DIR, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function donationsToCsv(rows) {
  const lines = [CSV_HEADERS.join(",")];
  rows.forEach((row) => {
    lines.push(toCsvRow(toRow(row)));
  });
  return `${lines.join("\n")}\n`;
}

module.exports = {
  recordDonation,
  readDonations,
  readLocalDonations,
  summarizeWeek,
  ledgerReady,
  donationsToCsv,
  CSV_HEADERS,
  CSV_LEDGER,
  DATA_DIR,
  SHEET_ID,
};
