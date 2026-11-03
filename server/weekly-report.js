const { readLocalDonations, summarizeWeek } = require("./ledger");
const { formatMoney, STAFF_TO } = require("./mail");

async function sendWeeklyReportEmail(summary) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[weekly-report] RESEND_API_KEY missing; skipped");
    return;
  }

  const from =
    process.env.RESEND_FROM || "Mulatiwa Foundation <donations@mulatiwafoundation.org>";
  const start = new Date(summary.startIso).toLocaleDateString("en-ZM", {
    timeZone: "Africa/Lusaka",
    dateStyle: "medium",
  });
  const end = new Date(new Date(summary.endIso).getTime() - 1).toLocaleDateString("en-ZM", {
    timeZone: "Africa/Lusaka",
    dateStyle: "medium",
  });

  const totalsLine = Object.entries(summary.totals)
    .filter(([, value]) => value > 0)
    .map(([currency, value]) => formatMoney(value, currency))
    .join(" · ");

  const html = `
  <div style="font-family:'Source Sans 3',Helvetica,Arial,sans-serif;color:#17212b;line-height:1.55;max-width:560px;margin:0 auto;">
    <p style="color:#1b5ea8;font-size:12px;font-weight:800;letter-spacing:0.16em;text-transform:uppercase;">Weekly giving</p>
    <h1 style="font-family:Georgia,serif;font-size:26px;color:#123a6d;margin:0 0 12px;">Week of ${start} – ${end}</h1>
    <p><strong>${summary.count}</strong> approved gift${summary.count === 1 ? "" : "s"}.</p>
    <p style="font-size:20px;color:#123a6d;"><strong>${totalsLine || "No gifts this week"}</strong></p>
    <p style="color:#66727e;font-size:14px;">Sent automatically every Monday at 08:30 CAT from the on-server CSV ledger.</p>
  </div>`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [STAFF_TO],
      subject: `Weekly donations: ${totalsLine || "no gifts"} (${start})`,
      html,
    }),
  });

  if (!response.ok) {
    throw new Error(`Weekly report email failed (${response.status}): ${await response.text()}`);
  }
}

async function runWeeklyReport() {
  const donations = readLocalDonations();
  const summary = summarizeWeek(donations, new Date());
  await sendWeeklyReportEmail(summary);
  console.log("[weekly-report] sent", summary.count, summary.totals);
  return summary;
}

module.exports = { runWeeklyReport, sendWeeklyReportEmail };
