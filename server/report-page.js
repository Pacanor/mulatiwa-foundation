const { formatMoney } = require("./mail");
const { createReportToken } = require("./report-token");

const TIME_ZONE = "Africa/Lusaka";
const PRESETS = ["today", "week", "month", "quarter", "year", "custom"];

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function zonedYmd(date = new Date(), timeZone = TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function parseDay(value, fallback) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return fallback;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function endOfDayUtc(date) {
  const end = new Date(date);
  end.setUTCHours(23, 59, 59, 999);
  return end;
}

function startOfDayUtc(date) {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

function addDaysYmd(ymd, days) {
  const date = new Date(`${ymd}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function weekdayInZone(date = new Date(), timeZone = TIME_ZONE) {
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(date);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(label);
}

function rangeForPreset(preset, now = new Date()) {
  const today = zonedYmd(now);
  const [year, month] = today.split("-").map(Number);

  if (preset === "today") {
    return {
      from: startOfDayUtc(parseDay(today)),
      to: endOfDayUtc(parseDay(today)),
      fromValue: today,
      toValue: today,
    };
  }

  if (preset === "week") {
    const dow = weekdayInZone(now);
    const daysFromMonday = (dow + 6) % 7;
    const fromValue = addDaysYmd(today, -daysFromMonday);
    return {
      from: startOfDayUtc(parseDay(fromValue)),
      to: endOfDayUtc(parseDay(today)),
      fromValue,
      toValue: today,
    };
  }

  if (preset === "month") {
    const fromValue = `${year}-${String(month).padStart(2, "0")}-01`;
    return {
      from: startOfDayUtc(parseDay(fromValue)),
      to: endOfDayUtc(parseDay(today)),
      fromValue,
      toValue: today,
    };
  }

  if (preset === "quarter") {
    const quarterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
    const fromValue = `${year}-${String(quarterStartMonth).padStart(2, "0")}-01`;
    return {
      from: startOfDayUtc(parseDay(fromValue)),
      to: endOfDayUtc(parseDay(today)),
      fromValue,
      toValue: today,
    };
  }

  if (preset === "year") {
    const fromValue = `${year}-01-01`;
    return {
      from: startOfDayUtc(parseDay(fromValue)),
      to: endOfDayUtc(parseDay(today)),
      fromValue,
      toValue: today,
    };
  }

  const fromValue = addDaysYmd(today, -29);
  return {
    from: startOfDayUtc(parseDay(fromValue)),
    to: endOfDayUtc(parseDay(today)),
    fromValue,
    toValue: today,
  };
}

function previousComparableRange(period, from, to) {
  const fromYmd = from.toISOString().slice(0, 10);
  const [year, month, day] = fromYmd.split("-").map(Number);

  if (period === "today") {
    const ymd = addDaysYmd(fromYmd, -1);
    return {
      from: startOfDayUtc(parseDay(ymd)),
      to: endOfDayUtc(parseDay(ymd)),
      label: "yesterday",
    };
  }

  if (period === "week") {
    const prevFrom = addDaysYmd(fromYmd, -7);
    const prevTo = addDaysYmd(fromYmd, -1);
    return {
      from: startOfDayUtc(parseDay(prevFrom)),
      to: endOfDayUtc(parseDay(prevTo)),
      label: "last week",
    };
  }

  if (period === "month") {
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const prevFrom = `${prevYear}-${String(prevMonth).padStart(2, "0")}-01`;
    const prevTo = `${prevYear}-${String(prevMonth).padStart(2, "0")}-${String(
      daysInMonth(prevYear, prevMonth),
    ).padStart(2, "0")}`;
    return {
      from: startOfDayUtc(parseDay(prevFrom)),
      to: endOfDayUtc(parseDay(prevTo)),
      label: "last month",
    };
  }

  if (period === "quarter") {
    const currentQuarter = Math.floor((month - 1) / 3); // 0-3
    const prevQuarter = currentQuarter === 0 ? 3 : currentQuarter - 1;
    const prevYear = currentQuarter === 0 ? year - 1 : year;
    const startMonth = prevQuarter * 3 + 1;
    const endMonth = startMonth + 2;
    const prevFrom = `${prevYear}-${String(startMonth).padStart(2, "0")}-01`;
    const prevTo = `${prevYear}-${String(endMonth).padStart(2, "0")}-${String(
      daysInMonth(prevYear, endMonth),
    ).padStart(2, "0")}`;
    return {
      from: startOfDayUtc(parseDay(prevFrom)),
      to: endOfDayUtc(parseDay(prevTo)),
      label: "last quarter",
    };
  }

  if (period === "year") {
    const prevFrom = `${year - 1}-01-01`;
    const prevTo = `${year - 1}-12-31`;
    return {
      from: startOfDayUtc(parseDay(prevFrom)),
      to: endOfDayUtc(parseDay(prevTo)),
      label: "last year",
    };
  }

  const durationMs = Math.max(to.getTime() - from.getTime(), 24 * 60 * 60 * 1000);
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - durationMs);
  return { from: prevFrom, to: prevTo, label: "prior period" };
}

function filterDonations(donations, from, to) {
  return donations
    .filter((row) => {
      const at = new Date(row.recorded_at);
      return !Number.isNaN(at.getTime()) && at >= from && at <= to;
    })
    .sort((a, b) => new Date(b.recorded_at) - new Date(a.recorded_at));
}

function summarize(rows) {
  const approved = rows.filter((row) => row.status === "approved");
  const failed = rows.filter((row) => row.status !== "approved");
  const totals = {};
  approved.forEach((row) => {
    const currency = String(row.currency || "").toUpperCase();
    totals[currency] = (totals[currency] || 0) + (Number(row.amount) || 0);
  });
  return { approved, failed, totals };
}

function formatTotals(totals) {
  const line = Object.entries(totals)
    .filter(([, value]) => value > 0)
    .map(([currency, value]) => formatMoney(value, currency))
    .join(" · ");
  return line || "None";
}

function formatTotalsHtml(totals) {
  const parts = Object.entries(totals)
    .filter(([, value]) => value > 0)
    .map(
      ([currency, value]) =>
        `<span class="total-amt">${escapeHtml(formatMoney(value, currency))}</span>`,
    );
  return parts.length ? parts.join("") : `<span class="total-amt">None</span>`;
}

const EXPORT_HEADERS = [
  "When (CAT)",
  "Status",
  "Amount",
  "Currency",
  "Donor",
  "Email",
  "Reference",
  "Note",
];

function csvEscapeCell(value) {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function buildExportCsv(rows) {
  const { approved, failed, totals } = summarize(rows);
  const lines = [EXPORT_HEADERS.join(",")];

  rows.forEach((row) => {
    const when = new Date(row.recorded_at);
    let whenLabel = String(row.recorded_at || "");
    if (!Number.isNaN(when.getTime())) {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).formatToParts(when);
      const get = (type) => parts.find((part) => part.type === type)?.value || "";
      whenLabel = `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
    }
    const amount = Number(row.amount);
    const amountText = Number.isFinite(amount) ? amount.toFixed(2) : String(row.amount || "");
    lines.push(
      [
        whenLabel,
        row.status || "",
        amountText,
        String(row.currency || "").toUpperCase(),
        row.donor_name || "",
        row.donor_email || "",
        row.reference || "",
        row.error_message || "",
      ]
        .map(csvEscapeCell)
        .join(","),
    );
  });

  lines.push("");
  lines.push(["Totals", "", "", "", "", "", "", ""].join(","));
  lines.push(
    ["Approved donations", String(approved.length), "", "", "", "", "", ""].map(csvEscapeCell).join(","),
  );
  lines.push(
    ["Unsuccessful donations", String(failed.length), "", "", "", "", "", ""]
      .map(csvEscapeCell)
      .join(","),
  );
  Object.entries(totals)
    .filter(([, value]) => value > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([currency, value]) => {
      lines.push(
        [`Approved total (${currency})`, Number(value).toFixed(2), currency, "", "", "", "", ""]
          .map(csvEscapeCell)
          .join(","),
      );
    });
  if (!Object.values(totals).some((value) => value > 0)) {
    lines.push(["Approved total", "0.00", "", "", "", "", "", ""].map(csvEscapeCell).join(","));
  }

  return `${lines.join("\n")}\n`;
}

