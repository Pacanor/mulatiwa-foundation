const { readLocalDonations } = require("./ledger");
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

function weekdayInZone(date = new Date(), timeZone = TIME_ZONE) {
  // 0 Sun … 6 Sat in the given zone
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
    return { from: startOfDayUtc(parseDay(today)), to: endOfDayUtc(parseDay(today)), fromValue: today, toValue: today };
  }

  if (preset === "week") {
    const dow = weekdayInZone(now); // 0 Sun
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

  // custom fallback: last 30 days including today
  const fromValue = addDaysYmd(today, -29);
  return {
    from: startOfDayUtc(parseDay(fromValue)),
    to: endOfDayUtc(parseDay(today)),
    fromValue,
    toValue: today,
  };
}

function previousRange(from, to) {
  const durationMs = Math.max(to.getTime() - from.getTime(), 24 * 60 * 60 * 1000);
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - durationMs);
  return { from: prevFrom, to: prevTo };
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

function compareCount(current, previous) {
  const diff = current - previous;
  if (diff === 0) return "Same as previous period";
  if (diff > 0) return `+${diff} vs previous period`;
  return `${diff} vs previous period`;
}

function compareTotals(currentTotals, previousTotals) {
  const currencies = [...new Set([...Object.keys(currentTotals), ...Object.keys(previousTotals)])];
  if (!currencies.length) return "Same as previous period";

  const parts = currencies
    .map((currency) => {
      const current = Number(currentTotals[currency] || 0);
      const previous = Number(previousTotals[currency] || 0);
      const diff = Math.round((current - previous) * 100) / 100;
      if (diff === 0) return null;
      return `${diff > 0 ? "+" : "−"}${formatMoney(Math.abs(diff), currency)}`;
    })
    .filter(Boolean);

  if (!parts.length) return "Same as previous period";
  return `${parts.join(" · ")} vs previous period`;
}

function renderRows(rows) {
  if (!rows.length) {
    return `<tr><td colspan="6" class="empty">No donations in this period.</td></tr>`;
  }
  return rows
    .map((row) => {
      const when = new Date(row.recorded_at).toLocaleString("en-ZM", {
        timeZone: TIME_ZONE,
        dateStyle: "medium",
        timeStyle: "short",
      });
      const status = String(row.status || "unknown");
      const statusClass = status === "approved" ? "is-approved" : "is-failed";
      const money = formatMoney(row.amount, row.currency);
      const note = row.error_message || "";
      const mailto =
        row.donor_email &&
        `mailto:${encodeURIComponent(row.donor_email)}?subject=${encodeURIComponent(
          "About your donation to Mulatiwa Foundation",
        )}`;
      const emailCell = row.donor_email
        ? `<a class="email-link" href="${mailto}">${escapeHtml(row.donor_email)}</a>`
        : "—";
      return `
      <tr>
        <td>${escapeHtml(when)}</td>
        <td><span class="status ${statusClass}">${escapeHtml(status)}</span></td>
        <td><strong>${escapeHtml(money)}</strong></td>
        <td>${escapeHtml(row.donor_name || "—")}</td>
        <td>${emailCell}</td>
        <td class="note-cell">${escapeHtml(note || row.reference || "—")}</td>
      </tr>`;
    })
    .join("");
}

function resolveRange({ periodInput, fromInput, toInput }) {
  const period = PRESETS.includes(periodInput) ? periodInput : "month";
  if (period === "custom") {
    const fallback = rangeForPreset("month");
    const fromValue = fromInput || fallback.fromValue;
    const toValue = toInput || fallback.toValue;
    const from = startOfDayUtc(parseDay(fromValue, fallback.from));
    const to = endOfDayUtc(parseDay(toValue, fallback.to));
    return { period, from, to, fromValue: from.toISOString().slice(0, 10), toValue: to.toISOString().slice(0, 10) };
  }
  const range = rangeForPreset(period);
  return { period, ...range };
}

