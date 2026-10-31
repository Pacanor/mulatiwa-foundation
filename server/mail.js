const SITE_URL =
  process.env.PUBLIC_SITE_URL || "https://mulatiwa-foundation-45bk9.ondigitalocean.app";
const FROM =
  process.env.RESEND_FROM || "Mulatiwa Foundation <onboarding@resend.dev>";
const STAFF_TO = process.env.DONATION_NOTIFY_EMAIL || "e.munalula@mulatiwafoundation.org";

function formatMoney(amount, currency) {
  const value = Number(amount);
  const formatted = value.toLocaleString("en-ZM", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency === "ZMW" ? `K${formatted}` : `$${formatted}`;
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

function donorThankYouHtml({ name, amount, currency }) {
  const greeting = name ? `Dear ${name},` : "Dear friend,";
  const money = formatMoney(amount, currency);
  return `
  <div style="font-family:Georgia,'Times New Roman',serif;color:#17212b;line-height:1.6;max-width:560px;margin:0 auto;">
    <p style="color:#1b5ea8;font-family:'Source Sans 3',Helvetica,Arial,sans-serif;font-size:12px;font-weight:800;letter-spacing:0.16em;text-transform:uppercase;">Thank you</p>
    <h1 style="font-size:28px;line-height:1.2;color:#123a6d;margin:0 0 16px;">Your generosity keeps Mulatiwa moving.</h1>
    <p>${greeting}</p>
    <p>Thank you for your gift of <strong>${money}</strong>. Your support helps us equip girls, women, young people and underserved communities across Zambia with education, skills and care that lasts.</p>
    <p>Gifts like yours strengthen learning pathways, leadership opportunities and community wellbeing, from classrooms to care for older persons.</p>
    <p style="margin:28px 0 12px;">
      <a href="${SITE_URL}/donate.html" style="display:inline-block;background:#e8c23a;color:#123a6d;text-decoration:none;padding:12px 20px;border-radius:999px;font-family:'Source Sans 3',Helvetica,Arial,sans-serif;font-weight:800;">Give again</a>
      <a href="${SITE_URL}/index.html#work" style="display:inline-block;margin-left:10px;background:#123a6d;color:#fff;text-decoration:none;padding:12px 20px;border-radius:999px;font-family:'Source Sans 3',Helvetica,Arial,sans-serif;font-weight:800;">See our work</a>
    </p>
    <p style="color:#66727e;font-size:14px;">With gratitude,<br/>Mulatiwa Foundation</p>
  </div>`;
}

function staffNotifyHtml({ name, email, amount, currency, reference, whenIso }) {
  const money = formatMoney(amount, currency);
  const when = new Date(whenIso).toLocaleString("en-ZM", {
    timeZone: "Africa/Lusaka",
    dateStyle: "full",
    timeStyle: "short",
  });
  return `
  <div style="font-family:'Source Sans 3',Helvetica,Arial,sans-serif;color:#17212b;line-height:1.55;max-width:560px;margin:0 auto;">
    <p style="color:#1b5ea8;font-size:12px;font-weight:800;letter-spacing:0.16em;text-transform:uppercase;">New donation</p>
    <h1 style="font-family:Georgia,serif;font-size:26px;color:#123a6d;margin:0 0 16px;">A gift just came through.</h1>
    <table style="width:100%;border-collapse:collapse;font-size:15px;">
      <tr><td style="padding:8px 0;color:#66727e;">Donor</td><td style="padding:8px 0;"><strong>${name || "Not provided"}</strong></td></tr>
      <tr><td style="padding:8px 0;color:#66727e;">Email</td><td style="padding:8px 0;">${email || "Not provided"}</td></tr>
      <tr><td style="padding:8px 0;color:#66727e;">Amount</td><td style="padding:8px 0;"><strong>${money}</strong></td></tr>
      <tr><td style="padding:8px 0;color:#66727e;">When</td><td style="padding:8px 0;">${when} (CAT)</td></tr>
      <tr><td style="padding:8px 0;color:#66727e;">Reference</td><td style="padding:8px 0;word-break:break-all;">${reference || "n/a"}</td></tr>
    </table>
  </div>`;
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

module.exports = {
  sendDonationEmails,
  formatMoney,
  STAFF_TO,
};
