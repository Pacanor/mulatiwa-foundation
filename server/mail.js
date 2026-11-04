const { buildReportUrl } = require("./report-token");

const SITE_URL =
  process.env.PUBLIC_SITE_URL ||
  "https://mulatiwa-foundation-2-qaz68.ondigitalocean.app";
const FROM =
  process.env.RESEND_FROM ||
  "Mulatiwa Foundation <donations@mulatiwafoundation.org>";
const STAFF_TO = process.env.DONATION_NOTIFY_EMAIL || "e.munalula@mulatiwafoundation.org";

const NAVY = "#123a6d";
const NAVY_DEEP = "#0c2a52";
const GOLD = "#e8c23a";
const CREAM = "#f6f3ea";
const PAPER = "#fffdf8";
const INK = "#17212b";
const MUTED = "#66727e";
const FAIL = "#9b1b1b";

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatMoney(amount, currency) {
  const value = Number(amount);
  const formatted = value.toLocaleString("en-ZM", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency === "ZMW" ? `K${formatted}` : `$${formatted}`;
}

function friendlyFailureReason(raw) {
  const text = String(raw || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) {
    return "Your bank or card provider could not complete the payment.";
  }
  if (/insufficient|funds|balance/i.test(text)) {
    return "Your bank reported insufficient funds for this gift.";
  }
  if (/expired/i.test(text)) {
    return "The card appears to be expired.";
  }
  if (/cvv|cvc|security code/i.test(text)) {
    return "The security code did not match what your bank expected.";
  }
  if (/declin|denied|not authorized|rejected|do not honor/i.test(text)) {
    return "Your bank declined this payment.";
  }
  if (/fraud|risk|blocked/i.test(text)) {
    return "Your bank blocked this payment for security reasons.";
  }
  if (/failed|undefined|null|TypeError|NetworkError|JWT|Cybersource|fetch|VAS|UnifiedCheckout/i.test(text)) {
    return "Your bank or card provider could not complete the payment.";
  }
  // Keep provider wording when it already reads naturally.
  if (text.length <= 160) return text.replace(/\.$/, "") + ".";
  return "Your bank or card provider could not complete the payment.";
}

async function sendWithResend({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[mail] RESEND_API_KEY missing; skipped:", subject, "→", to);
    return { skipped: true };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM,
      to: [to],
      subject,
      html,
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Resend failed (${response.status}): ${body}`);
  }
  return { ok: true, body };
}

function emailShell({ preheader, bodyHtml }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Mulatiwa Foundation</title>
</head>
<body style="margin:0;padding:0;background:${CREAM};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
    ${escapeHtml(preheader)}
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CREAM};margin:0;padding:0;">
    <tr>
      <td align="center" style="padding:28px 16px 40px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:${PAPER};border-radius:18px;overflow:hidden;border:1px solid rgba(18,58,109,0.10);">
          ${bodyHtml}
        </table>
        <p style="margin:18px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:${MUTED};max-width:560px;">
          Registered NGO RNGO 101/2648/2025 · Lusaka, Zambia
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function brandHeader({ eyebrow }) {
  return `
  <tr>
    <td style="background:${NAVY};padding:0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="height:4px;background:${GOLD};font-size:0;line-height:0;">&nbsp;</td>
        </tr>
        <tr>
          <td style="padding:22px 28px 20px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td valign="middle" style="padding-right:12px;">
                  <div style="width:40px;height:40px;border-radius:12px;background:${GOLD};color:${NAVY};font-family:Georgia,'Times New Roman',serif;font-size:14px;font-weight:700;line-height:40px;text-align:center;">
                    MF
                  </div>
                </td>
                <td valign="middle">
                  <div style="font-family:Helvetica,Arial,sans-serif;color:#ffffff;font-size:16px;font-weight:800;letter-spacing:0.01em;">
                    Mulatiwa Foundation
                  </div>
                  <div style="font-family:Helvetica,Arial,sans-serif;color:rgba(255,255,255,0.72);font-size:12px;margin-top:2px;">
                    Building minds, shaping futures
                  </div>
                </td>
              </tr>
            </table>
            <p style="margin:18px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:800;letter-spacing:0.18em;text-transform:uppercase;color:${GOLD};">
              ${escapeHtml(eyebrow)}
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

function emailFooter({ staffReportUrl } = {}) {
  const link = staffReportUrl
    ? `<a href="${staffReportUrl}" style="color:${GOLD};text-decoration:none;">View recent donations</a>`
    : `<a href="${SITE_URL}/" style="color:${GOLD};text-decoration:none;">Visit our website</a>`;

  return `
  <tr>
    <td style="background:${NAVY_DEEP};padding:22px 28px;">
      <p style="margin:0 0 8px;font-family:Helvetica,Arial,sans-serif;font-size:13px;font-weight:700;color:#ffffff;">
        Mulatiwa Foundation
      </p>
      <p style="margin:0 0 10px;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.55;color:rgba(255,255,255,0.72);">
        Plot 272, Corner of Meanwood &amp; Olive Tree Roads<br />
        Meanwood Ibex Hill, Lusaka, Zambia
      </p>
      <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.55;">
        ${link}
      </p>
    </td>
  </tr>`;
}

function donorThankYouHtml({ name, amount, currency }) {
  const safeName = escapeHtml(name);
  const greeting = safeName ? `Dear ${safeName},` : "Dear friend,";
  const money = escapeHtml(formatMoney(amount, currency));
  const bodyHtml = `
  ${brandHeader({ eyebrow: "Thank you" })}
  <tr>
    <td style="padding:32px 28px 8px;">
      <h1 style="margin:0 0 18px;font-family:Georgia,'Times New Roman',serif;font-size:28px;line-height:1.2;color:${NAVY};font-weight:700;">
        Your generosity keeps Mulatiwa moving.
      </h1>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;background:${NAVY};border-radius:14px;">
        <tr>
          <td style="padding:18px 20px;text-align:center;">
            <div style="font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:800;letter-spacing:0.16em;text-transform:uppercase;color:${GOLD};">
              Your gift
            </div>
            <div style="margin-top:6px;font-family:Georgia,'Times New Roman',serif;font-size:34px;line-height:1.1;color:#ffffff;font-weight:700;">
              ${money}
            </div>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 14px;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:1.65;color:${INK};">
        ${greeting}
      </p>
      <p style="margin:0 0 14px;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:1.65;color:${INK};">
        Thank you for standing with us. Your gift helps equip girls, women, young people and underserved communities across Zambia with education, skills and care that lasts.
      </p>
      <p style="margin:0 0 26px;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:1.65;color:${INK};">
        Gifts like yours strengthen learning pathways, leadership opportunities and community wellbeing, from classrooms to care for older persons.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px;">
        <tr>
          <td style="padding:0 10px 12px 0;">
            <a href="${SITE_URL}/donate.html" style="display:inline-block;background:${GOLD};color:${NAVY};text-decoration:none;padding:13px 22px;border-radius:999px;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:800;">
              Give again
            </a>
          </td>
          <td style="padding:0 0 12px;">
            <a href="${SITE_URL}/index.html#work" style="display:inline-block;background:${NAVY};color:#ffffff;text-decoration:none;padding:13px 22px;border-radius:999px;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:800;">
              See our work
            </a>
          </td>
        </tr>
      </table>
      <p style="margin:18px 0 8px;font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.5;color:${NAVY};">
        With gratitude,<br />
        <strong>Mulatiwa Foundation</strong>
      </p>
    </td>
  </tr>
  ${emailFooter()}`;

  return emailShell({
    preheader: `Thank you for your gift of ${formatMoney(amount, currency)} to Mulatiwa Foundation.`,
    bodyHtml,
  });
}

function donorFailedHtml({ name, amount, currency, error_message: errorMessage }) {
  const safeName = escapeHtml(name);
  const greeting = safeName ? `Dear ${safeName},` : "Dear friend,";
  const money = escapeHtml(formatMoney(amount, currency));
  const reason = escapeHtml(friendlyFailureReason(errorMessage));
  const bodyHtml = `
  ${brandHeader({ eyebrow: "Gift update" })}
  <tr>
    <td style="padding:32px 28px 8px;">
      <h1 style="margin:0 0 18px;font-family:Georgia,'Times New Roman',serif;font-size:28px;line-height:1.2;color:${FAIL};font-weight:700;">
        We could not complete your gift.
      </h1>
      <p style="margin:0 0 14px;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:1.65;color:${INK};">
        ${greeting}
      </p>
      <p style="margin:0 0 14px;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:1.65;color:${INK};">
        Thank you for trying to support Mulatiwa Foundation with a gift of <strong>${money}</strong>. Nothing was charged.
      </p>
      <p style="margin:0 0 14px;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:1.65;color:${INK};">
        ${reason}
      </p>
      <p style="margin:0 0 26px;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:1.65;color:${INK};">
        You are welcome to try again whenever you are ready. If this keeps happening, reply to this email and we will help.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px;">
        <tr>
          <td style="padding:0 0 12px;">
            <a href="${SITE_URL}/donate.html" style="display:inline-block;background:${GOLD};color:${NAVY};text-decoration:none;padding:13px 22px;border-radius:999px;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:800;">
              Try again
            </a>
          </td>
        </tr>
      </table>
      <p style="margin:18px 0 8px;font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.5;color:${NAVY};">
        With care,<br />
        <strong>Mulatiwa Foundation</strong>
      </p>
    </td>
  </tr>
  ${emailFooter()}`;

  return emailShell({
    preheader: `Your ${formatMoney(amount, currency)} gift did not go through. Nothing was charged.`,
    bodyHtml,
  });
}

function staffNotifyHtml({ name, email, amount, currency, reference, whenIso }) {
  const money = escapeHtml(formatMoney(amount, currency));
  const when = new Date(whenIso || Date.now()).toLocaleString("en-ZM", {
    timeZone: "Africa/Lusaka",
    dateStyle: "full",
    timeStyle: "short",
  });
  const reportUrl = buildReportUrl({ siteUrl: SITE_URL });
  const rows = [
    ["Donor", name || "Not provided"],
    ["Email", email || "Not provided"],
    ["Amount", money],
    ["When", `${when} (CAT)`],
    ["Reference", reference || "n/a"],
  ];

  const detailRows = rows
    .map(([label, value], index) => {
      const border =
        index === rows.length - 1 ? "none" : "1px solid rgba(18,58,109,0.10)";
      const display = label === "Amount" ? money : escapeHtml(String(value));
      return `
      <tr>
        <td style="padding:12px 0;border-bottom:${border};font-family:Helvetica,Arial,sans-serif;font-size:13px;color:${MUTED};width:34%;vertical-align:top;">
          ${escapeHtml(label)}
        </td>
        <td style="padding:12px 0;border-bottom:${border};font-family:Helvetica,Arial,sans-serif;font-size:15px;color:${INK};font-weight:700;word-break:break-word;">
          ${display}
        </td>
      </tr>`;
    })
    .join("");

  const bodyHtml = `
  ${brandHeader({ eyebrow: "New donation" })}
  <tr>
    <td style="padding:32px 28px 12px;">
      <h1 style="margin:0 0 10px;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.2;color:${NAVY};font-weight:700;">
        A gift just came through.
      </h1>
      <p style="margin:0 0 22px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:${MUTED};">
        A supporter has completed a gift on the Mulatiwa Foundation website.
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;background:${NAVY};border-radius:14px;">
        <tr>
          <td style="padding:18px 20px;text-align:center;">
            <div style="font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:800;letter-spacing:0.16em;text-transform:uppercase;color:${GOLD};">
              Amount received
            </div>
            <div style="margin-top:6px;font-family:Georgia,'Times New Roman',serif;font-size:34px;line-height:1.1;color:#ffffff;font-weight:700;">
              ${money}
            </div>
          </td>
        </tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px;">
        ${detailRows}
      </table>
    </td>
  </tr>
  ${emailFooter({ staffReportUrl: reportUrl || undefined })}`;

  return emailShell({
    preheader: `New donation: ${formatMoney(amount, currency)} from ${name || "a donor"}.`,
    bodyHtml,
  });
}

async function sendDonationEmails(donation) {
  const jobs = [];

  if (donation.email) {
    jobs.push(
      sendWithResend({
        to: donation.email,
        subject: "Thank you for your gift to Mulatiwa Foundation",
        html: donorThankYouHtml(donation),
      }),
    );
  } else {
    console.warn("[mail] No donor email on donation; skipped donor thank-you");
  }

  jobs.push(
    sendWithResend({
      to: STAFF_TO,
      subject: `New donation: ${formatMoney(donation.amount, donation.currency)}`,
      html: staffNotifyHtml(donation),
    }),
  );

  const results = await Promise.allSettled(jobs);
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error("[mail] send failed", index, result.reason?.message || result.reason);
    }
  });
  return results;
}

async function sendFailedDonationEmail(donation) {
  if (!donation.email) {
    console.warn("[mail] No donor email on failed donation; skipped notice");
    return [{ status: "fulfilled", value: { skipped: true } }];
  }

  try {
    const result = await sendWithResend({
      to: donation.email,
      subject: "Your gift to Mulatiwa Foundation did not go through",
      html: donorFailedHtml(donation),
    });
    return [{ status: "fulfilled", value: result }];
  } catch (error) {
    console.error("[mail] failed-donation send failed", error.message);
    return [{ status: "rejected", reason: error }];
  }
}

module.exports = {
  sendDonationEmails,
  sendFailedDonationEmail,
  donorThankYouHtml,
  donorFailedHtml,
  staffNotifyHtml,
  friendlyFailureReason,
  formatMoney,
  STAFF_TO,
};