function renderReportPage({ periodInput, fromInput, toInput, token }) {
  const nextToken = createReportToken() || token;
  const { period, from, to, fromValue, toValue } = resolveRange({
    periodInput,
    fromInput,
    toInput,
  });

  const all = readLocalDonations();
  const rows = filterDonations(all, from, to);
  const prev = previousRange(from, to);
  const previousRows = filterDonations(all, prev.from, prev.to);

  const current = summarize(rows);
  const prior = summarize(previousRows);
  const totalsLine = formatTotals(current.totals);

  const approvedCompare = compareCount(current.approved.length, prior.approved.length);
  const failedCompare = compareCount(current.failed.length, prior.failed.length);
  const totalsCompare = compareTotals(current.totals, prior.totals);

  const presetOptions = [
    ["today", "Today"],
    ["week", "This week"],
    ["month", "This month"],
    ["quarter", "This quarter"],
    ["year", "This year"],
    ["custom", "Custom"],
  ]
    .map(
      ([value, label]) =>
        `<option value="${value}"${period === value ? " selected" : ""}>${label}</option>`,
    )
    .join("");

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
      --navy: #123a6d;
      --navy-deep: #0c2a52;
      --blue: #1b5ea8;
      --gold: #e8c23a;
      --cream: #f6f3ea;
      --paper: #fffdf8;
      --ink: #17212b;
      --muted: #66727e;
      --fail: #9b1b1b;
      --ok: #0f6b3c;
      --ok-soft: #e7f5ec;
      --fail-soft: #f8e8e8;
      --navy-soft: #e8eef6;
      --line: rgba(18, 58, 109, 0.14);
      --radius: 28px;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--ink);
      background:
        radial-gradient(ellipse 80% 50% at 10% -10%, rgba(27, 94, 168, 0.18), transparent 55%),
        radial-gradient(ellipse 60% 40% at 90% 0%, rgba(232, 194, 58, 0.16), transparent 50%),
        linear-gradient(180deg, #eef3f8 0%, var(--cream) 42%, var(--paper) 100%);
      font-family: "Source Sans 3", "Helvetica Neue", Arial, sans-serif;
      font-size: 16px;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
      min-height: 100vh;
    }
    a { color: inherit; text-decoration: none; }
    .shell { width: min(1100px, calc(100% - 40px)); margin: 0 auto; padding: 28px 0 72px; }
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 28px;
    }
    .brand { display: inline-flex; align-items: center; gap: 12px; color: var(--navy); }
    .brand-mark {
      width: 44px; height: 44px; border-radius: 14px;
      background: var(--navy); color: var(--gold);
      display: grid; place-items: center;
      font-family: Georgia, "Times New Roman", serif; font-weight: 700; font-size: 15px;
    }
    .brand strong { display: block; font-size: 1.05rem; line-height: 1.1; }
    .brand small { display: block; color: var(--muted); font-size: 0.82rem; font-weight: 600; }
    .panel {
      position: relative;
      background: rgba(255, 253, 248, 0.92);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: clamp(24px, 4vw, 36px);
      box-shadow: 0 24px 60px rgba(18, 58, 109, 0.08);
      backdrop-filter: blur(8px);
      overflow: hidden;
    }
    .panel::before {
      content: "";
      position: absolute; left: 0; right: 0; top: 0; height: 4px;
      background: linear-gradient(90deg, var(--navy), var(--blue) 55%, var(--gold));
    }
    .eyebrow {
      margin: 0 0 10px;
      color: var(--blue);
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.16em;
      text-transform: uppercase;
    }
    h1 {
      margin: 0 0 28px;
      font-family: Georgia, "Times New Roman", serif;
      color: var(--navy);
      font-size: clamp(2rem, 3.4vw, 2.7rem);
      line-height: 1.1;
      letter-spacing: -0.03em;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
      margin: 0 0 28px;
    }
    .stat {
      border-radius: 20px;
      padding: 18px 18px 16px;
      border: 1px solid transparent;
      min-height: 118px;
    }
    .stat-ok { background: var(--ok-soft); border-color: rgba(15, 107, 60, 0.18); }
    .stat-fail { background: var(--fail-soft); border-color: rgba(155, 27, 27, 0.16); }
    .stat-total { background: var(--navy-soft); border-color: rgba(18, 58, 109, 0.16); }
    .stat .label {
      display: block;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    .stat-ok .label { color: var(--ok); }
    .stat-fail .label { color: var(--fail); }
    .stat-total .label { color: var(--navy); }
    .stat strong {
      display: block;
      margin-top: 8px;
      font-family: Georgia, "Times New Roman", serif;
      font-size: clamp(1.7rem, 2.6vw, 2.15rem);
      line-height: 1.1;
      letter-spacing: -0.02em;
    }
    .stat-ok strong { color: var(--ok); }
    .stat-fail strong { color: var(--fail); }
    .stat-total strong { color: var(--navy); }
    .stat .compare {
      margin-top: 10px;
      font-size: 13px;
      font-weight: 600;
      line-height: 1.35;
      color: var(--muted);
    }
    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
      align-items: end;
      margin: 0 0 22px;
    }
    .filters label {
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .filters select,
    .filters input[type="date"] {
      min-height: 48px;
      min-width: 160px;
      border: 1px solid rgba(18, 58, 109, 0.18);
      border-radius: 14px;
      padding: 0 14px;
      font: inherit;
      color: var(--ink);
      background: #fff;
    }
    .filters select { min-width: 180px; cursor: pointer; }
    .custom-dates { display: ${period === "custom" ? "flex" : "none"}; flex-wrap: wrap; gap: 14px; }
    .table-wrap {
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 18px;
      background: #fff;
    }
    table { width: 100%; border-collapse: collapse; min-width: 780px; }
    th, td {
      text-align: left;
      padding: 14px 16px;
      border-bottom: 1px solid rgba(18, 58, 109, 0.08);
      vertical-align: top;
      font-size: 14px;
    }
    th {
      background: rgba(18, 58, 109, 0.05);
      color: var(--navy);
      font-size: 11px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      font-weight: 800;
    }
    tr:last-child td { border-bottom: 0; }
    .status {
      display: inline-flex;
      align-items: center;
      min-height: 28px;
      padding: 0 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.04em;
      text-transform: capitalize;
    }
    .status.is-approved { background: var(--ok-soft); color: var(--ok); }
    .status.is-failed { background: var(--fail-soft); color: var(--fail); }
    .email-link { color: var(--blue); font-weight: 600; }
    .email-link:hover { text-decoration: underline; }
    .note-cell { color: var(--muted); max-width: 260px; }
    .empty { padding: 28px 16px; color: var(--muted); }
    .footnote {
      margin: 22px 0 0;
      color: var(--muted);
      font-size: 13px;
    }
    @media (max-width: 820px) {
      .stats { grid-template-columns: 1fr; }
      .topbar { align-items: flex-start; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <div class="topbar">
      <a class="brand" href="/" aria-label="Mulatiwa Foundation home">
        <span class="brand-mark" aria-hidden="true">MF</span>
        <span>
          <strong>Mulatiwa</strong>
          <small>Foundation</small>
        </span>
      </a>
    </div>

    <section class="panel">
      <p class="eyebrow">Staff only</p>
      <h1>Donations log</h1>

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
          <strong>${escapeHtml(totalsLine)}</strong>
          <div class="compare">${escapeHtml(totalsCompare)}</div>
        </div>
      </div>

      <form class="filters" id="period-form" method="get" action="/internal/giving">
        <input type="hidden" name="t" value="${escapeHtml(nextToken)}" />
        <label>
          Period
          <select name="period" id="period-select">
            ${presetOptions}
          </select>
        </label>
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
              <th>Email</th>
              <th>Note / reference</th>
            </tr>
          </thead>
          <tbody>
            ${renderRows(rows)}
          </tbody>
        </table>
      </div>
      <p class="footnote">Link access expires after about 7 days. Open a fresh link from a staff donation email when needed.</p>
    </section>
  </div>
  <script>
    (function () {
      var form = document.getElementById("period-form");
      var select = document.getElementById("period-select");
      var custom = document.getElementById("custom-dates");
      var fromInput = document.getElementById("from-input");
      var toInput = document.getElementById("to-input");
      if (!form || !select) return;

      function syncCustomVisibility() {
        var isCustom = select.value === "custom";
        custom.style.display = isCustom ? "flex" : "none";
        fromInput.required = isCustom;
        toInput.required = isCustom;
      }

      select.addEventListener("change", function () {
        syncCustomVisibility();
        if (select.value !== "custom") form.submit();
      });
      fromInput.addEventListener("change", function () {
        if (select.value === "custom" && fromInput.value && toInput.value) form.submit();
      });
      toInput.addEventListener("change", function () {
        if (select.value === "custom" && fromInput.value && toInput.value) form.submit();
      });
      syncCustomVisibility();
    })();
  </script>
</body>
</html>`;
}

module.exports = {
  renderReportPage,
  rangeForPreset,
  filterDonations,
  previousRange,
  summarize,
  compareCount,
  compareTotals,
  PRESETS,
};
