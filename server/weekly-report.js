const { buildWeekDonations, summarizeWeek, searchTransactions } = require("./ledger");
const { formatMoney, STAFF_TO, sendWithResend } = require("./mail");
const { buildReportUrl } = require("./report-token");

const SITE_URL =
  process.env.PUBLIC_SITE_URL ||
  "https://mulatiwa-foundation-2-qaz68.ondigitalocean.app";
const NAVY = "#123a6d";
const GOLD = "#e8c23a";
const CREAM = "#f6f3ea";
const PAPER = "#fffdf8";
const INK = "#17212b";
const MUTED = "#66727e";
const NAVY_DEEP = "#0c2a52";

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatRangeLabel(startIso, endIso) {
  const start = new Date(startIso).toLocaleDateString("en-ZM", {
    timeZone: "Africa/Lusaka",
    dateStyle: "medium",
  });
  const end = new Date(new Date(endIso).getTime() - 1).toLocaleDateString("en-ZM", {
    timeZone: "Africa/Lusaka",
    dateStyle: "medium",
  });
  if (start === end) return start;
  return `${start} to ${end}`;
}

function periodTitle(period, startIso, endIso) {
  const range = formatRangeLabel(startIso, endIso);
  switch (String(period || "")) {
    case "today":
      return `Today (${range})`;
    case "week":
      return `This week (${range})`;
    case "month":
      return `This month (${range})`;
    case "quarter":
      return `This quarter (${range})`;
    case "year":
      return `This year (${range})`;
    case "custom":
      return range;
    default:
      return range;
  }
}

function summarizeDonations(donations, { startIso, endIso }) {
  const approved = donations.filter(
    (row) => String(row.status || "").toLowerCase() === "approved",
  );
  const failedCount = donations.filter((row) => {
    const status = String(row.status || "").toLowerCase();
    return status && status !== "approved";
  }).length;
  const totals = { USD: 0, ZMW: 0 };
  approved.forEach((row) => {
    const currency = String(row.currency || "").toUpperCase();
    if (totals[currency] == null) totals[currency] = 0;
    totals[currency] += Number(row.amount) || 0;
  });
  return {
    startIso,
    endIso,
    count: approved.length,
    failedCount,
    totals,
    rows: approved,
  };
}

function periodReportHtml(summary, options = {}) {
  const title = options.title || periodTitle(options.period, summary.startIso, summary.endIso);
  const eyebrow = options.eyebrow || "Donations summary";
  const footerNote =
    options.footerNote ||
    "A summary of donations recorded on the Mulatiwa Foundation website.";
  const totalsLine = Object.entries(summary.totals)
    .filter(([, value]) => value > 0)
    .map(([currency, value]) => formatMoney(value, currency))
    .join(" · ");
  const reportUrl = buildReportUrl({ siteUrl: SITE_URL });
  const failedCount = Number(summary.failedCount || 0);

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:${CREAM};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CREAM};">
    <tr>
      <td align="center" style="padding:28px 16px 40px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:${PAPER};border-radius:18px;overflow:hidden;border:1px solid rgba(18,58,109,0.10);">
          <tr>
            <td style="background:${NAVY};padding:0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td style="height:4px;background:${GOLD};font-size:0;line-height:0;">&nbsp;</td></tr>
                <tr>
                  <td style="padding:22px 28px 20px;">
                    <div style="font-family:Helvetica,Arial,sans-serif;color:#fff;font-size:16px;font-weight:800;">Mulatiwa Foundation</div>
                    <p style="margin:18px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:800;letter-spacing:0.18em;text-transform:uppercase;color:${GOLD};">${escapeHtml(eyebrow)}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 28px 12px;">
              <h1 style="margin:0 0 10px;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.2;color:${NAVY};">${escapeHtml(title)}</h1>
              <p style="margin:0 0 18px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:${MUTED};">
                ${escapeHtml(footerNote)}
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;background:${NAVY};border-radius:14px;">
                <tr>
                  <td style="padding:18px 20px;text-align:center;">
                    <div style="font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:800;letter-spacing:0.16em;text-transform:uppercase;color:${GOLD};">Approved total</div>
                    <div style="margin-top:6px;font-family:Georgia,'Times New Roman',serif;font-size:32px;line-height:1.1;color:#ffffff;font-weight:700;">
                      ${escapeHtml(totalsLine || "No approved donations")}
                    </div>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-family:Helvetica,Arial,sans-serif;font-size:16px;color:${INK};">
                <strong>${summary.count}</strong> approved donation${summary.count === 1 ? "" : "s"}
                ${failedCount ? ` · <strong>${failedCount}</strong> unsuccessful` : ""}
              </p>
              ${
                options.automaticNote
                  ? `<p style="margin:18px 0 8px;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:${MUTED};">${escapeHtml(options.automaticNote)}</p>`
                  : ""
              }
            </td>
          </tr>
          <tr>
            <td style="background:${NAVY_DEEP};padding:22px 28px;">
              <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.55;">
                ${
                  reportUrl
                    ? `<a href="${reportUrl}" style="color:${GOLD};text-decoration:none;">View recent donations</a>`
                    : `<a href="${SITE_URL}/" style="color:${GOLD};text-decoration:none;">Visit our website</a>`
                }
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function weeklyReportHtml(summary) {
  return periodReportHtml(summary, {
    period: "week",
    title: `Week of ${formatRangeLabel(summary.startIso, summary.endIso)}`,
    eyebrow: "Weekly donations",
    automaticNote: "Sent automatically every Monday at 08:30 CAT.",
  });
}