function exportFilename({ period, fromValue, toValue }) {
  const safePeriod = String(period || "custom").replace(/[^a-z0-9_-]/gi, "");
  return `mulatiwa-donations-${safePeriod}-${fromValue}-to-${toValue}.csv`;
}

function compareCount(current, previous, label) {
  const diff = current - previous;
  if (diff === 0) return `Same as ${label}`;
  if (diff > 0) return `+${diff} vs ${label}`;
  return `${diff} vs ${label}`;
}

function compareTotals(currentTotals, previousTotals, label) {
  const currencies = [...new Set([...Object.keys(currentTotals), ...Object.keys(previousTotals)])];
  if (!currencies.length) return `Same as ${label}`;

  const parts = currencies
    .map((currency) => {
      const current = Number(currentTotals[currency] || 0);
      const previous = Number(previousTotals[currency] || 0);
      const diff = Math.round((current - previous) * 100) / 100;
      if (diff === 0) return null;
      return `${diff > 0 ? "+" : "−"}${formatMoney(Math.abs(diff), currency)}`;
    })
    .filter(Boolean);

  if (!parts.length) return `Same as ${label}`;
  return `${parts.join(" · ")} vs ${label}`;
}

function renderRows(rows) {
  if (!rows.length) {
    return `<tr><td colspan="4" class="empty">No donations in this period.</td></tr>`;
  }
  return rows
    .map((row, index) => {
      const when = new Date(row.recorded_at).toLocaleString("en-ZM", {
        timeZone: TIME_ZONE,
        dateStyle: "medium",
        timeStyle: "short",
      });
      const status = String(row.status || "unknown");
      const statusClass = status === "approved" ? "is-approved" : "is-failed";
      const money = formatMoney(row.amount, row.currency);
      return `
      <tr class="donation-row" data-row-index="${index}" data-txn-id="${escapeHtml(row.id || row.reference || "")}" tabindex="0" role="button" aria-label="View donation details">
        <td>${escapeHtml(when)}</td>
        <td><span class="status ${statusClass}">${escapeHtml(status)}</span></td>
        <td><strong>${escapeHtml(money)}</strong></td>
        <td>${escapeHtml(row.donor_name || "—")}</td>
      </tr>`;
    })
    .join("");
}

function resolveRange({ periodInput, fromInput, toInput }) {
  const period = PRESETS.includes(periodInput) ? periodInput : "week";
  if (period === "custom") {
    const fallback = rangeForPreset("week");
    const fromValue = fromInput || fallback.fromValue;
    const toValue = toInput || fallback.toValue;
    const from = startOfDayUtc(parseDay(fromValue, fallback.from));
    const to = endOfDayUtc(parseDay(toValue, fallback.to));
    return {
      period,
      from,
      to,
      fromValue: from.toISOString().slice(0, 10),
      toValue: to.toISOString().slice(0, 10),
    };
  }
  return { period, ...rangeForPreset(period) };
}

