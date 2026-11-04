const { readLocalDonations } = require("./ledger");
const { formatMoney } = require("./mail");
const { createReportToken } = require("./report-token");

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

function defaultRange() {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 29);
  from.setUTCHours(0, 0, 0, 0);
  return { from, to: endOfDayUtc(to) };
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

function renderRows(rows) {
  if (!rows.length) {
    return `<tr><td colspan="6" style="padding:18px 12px;color:#66727e;">No gifts in this period.</td></tr>`;
  }
  return rows
    .map((row) => {
      const when = new Date(row.recorded_at).toLocaleString("en-ZM", {
        timeZone: "Africa/Lusaka",
        dateStyle: "medium",
        timeStyle: "short",
      });
      const status = String(row.status || "unknown");
      const statusColor = status === "approved" ? "#0f6b3c" : "#9b1b1b";
      const money = formatMoney(row.amount, row.currency);
      const note = row.error_message || "";
      const mailto =
        row.donor_email &&
        `mailto:${encodeURIComponent(row.donor_email)}?subject=${encodeURIComponent(
          "About your gift to Mulatiwa Foundation",
        )}`;
      const emailCell = row.donor_email
        ? `<a href="${mailto}" style="color:#123a6d;">${escapeHtml(row.donor_email)}</a>`
        : "—";
      return `
      <tr>
        <td>${escapeHtml(when)}</td>
        <td style="color:${statusColor};font-weight:700;text-transform:capitalize;">${escapeHtml(status)}</td>
        <td><strong>${escapeHtml(money)}</strong></td>
        <td>${escapeHtml(row.donor_name || "—")}</td>
        <td>${emailCell}</td>
        <td style="color:#66727e;max-width:240px;">${escapeHtml(note || row.reference || "—")}</td>
      </tr>`;
    })
    .join("");
}

function renderReportPage({ fromInput, toInput, token }) {
  const defaults = defaultRange();
  const from = parseDay(fromInput, defaults.from);
  const to = endOfDayUtc(parseDay(toInput, defaults.to));
  const fromValue = from.toISOString().slice(0, 10);
  const toValue = to.toISOString().slice(0, 10);
  const nextToken = createReportToken() || token;

  const rows = filterDonations(readLocalDonations(), from, to);
  const { approved, failed, totals } = summarize(rows);
  const totalsLine =
    Object.entries(totals)
      .filter(([, value]) => value > 0)
      .map(([currency, value]) => formatMoney(value, currency))
      .join(" · ") || "No approved gifts";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow, noarchive" />
  <title>Giving log · Mulatiwa Foundation</title>
  <style>
    :root { --navy:#123a6d; --gold:#e8c23a; --cream:#f6f3ea; --paper:#fffdf8; --ink:#17212b; --muted:#66727e; --fail:#9b1b1b; }
    * { box-sizing: border-box; }
    body { margin:0; font-family:"Source Sans 3", Helvetica, Arial, sans-serif; background:linear-gradient(180deg,#eef3f8,#f6f3ea 40%,#fffdf8); color:var(--ink); }
    .wrap { max-width:1100px; margin:0 auto; padding:32px 20px 64px; }
    .card { background:var(--paper); border:1px solid rgba(18,58,109,.12); border-radius:20px; padding:28px; box-shadow:0 18px 40px rgba(18,58,109,.06); }
    .eyebrow { margin:0 0 8px; color:#1b5ea8; font-size:12px; font-weight:800; letter-spacing:.16em; text-transform:uppercase; }
    h1 { margin:0 0 8px; font-family:Georgia,"Times New Roman",serif; color:var(--navy); font-size:clamp(1.8rem,3vw,2.4rem); }
    .lead { margin:0 0 24px; color:var(--muted); }
    .stats { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; margin:0 0 24px; }
    .stat { background:#f3f7fb; border-radius:14px; padding:16px; }
    .stat strong { display:block; font-family:Georgia,serif; font-size:1.5rem; color:var(--navy); margin-top:4px; }
    .stat span { color:var(--muted); font-size:13px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; }
    form { display:flex; flex-wrap:wrap; gap:12px; align-items:end; margin:0 0 22px; }
    label { display:flex; flex-direction:column; gap:6px; font-size:13px; font-weight:700; color:var(--muted); }
    input[type=date] { min-height:44px; border:1px solid rgba(18,58,109,.2); border-radius:12px; padding:0 12px; font:inherit; color:var(--ink); background:#fff; }
    button { min-height:44px; border:0; border-radius:999px; padding:0 18px; background:var(--gold); color:var(--navy); font:inherit; font-weight:800; cursor:pointer; }
    .table-wrap { overflow:auto; border:1px solid rgba(18,58,109,.12); border-radius:14px; }
    table { width:100%; border-collapse:collapse; min-width:760px; }
    th, td { text-align:left; padding:12px; border-bottom:1px solid rgba(18,58,109,.08); vertical-align:top; font-size:14px; }
    th { background:#f3f7fb; color:var(--navy); font-size:12px; letter-spacing:.04em; text-transform:uppercase; }
    tr:last-child td { border-bottom:0; }
    .note { margin-top:18px; color:var(--muted); font-size:13px; }
    @media (max-width:720px) { .stats { grid-template-columns:1fr; } }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <p class="eyebrow">Staff only</p>
      <h1>Giving log</h1>
      <p class="lead">Approved and unsuccessful gifts for the selected period. This page is not linked from the public site.</p>
      <div class="stats">
        <div class="stat"><span>Approved</span><strong>${approved.length}</strong></div>
        <div class="stat"><span>Unsuccessful</span><strong>${failed.length}</strong></div>
        <div class="stat"><span>Approved total</span><strong>${escapeHtml(totalsLine)}</strong></div>
      </div>
      <form method="get" action="/internal/giving">
        <input type="hidden" name="t" value="${escapeHtml(nextToken)}" />
        <label>From<input type="date" name="from" value="${escapeHtml(fromValue)}" required /></label>
        <label>To<input type="date" name="to" value="${escapeHtml(toValue)}" required /></label>
        <button type="submit">Update period</button>
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
      <p class="note">Link access expires after about 7 days. Open a fresh link from a staff donation email when needed.</p>
    </div>
  </div>
</body>
</html>`;
}

module.exports = {
  renderReportPage,
  defaultRange,
  filterDonations,
};
