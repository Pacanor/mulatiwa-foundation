const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "..", "data");
const CSV_LEDGER = path.join(DATA_DIR, "donations.csv");
const LEGACY_JSONL = path.join(DATA_DIR, "donations.jsonl");

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
    return;
  }

  // Migrate older ledgers that predate error_message.
  const existing = fs.readFileSync(CSV_LEDGER, "utf8");
  const firstLine = existing.split(/\r?\n/)[0] || "";
  if (firstLine && !firstLine.split(",").includes("error_message")) {
    const lines = existing.split(/\r?\n/);
    lines[0] = CSV_HEADERS.join(",");
    const rest = lines.slice(1).map((line) => {
      if (!line.trim()) return line;
      return `${line},`;
    });
    fs.writeFileSync(CSV_LEDGER, [lines[0], ...rest].join("\n"), "utf8");
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

function appendCsv(row) {
  ensureCsvHeader();
  fs.appendFileSync(CSV_LEDGER, `${toCsvRow(row)}\n`, "utf8");
}

async function recordDonation(donation) {
  const row = {
    recorded_at: donation.whenIso || new Date().toISOString(),
    status: donation.status || "approved",
    amount: donation.amount,
    currency: donation.currency,
    donor_name: donation.name || "",
    donor_email: donation.email || "",
    reference: donation.reference || "",
    error_message: donation.error_message || "",
  };

  appendCsv(row);
  return row;
}

function readCsvDonations() {
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

function readLegacyJsonl() {
  if (!fs.existsSync(LEGACY_JSONL)) return [];
  return fs
    .readFileSync(LEGACY_JSONL, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function readLocalDonations() {
  const csvRows = readCsvDonations();
  if (csvRows.length) return csvRows;
  // Fall back once if an older local JSONL log still exists.
  return readLegacyJsonl();
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
  try {
    ensureDataDir();
    fs.accessSync(DATA_DIR, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  recordDonation,
  readLocalDonations,
  summarizeWeek,
  ledgerReady,
  CSV_LEDGER,
  DATA_DIR,
};