function renderReportPage({ periodInput, fromInput, toInput, token, donations, cybsEnv }) {
  const nextToken = createReportToken() || token;
  const { period, from, to, fromValue, toValue } = resolveRange({
    periodInput,
    fromInput,
    toInput,
  });

  const rows = filterDonations(donations || [], from, to);
  const prev = previousComparableRange(period, from, to);
  const previousRows = filterDonations(donations || [], prev.from, prev.to);

  const current = summarize(rows);
  const prior = summarize(previousRows);
  const totalsHtml = formatTotalsHtml(current.totals);
  const compareLabel = prev.label;
  const pageSize = 10;
  const totalRows = rows.length;

  const approvedCompare = compareCount(
    current.approved.length,
    prior.approved.length,
    compareLabel,
  );
  const failedCompare = compareCount(current.failed.length, prior.failed.length, compareLabel);
  const totalsCompare = compareTotals(current.totals, prior.totals, compareLabel);

  const presetButtons = [
    ["today", "Today"],
    ["week", "This week"],
    ["month", "This month"],
    ["quarter", "This quarter"],
    ["year", "This year"],
    ["custom", "Custom"],
  ]
    .map(([value, label]) => {
      const active = period === value ? " is-active" : "";
      return `<button type="button" class="period-btn${active}" data-period="${value}">${label}</button>`;
    })
    .join("");

  const queryBase = `t=${encodeURIComponent(nextToken)}`;
  const exportHref = `/internal/giving.csv?${queryBase}&period=${encodeURIComponent(period)}${
    period === "custom"
      ? `&from=${encodeURIComponent(fromValue)}&to=${encodeURIComponent(toValue)}`
      : ""
  }`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow, noarchive" />
  <meta name="theme-color" content="#1B5EA8" />
  <title>Donations log · Mulatiwa Foundation</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Source+Sans+3:ital,wght@0,400;0,600;0,700;0,800&display=swap" rel="stylesheet" />
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='16' fill='%231B5EA8'/%3E%3Ctext x='32' y='42' text-anchor='middle' font-family='Georgia,serif' font-size='22' font-weight='700' fill='%23E8C23A'%3EMF%3C/text%3E%3C/svg%3E" />
  <style>
    :root {
      --navy: #123a6d; --navy-deep: #0c2a52; --blue: #1b5ea8; --gold: #e8c23a;
      --cream: #f6f3ea; --paper: #fffdf8; --ink: #17212b; --muted: #66727e;
      --fail: #9b1b1b; --ok: #0f6b3c; --ok-soft: #e7f5ec; --fail-soft: #f8e8e8;
      --navy-soft: #e8eef6; --line: rgba(18, 58, 109, 0.14); --radius: 28px;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; color: var(--ink);
      background:
        radial-gradient(ellipse 80% 50% at 10% -10%, rgba(27, 94, 168, 0.18), transparent 55%),
        radial-gradient(ellipse 60% 40% at 90% 0%, rgba(232, 194, 58, 0.16), transparent 50%),
        linear-gradient(180deg, #eef3f8 0%, var(--cream) 42%, var(--paper) 100%);
      font-family: "Source Sans 3", "Helvetica Neue", Arial, sans-serif;
      font-size: 16px; line-height: 1.6; min-height: 100vh;
      -webkit-font-smoothing: antialiased;
    }
    a { color: inherit; text-decoration: none; }
    .shell { width: min(1100px, calc(100% - 40px)); margin: 0 auto; padding: 28px 0 72px; }
    .topbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 28px; }
    .brand { display: inline-flex; align-items: center; gap: 12px; color: var(--navy); }
    .brand-mark {
      width: 44px; height: 44px; border-radius: 14px; background: var(--navy); color: var(--gold);
      display: grid; place-items: center; font-family: Georgia, "Times New Roman", serif; font-weight: 700; font-size: 15px;
    }
    .brand strong { display: block; font-size: 1.05rem; line-height: 1.1; }
    .brand small { display: block; color: var(--muted); font-size: 0.82rem; font-weight: 600; }
    .panel {
      position: relative; background: rgba(255, 253, 248, 0.92); border: 1px solid var(--line);
      border-radius: var(--radius); padding: clamp(24px, 4vw, 36px);
      box-shadow: 0 24px 60px rgba(18, 58, 109, 0.08); backdrop-filter: blur(8px); overflow: hidden;
    }
    .panel::before {
      content: ""; position: absolute; left: 0; right: 0; top: 0; height: 4px;
      background: linear-gradient(90deg, var(--navy), var(--blue) 55%, var(--gold));
    }
    .eyebrow { margin: 0 0 10px; color: var(--blue); font-size: 12px; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase; }
    h1 {
      margin: 0 0 28px; font-family: Georgia, "Times New Roman", serif; color: var(--navy);
      font-size: clamp(2rem, 3.4vw, 2.7rem); line-height: 1.1; letter-spacing: -0.03em;
    }
    .stats { display: grid; grid-template-columns: 3fr 3fr 6fr; gap: 14px; margin: 0 0 28px; }
    .stat { border-radius: 20px; padding: 16px 16px 14px; border: 1px solid transparent; min-height: 110px; }
    .stat-ok { background: var(--ok-soft); border-color: rgba(15, 107, 60, 0.18); }
    .stat-fail { background: var(--fail-soft); border-color: rgba(155, 27, 27, 0.16); }
    .stat-total { background: var(--navy-soft); border-color: rgba(18, 58, 109, 0.16); }
    .stat .label { display: block; font-size: 12px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; }
    .stat-ok .label { color: var(--ok); }
    .stat-fail .label { color: var(--fail); }
    .stat-total .label { color: var(--navy); }
    .stat strong {
      display: block; margin-top: 8px; font-family: Georgia, "Times New Roman", serif;
      font-size: clamp(1.7rem, 2.6vw, 2.15rem); line-height: 1.1; letter-spacing: -0.02em;
    }
    .stat-ok strong { color: var(--ok); }
    .stat-fail strong { color: var(--fail); }
    .stat-total .totals-row {
      display: flex; flex-wrap: nowrap; align-items: baseline; gap: 1.1rem;
      margin-top: 8px; color: var(--navy); font-family: Georgia, "Times New Roman", serif;
      font-size: clamp(1.35rem, 2.1vw, 1.85rem); line-height: 1.15; letter-spacing: -0.02em;
      font-weight: 700; white-space: nowrap; overflow: hidden;
    }
    .stat-total .total-amt { display: inline-block; }
    .stat .compare { margin-top: 10px; font-size: 13px; font-weight: 600; line-height: 1.35; color: var(--muted); }
    .toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; margin: 0 0 18px; }
    .period-group {
      display: inline-flex; flex-wrap: wrap; gap: 0; padding: 4px; border-radius: 999px;
      border: 1px solid var(--line); background: #fff;
    }
    .period-btn {
      border: 0; background: transparent; color: var(--navy); min-height: 40px; padding: 0 14px;
      border-radius: 999px; font: inherit; font-size: 13px; font-weight: 700; cursor: pointer;
    }
    .period-btn.is-active { background: var(--navy); color: #fff; }
    .period-btn:not(.is-active):hover { background: rgba(18, 58, 109, 0.06); }
    .actions { display: inline-flex; flex-wrap: wrap; gap: 10px; }
    .action-btn {
      display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 16px;
      border-radius: 999px; border: 1px solid rgba(18, 58, 109, 0.16); background: #fff;
      color: var(--navy); font: inherit; font-size: 13px; font-weight: 800; cursor: pointer;
    }
    .action-btn.primary { background: var(--gold); border-color: transparent; }
    .action-btn:disabled { opacity: 0.6; cursor: wait; }
    .custom-dates { display: ${period === "custom" ? "flex" : "none"}; flex-wrap: wrap; gap: 14px; margin: 0 0 22px; }
    .custom-dates label {
      display: flex; flex-direction: column; gap: 6px; font-size: 12px; font-weight: 800;
      letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted);
    }
    .custom-dates input[type="date"] {
      min-height: 48px; border: 1px solid rgba(18, 58, 109, 0.18); border-radius: 14px;
      padding: 0 14px; font: inherit; color: var(--ink); background: #fff;
    }
    .status-line { min-height: 1.2em; margin: 0 0 16px; color: var(--muted); font-size: 13px; font-weight: 600; }
    .table-wrap { overflow: auto; border: 1px solid var(--line); border-radius: 18px; background: #fff; }
    table { width: 100%; border-collapse: collapse; min-width: 780px; }
    th, td { text-align: left; padding: 14px 16px; border-bottom: 1px solid rgba(18, 58, 109, 0.08); vertical-align: top; font-size: 14px; }
    th {
      background: rgba(18, 58, 109, 0.05); color: var(--navy); font-size: 11px;
      letter-spacing: 0.1em; text-transform: uppercase; font-weight: 800;
    }
    tr:last-child td { border-bottom: 0; }
    .status {
      display: inline-flex; align-items: center; min-height: 28px; padding: 0 10px; border-radius: 999px;
      font-size: 12px; font-weight: 800; letter-spacing: 0.04em; text-transform: capitalize;
    }
    .status.is-approved { background: var(--ok-soft); color: var(--ok); }
    .status.is-failed { background: var(--fail-soft); color: var(--fail); }
    .email-link { color: var(--blue); font-weight: 600; }
    .email-link:hover { text-decoration: underline; }
    .note-cell { color: var(--muted); max-width: 260px; }
    .empty { padding: 28px 16px; color: var(--muted); }
    .donation-row { cursor: pointer; transition: background 140ms ease; }
    .donation-row:hover, .donation-row:focus-visible { background: rgba(27, 94, 168, 0.05); outline: none; }
    .pager {
      display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
      gap: 12px; margin: 14px 0 0;
    }
    .pager-meta { color: var(--muted); font-size: 13px; font-weight: 600; }
    .pager-controls { display: inline-flex; align-items: center; gap: 8px; }
    .pager-btn {
      min-height: 40px; min-width: 40px; padding: 0 14px; border-radius: 999px;
      border: 1px solid rgba(18, 58, 109, 0.16); background: #fff; color: var(--navy);
      font: inherit; font-size: 13px; font-weight: 800; cursor: pointer;
    }
    .pager-btn:disabled { opacity: 0.45; cursor: default; }
    .pager-page { min-width: 4.5rem; text-align: center; font-size: 13px; font-weight: 700; color: var(--navy); }
    .footnote { margin: 22px 0 0; color: var(--muted); font-size: 13px; }
    .env-banner {
      margin: 0 0 18px; padding: 12px 14px; border-radius: 12px; font-size: 13px; font-weight: 700; line-height: 1.45;
    }
    .env-banner.is-test {
      background: #fff4df; color: #8a5a00; border: 1px solid rgba(232, 194, 58, 0.45);
    }
    .env-banner.is-live {
      background: var(--ok-soft); color: var(--ok); border: 1px solid rgba(27, 127, 74, 0.22);
    }
    .modal-backdrop {
      position: fixed; inset: 0; display: grid; place-items: center; padding: 24px;
      background: rgba(12, 28, 48, 0.52); backdrop-filter: blur(4px); z-index: 40;
      opacity: 0; visibility: hidden; pointer-events: none;
      transition: opacity 240ms ease, visibility 0ms linear 240ms;
    }
    .modal-backdrop.is-open {
      opacity: 1; visibility: visible; pointer-events: auto;
      transition: opacity 240ms ease, visibility 0ms linear 0ms;
    }
    .modal {
      width: min(640px, 100%); max-height: min(86vh, 820px); overflow: auto;
      border-radius: 24px; background: var(--paper); border: 1px solid var(--line);
      box-shadow: 0 28px 70px rgba(12, 28, 48, 0.28);
      opacity: 0; transform: translateY(18px) scale(0.97);
      transition: opacity 260ms ease, transform 320ms cubic-bezier(0.22, 1, 0.36, 1);
    }
    .modal-backdrop.is-open .modal {
      opacity: 1; transform: none;
    }
    .modal-header {
      display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
      padding: 22px 24px 12px; border-bottom: 1px solid rgba(18, 58, 109, 0.08);
    }
    .modal-header h2 {
      margin: 6px 0 0; font-family: Georgia, "Times New Roman", serif; color: var(--navy);
      font-size: 1.55rem; line-height: 1.15; letter-spacing: -0.02em;
    }
    .modal-close {
      border: 0; background: rgba(18, 58, 109, 0.06); color: var(--navy); width: 40px; height: 40px;
      border-radius: 999px; font: inherit; font-size: 22px; line-height: 1; cursor: pointer;
    }
    .modal-body {
      padding: 18px 24px 26px;
      opacity: 1;
      transition: opacity 200ms ease;
    }
    .modal-body.is-swapping { opacity: 0; }
    .detail-grid {
      display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 18px; margin: 0 0 18px;
    }
    .detail-item {
      padding: 12px 14px; border-radius: 14px; background: rgba(18, 58, 109, 0.04);
      border: 1px solid rgba(18, 58, 109, 0.08);
    }
    .detail-item span {
      display: block; font-size: 11px; font-weight: 800; letter-spacing: 0.1em;
      text-transform: uppercase; color: var(--muted); margin-bottom: 6px;
    }
    .detail-item strong { color: var(--ink); font-size: 14px; font-weight: 700; word-break: break-word; }
    .detail-item strong.tone-ok { color: var(--ok); }
    .detail-item strong.tone-bad { color: var(--fail); }
    .detail-item strong.tone-warn { color: #9a6700; }
    .detail-section { margin: 0 0 4px; }
    .detail-section h3 {
      margin: 0 0 10px; color: var(--navy); font-size: 12px; font-weight: 800;
      letter-spacing: 0.12em; text-transform: uppercase;
    }
    .modal-loading, .modal-error { color: var(--muted); font-size: 14px; padding: 12px 0; }
    .modal-error { color: var(--fail); }
    .email-form { display: grid; gap: 14px; }
    .email-form p { margin: 0; color: var(--muted); font-size: 14px; line-height: 1.5; }
    .email-form label {
      display: grid; gap: 8px; color: var(--navy); font-size: 12px; font-weight: 800;
      letter-spacing: 0.08em; text-transform: uppercase;
    }
    .email-form input[type="email"] {
      min-height: 48px; padding: 0 14px; border-radius: 14px; border: 1px solid rgba(18, 58, 109, 0.18);
      background: #fff; color: var(--ink); font: inherit; font-size: 15px; font-weight: 600;
    }
    .email-form input[type="email"]:focus {
      outline: 2px solid rgba(27, 94, 168, 0.28); outline-offset: 1px;
    }
    .email-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 4px; }
    .email-actions .action-btn { min-height: 44px; }
    .email-actions .action-btn:disabled { opacity: 0.6; cursor: wait; }
    .toast {
      position: fixed; right: 24px; bottom: 24px; z-index: 50;
      max-width: min(420px, calc(100vw - 32px));
      padding: 14px 18px; border-radius: 16px;
      background: var(--navy); color: #fff;
      box-shadow: 0 18px 40px rgba(12, 28, 48, 0.28);
      font-size: 14px; font-weight: 600; line-height: 1.45;
      opacity: 0; transform: translateY(12px) scale(0.98);
      visibility: hidden; pointer-events: none;
      transition: opacity 240ms ease, transform 280ms cubic-bezier(0.22, 1, 0.36, 1), visibility 0ms linear 280ms;
    }
    .toast.is-open {
      opacity: 1; transform: none; visibility: visible; pointer-events: auto;
      transition: opacity 240ms ease, transform 280ms cubic-bezier(0.22, 1, 0.36, 1), visibility 0ms linear 0ms;
    }
    .toast.is-error { background: var(--fail); }
    @media (prefers-reduced-motion: reduce) {
      .modal-backdrop, .modal-backdrop.is-open, .modal, .modal-body, .toast, .toast.is-open { transition: none; }
      .modal, .toast { transform: none; }
    }
    @media (max-width: 820px) {
      .stats { grid-template-columns: 1fr; }
      .stat-total .totals-row { flex-wrap: wrap; white-space: normal; }
      .toolbar { align-items: stretch; flex-direction: column; }
      .detail-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <div class="topbar">
      <a class="brand" href="/" aria-label="Mulatiwa Foundation home">
        <span class="brand-mark" aria-hidden="true">MF</span>
        <span><strong>Mulatiwa</strong><small>Foundation</small></span>
      </a>
    </div>

    <section class="panel">
      <p class="eyebrow">Staff only</p>
      <h1>Donations log</h1>
      ${
        String(cybsEnv || "").toLowerCase() === "production"
          ? `<p class="env-banner is-live">Live Cybersource production · api.cybersource.com</p>`
          : `<p class="env-banner is-test">Cybersource TEST sandbox · apitest.cybersource.com — not live card money</p>`
      }

      <div class="stats">
        <div class="stat stat-ok">
          <span class="label">Approved</span>
          <strong>${current.approved.length}</strong>
          <div class="compare">${escapeHtml(approvedCompare)}</div>
        </div>
        <div class="stat stat-fail">
          <span class="label">Unsuccessful</span>
          <strong>${current.failed.length}</strong>
          <div class="compare">${escapeHtml(failedCompare)}</div>
        </div>
        <div class="stat stat-total">
          <span class="label">Approved total</span>
          <div class="totals-row">${totalsHtml}</div>
          <div class="compare">${escapeHtml(totalsCompare)}</div>
        </div>
      </div>

      <div class="toolbar">
        <div class="period-group" role="group" aria-label="Period">
          ${presetButtons}
        </div>
        <div class="actions">
          <a class="action-btn" href="${exportHref}">Export CSV</a>
          <button type="button" class="action-btn primary" id="email-summary-btn">Email a summary</button>
        </div>
      </div>

      <form id="period-form" method="get" action="/internal/giving">
        <input type="hidden" name="t" value="${escapeHtml(nextToken)}" />
        <input type="hidden" name="period" id="period-input" value="${escapeHtml(period)}" />
        <div class="custom-dates" id="custom-dates">
          <label>From<input type="date" name="from" id="from-input" value="${escapeHtml(fromValue)}" /></label>
          <label>To<input type="date" name="to" id="to-input" value="${escapeHtml(toValue)}" /></label>
        </div>
      </form>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When (CAT)</th>
              <th>Status</th>
              <th>Amount</th>
              <th>Donor</th>
            </tr>
          </thead>
          <tbody id="donations-body">${renderRows(rows)}</tbody>
        </table>
      </div>
      <div class="pager" id="pager" ${totalRows <= pageSize ? "hidden" : ""}>
        <div class="pager-meta" id="pager-meta"></div>
        <div class="pager-controls">
          <button type="button" class="pager-btn" id="pager-prev" aria-label="Previous page">Prev</button>
          <span class="pager-page" id="pager-page" aria-live="polite"></span>
          <button type="button" class="pager-btn" id="pager-next" aria-label="Next page">Next</button>
        </div>
      </div>
      <p class="footnote">Rows are loaded live from Cybersource Transaction Search (not a local file). Link access expires after about 7 days, so open a fresh link from a staff donation email when needed. Click a row for full payment details.</p>
    </section>
  </div>
  <div class="modal-backdrop" id="txn-modal" aria-hidden="true">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="txn-modal-title">
      <div class="modal-header">
        <div>
          <p class="eyebrow" style="margin:0">Transaction detail</p>
          <h2 id="txn-modal-title">Donation</h2>
        </div>
        <button type="button" class="modal-close" id="txn-modal-close" aria-label="Close">×</button>
      </div>
      <div class="modal-body" id="txn-modal-body"></div>
    </div>
  </div>
  <div class="modal-backdrop" id="email-modal" aria-hidden="true">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="email-modal-title">
      <div class="modal-header">
        <div>
          <p class="eyebrow" style="margin:0">Staff email</p>
          <h2 id="email-modal-title">Email a summary</h2>
        </div>
        <button type="button" class="modal-close" id="email-modal-close" aria-label="Close">×</button>
      </div>
      <div class="modal-body">
        <form class="email-form" id="email-summary-form">
          <label>
            Email address
            <input type="email" id="email-summary-input" name="email" autocomplete="email" required placeholder="name@example.com" />
          </label>
          <p class="modal-error" id="email-summary-error" hidden></p>
          <div class="email-actions">
            <button type="submit" class="action-btn primary" id="email-summary-send">Send</button>
            <button type="button" class="action-btn" id="email-summary-cancel">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  </div>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>
  <script>
    (function () {
      var form = document.getElementById("period-form");
      var periodInput = document.getElementById("period-input");
      var custom = document.getElementById("custom-dates");
      var fromInput = document.getElementById("from-input");
      var toInput = document.getElementById("to-input");
      var emailBtn = document.getElementById("email-summary-btn");
      var emailModal = document.getElementById("email-modal");
      var emailClose = document.getElementById("email-modal-close");
      var emailCancel = document.getElementById("email-summary-cancel");
      var emailForm = document.getElementById("email-summary-form");
      var emailInput = document.getElementById("email-summary-input");
      var emailError = document.getElementById("email-summary-error");
      var emailSend = document.getElementById("email-summary-send");
      var toast = document.getElementById("toast");
      var toastTimer = null;
      var token = ${JSON.stringify(nextToken)};
      var currentPeriod = ${JSON.stringify(period)};
      var pageSize = ${pageSize};
      var totalRows = ${totalRows};
      var currentPage = 1;
      var body = document.getElementById("donations-body");
      var pager = document.getElementById("pager");
      var pagerMeta = document.getElementById("pager-meta");
      var pagerPage = document.getElementById("pager-page");
      var prevBtn = document.getElementById("pager-prev");
      var nextBtn = document.getElementById("pager-next");

      function totalPages() {
        return Math.max(1, Math.ceil(totalRows / pageSize) || 1);
      }

      function renderPage() {
        if (!body || !totalRows) return;
        var pages = totalPages();
        if (currentPage > pages) currentPage = pages;
        var start = (currentPage - 1) * pageSize;
        var end = Math.min(start + pageSize, totalRows);
        Array.prototype.forEach.call(body.querySelectorAll("tr[data-row-index]"), function (row) {
          var index = Number(row.getAttribute("data-row-index"));
          row.hidden = index < start || index >= end;
        });
        if (pagerMeta) {
          pagerMeta.textContent = totalRows
            ? ("Showing " + (start + 1) + "–" + end + " of " + totalRows)
            : "No donations";
        }
        if (pagerPage) pagerPage.textContent = currentPage + " / " + pages;
        if (prevBtn) prevBtn.disabled = currentPage <= 1;
        if (nextBtn) nextBtn.disabled = currentPage >= pages;
        if (pager) pager.hidden = totalRows <= pageSize;
      }

      if (prevBtn) {
        prevBtn.addEventListener("click", function () {
          if (currentPage > 1) {
            currentPage -= 1;
            renderPage();
          }
        });
      }
      if (nextBtn) {
        nextBtn.addEventListener("click", function () {
          if (currentPage < totalPages()) {
            currentPage += 1;
            renderPage();
          }
        });
      }
      renderPage();

      document.querySelectorAll(".period-btn").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var value = btn.getAttribute("data-period");
          periodInput.value = value;
          if (value === "custom") {
            custom.style.display = "flex";
            document.querySelectorAll(".period-btn").forEach(function (el) {
              el.classList.toggle("is-active", el === btn);
            });
            return;
          }
          form.submit();
        });
      });

      function maybeSubmitCustom() {
        if (periodInput.value === "custom" && fromInput.value && toInput.value) form.submit();
      }
      fromInput.addEventListener("change", maybeSubmitCustom);
      toInput.addEventListener("change", maybeSubmitCustom);

      function showToast(message, isError) {
        if (!toast) return;
        toast.textContent = message;
        toast.classList.toggle("is-error", Boolean(isError));
        toast.classList.add("is-open");
        if (toastTimer) window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(function () {
          toast.classList.remove("is-open");
        }, 4200);
      }

      function openEmailModal() {
        if (!emailModal) return;
        if (emailError) {
          emailError.hidden = true;
          emailError.textContent = "";
        }
        emailModal.classList.add("is-open");
        emailModal.setAttribute("aria-hidden", "false");
        window.setTimeout(function () {
          if (emailInput) emailInput.focus();
        }, 220);
      }

      function closeEmailModal() {
        if (!emailModal) return;
        emailModal.classList.remove("is-open");
        emailModal.setAttribute("aria-hidden", "true");
      }

      if (emailBtn) emailBtn.addEventListener("click", openEmailModal);
      if (emailClose) emailClose.addEventListener("click", closeEmailModal);
      if (emailCancel) emailCancel.addEventListener("click", closeEmailModal);
      if (emailModal) {
        emailModal.addEventListener("click", function (event) {
          if (event.target === emailModal) closeEmailModal();
        });
      }

      if (emailForm) {
        emailForm.addEventListener("submit", async function (event) {
          event.preventDefault();
          var address = emailInput ? String(emailInput.value || "").trim() : "";
          if (!address) {
            if (emailError) {
              emailError.hidden = false;
              emailError.textContent = "Enter an email address.";
            }
            return;
          }
          if (emailSend) {
            emailSend.disabled = true;
            emailSend.textContent = "Sending…";
          }
          if (emailError) {
            emailError.hidden = true;
            emailError.textContent = "";
          }
          try {
            var res = await fetch("/internal/giving/email-summary", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                t: token,
                email: address,
                period: periodInput.value || currentPeriod,
                from: fromInput && fromInput.value,
                to: toInput && toInput.value,
              }),
            });
            var payload = await res.json().catch(function () { return {}; });
            if (!res.ok) throw new Error(payload.error || "Could not send summary");
            closeEmailModal();
            showToast("Summary sent to " + (payload.sent_to || address) + ".");
            if (emailInput) emailInput.value = "";
          } catch (error) {
            if (emailError) {
              emailError.hidden = false;
              emailError.textContent = error.message || "Could not send summary.";
            }
          } finally {
            if (emailSend) {
              emailSend.disabled = false;
              emailSend.textContent = "Send";
            }
          }
        });
      }

      var modal = document.getElementById("txn-modal");
      var modalBody = document.getElementById("txn-modal-body");
      var modalTitle = document.getElementById("txn-modal-title");
      var modalClose = document.getElementById("txn-modal-close");

      function closeModal() {
        if (!modal) return;
        modal.classList.remove("is-open");
        modal.setAttribute("aria-hidden", "true");
      }

      function money(amount, currency) {
        var value = Number(amount);
        if (!Number.isFinite(value)) return String(amount || "—");
        var formatted = value.toLocaleString("en-ZM", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return currency === "ZMW" ? ("K" + formatted) : ("$" + formatted);
      }

      function toneClass(kind, value) {
        var text = String(value == null ? "" : value).trim();
        if (!text || text === "—") return "";
        var upper = text.toUpperCase();
        if (kind === "status") {
          if (upper === "APPROVED") return "tone-ok";
          if (upper === "DECLINED" || upper === "FAILED") return "tone-bad";
          return "tone-warn";
        }
        if (kind === "risk") {
          if (upper === "ACCEPT" || upper === "ACCEPTED") return "tone-ok";
          if (upper === "REJECT" || upper === "REJECTED" || upper === "DECLINE" || upper === "DECLINED") {
            return "tone-bad";
          }
          if (upper === "REVIEW" || upper === "CHALLENGE") return "tone-warn";
          return "";
        }
        if (kind === "reason") {
          if (upper === "100") return "tone-ok";
          if (/^(481|203|102|200|220|230|231|232|233|234|236|240|250)/.test(upper)) return "tone-bad";
          return "tone-warn";
        }
        if (kind === "response") {
          if (upper === "00" || upper === "0" || upper === "000") return "tone-ok";
          return "tone-bad";
        }
        return "";
      }

      function field(label, value, tone) {
        var shown = value || "—";
        var klass = tone ? toneClass(tone, shown) : "";
        return '<div class="detail-item"><span>' + label + '</span><strong' +
          (klass ? ' class="' + klass + '"' : "") + ">" + shown + "</strong></div>";
      }

      var bodySwapTimer = null;
      var bodySwapGen = 0;

      function setModalBody(html) {
        if (!modalBody) return;
        var gen = ++bodySwapGen;
        modalBody.classList.add("is-swapping");
        if (bodySwapTimer) window.clearTimeout(bodySwapTimer);
        bodySwapTimer = window.setTimeout(function () {
          if (gen !== bodySwapGen) return;
          modalBody.innerHTML = html;
          modalBody.classList.remove("is-swapping");
        }, 160);
      }

      function openTransaction(id) {
        if (!id || !modal || !modalBody) return;
        modal.classList.add("is-open");
        modal.setAttribute("aria-hidden", "false");
        modalTitle.textContent = "Loading…";
        setModalBody('<p class="modal-loading">Fetching payment details…</p>');
        fetch("/internal/giving/transaction/" + encodeURIComponent(id) + "?t=" + encodeURIComponent(token))
          .then(function (res) { return res.json().then(function (payload) { return { ok: res.ok, payload: payload }; }); })
          .then(function (result) {
            if (!result.ok) throw new Error(result.payload.error || "Could not load details");
            var tx = result.payload.transaction || {};
            modalTitle.textContent = money(tx.amount, tx.currency) + " · " + (tx.status || "unknown");
            var when = tx.submit_time ? new Date(tx.submit_time).toLocaleString("en-ZM", {
              timeZone: "Africa/Lusaka", dateStyle: "full", timeStyle: "short"
            }) : "—";
            var decisionMessage = (tx.decision && tx.decision.message) || tx.error_message || "";
            if (/processed successfully/i.test(decisionMessage) && tx.status !== "approved") {
              decisionMessage = tx.error_message || decisionMessage;
            }
            var services = tx.services || {};
            var auth = services.authorization || {};
            var capture = services.capture || {};
            var decisionMgr = services.decision_manager || {};
            var apps = Array.isArray(tx.applications) ? tx.applications : [];
            var payerAuth = apps.filter(function (app) {
              return String(app.name || "").indexOf("ics_pa_") === 0;
            });
            var payerAuthLabel = payerAuth.length
              ? payerAuth.map(function (app) {
                  return String(app.name || "").replace(/^ics_pa_/, "") +
                    (app.status ? " · " + app.status : "");
                }).join(", ")
              : "";
            var riskRules = (tx.decision && Array.isArray(tx.decision.risk_rules))
              ? tx.decision.risk_rules.map(function (rule) {
                  return (rule.name || "Rule") + (rule.decision ? " (" + rule.decision + ")" : "");
                }).join(", ")
              : "";
            var mailto = tx.bill_to && tx.bill_to.email
              ? '<a class="email-link" href="mailto:' + encodeURIComponent(tx.bill_to.email) +
                '?subject=' + encodeURIComponent("About your donation to Mulatiwa Foundation") +
                '">' + tx.bill_to.email + "</a>"
              : "—";
            setModalBody(
              '<div class="detail-section"><h3>Summary</h3><div class="detail-grid">' +
                field("When (CAT)", when) +
                field("Status", tx.status, "status") +
                field("Amount", money(tx.amount, tx.currency)) +
                field("Client reference", tx.client_reference) +
                field("Request ID", tx.id || tx.reference) +
              "</div></div>" +
              '<div class="detail-section"><h3>Donor</h3><div class="detail-grid">' +
                field("Name", tx.bill_to && tx.bill_to.name) +
                '<div class="detail-item"><span>Email</span><strong>' + mailto + "</strong></div>" +
                field("Country", tx.bill_to && tx.bill_to.country) +
                field("Postal code", tx.bill_to && tx.bill_to.postal_code) +
              "</div></div>" +
              '<div class="detail-section"><h3>Payment</h3><div class="detail-grid">' +
                field("Card", tx.card || (tx.payment && tx.payment.card)) +
                field("Approval code", tx.processor && tx.processor.approval_code) +
                field("Authorization", auth.status || auth.message, "risk") +
                field("Settlement", capture.status || capture.message, "risk") +
                field("Decision Manager", decisionMgr.status || decisionMgr.message, "risk") +
                field("3-D Secure", payerAuthLabel) +
              "</div></div>" +
              '<div class="detail-section"><h3>Risk &amp; processor</h3><div class="detail-grid">' +
                field("Decision message", decisionMessage) +
                field("Reason code", (tx.decision && tx.decision.overall_reason) || tx.reason_code, "reason") +
                field("Risk decision", tx.decision && tx.decision.risk_decision, "risk") +
                field("Risk rules", riskRules) +
                field("AVS", tx.processor && tx.processor.avs) +
                field("CVV", tx.processor && tx.processor.cvv) +
                field("Response code", tx.processor && tx.processor.response_code, "response") +
                field("Processor", tx.processor && tx.processor.name) +
              "</div></div>" +
              '<div class="detail-section"><h3>References</h3><div class="detail-grid">' +
                field("Reconciliation ID", tx.reconciliation_id) +
                field("Retrieval reference", tx.processor && tx.processor.retrieval_reference) +
                field("Merchant ID", tx.merchant_id) +
              "</div></div>"
            );
          })
          .catch(function (error) {
            modalTitle.textContent = "Details unavailable";
            setModalBody('<p class="modal-error">' + (error.message || "Could not load details.") + "</p>");
          });
      }

      if (body) {
        body.addEventListener("click", function (event) {
          if (event.target && event.target.closest && event.target.closest("[data-stop-row]")) return;
          var row = event.target.closest ? event.target.closest("tr[data-txn-id]") : null;
          if (row) openTransaction(row.getAttribute("data-txn-id"));
        });
        body.addEventListener("keydown", function (event) {
          if (event.key !== "Enter" && event.key !== " ") return;
          var row = event.target.closest ? event.target.closest("tr[data-txn-id]") : null;
          if (!row) return;
          event.preventDefault();
          openTransaction(row.getAttribute("data-txn-id"));
        });
      }
      if (modalClose) modalClose.addEventListener("click", closeModal);
      if (modal) {
        modal.addEventListener("click", function (event) {
          if (event.target === modal) closeModal();
        });
      }
      document.addEventListener("keydown", function (event) {
        if (event.key !== "Escape") return;
        closeModal();
        closeEmailModal();
      });
    })();
  </script>
</body>
</html>`;
}

module.exports = {
  renderReportPage,
  resolveRange,
  filterDonations,
  previousComparableRange,
  summarize,
  buildExportCsv,
  exportFilename,
  PRESETS,
};