async function sendPeriodReportEmail(summary, { to, period, title } = {}) {
  const heading = title || periodTitle(period, summary.startIso, summary.endIso);
  const totalsLine = Object.entries(summary.totals)
    .filter(([, value]) => value > 0)
    .map(([currency, value]) => formatMoney(value, currency))
    .join(" · ");

  const result = await sendWithResend({
    to: to || STAFF_TO,
    subject: `Donations summary: ${totalsLine || "no donations"} (${heading})`,
    html: periodReportHtml(summary, {
      period,
      title: heading,
      eyebrow: "Donations summary",
    }),
  });
  if (result?.skipped) return { skipped: true, title: heading };
  return { ok: true, title: heading };
}

async function sendWeeklyReportEmail(summary, { to } = {}) {
  const start = new Date(summary.startIso).toLocaleDateString("en-ZM", {
    timeZone: "Africa/Lusaka",
    dateStyle: "medium",
  });
  const totalsLine = Object.entries(summary.totals)
    .filter(([, value]) => value > 0)
    .map(([currency, value]) => formatMoney(value, currency))
    .join(" · ");

  const result = await sendWithResend({
    to: to || STAFF_TO,
    subject: `Weekly donations: ${totalsLine || "no donations"} (${start})`,
    html: weeklyReportHtml(summary),
  });
  if (result?.skipped) return { skipped: true };
  return { ok: true };
}

async function buildWeeklySummary(now = new Date()) {
  const donations = await buildWeekDonations(now);
  const summary = summarizeWeek(donations, now);
  const failedCount = donations.filter((row) => {
    const status = String(row.status || "").toLowerCase();
    return status && status !== "approved";
  }).length;
  return { ...summary, failedCount };
}

async function buildPeriodSummary({ from, to }) {
  const start = new Date(from);
  const end = new Date(to);
  const donations = await searchTransactions({ from: start, to: end });
  return summarizeDonations(donations, {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  });
}

async function runWeeklyReport(options = {}) {
  const summary = await buildWeeklySummary(options.now || new Date());
  await sendWeeklyReportEmail(summary, { to: options.to });
  console.log("[weekly-report] sent", summary.count, summary.totals);
  return summary;
}

module.exports = {
  runWeeklyReport,
  sendWeeklyReportEmail,
  sendPeriodReportEmail,
  buildWeeklySummary,
  buildPeriodSummary,
  summarizeDonations,
  weeklyReportHtml,
  periodReportHtml,
  periodTitle,
};
