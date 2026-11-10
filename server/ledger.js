const crypto = require("crypto");
const { getHost, resolveCybsEnv } = require("./cybersource");

const TIME_ZONE = "Africa/Lusaka";

function credentials() {
  const merchantId = process.env.MERCHANT_ID;
  const keyId = process.env.CYBS_KEY_ID;
  const secretKey = process.env.CYBS_SECRET_KEY;
  if (!merchantId || !keyId || !secretKey) return null;
  return { merchantId, keyId, secretKey };
}

function ledgerReady() {
  return Boolean(credentials());
}

function createSignatureHeader({
  method,
  resourcePath,
  host,
  date,
  digest,
  merchantId,
  keyId,
  secretKey,
}) {
  const requestTarget = `${method.toLowerCase()} ${resourcePath}`;
  const lines = [`host: ${host}`, `date: ${date}`, `(request-target): ${requestTarget}`];
  if (digest) lines.push(`digest: ${digest}`);
  lines.push(`v-c-merchant-id: ${merchantId}`);
  const signature = crypto
    .createHmac("sha256", Buffer.from(secretKey, "base64"))
    .update(lines.join("\n"), "utf8")
    .digest("base64");
  const headers = digest
    ? "host date (request-target) digest v-c-merchant-id"
    : "host date (request-target) v-c-merchant-id";
  return `keyid="${keyId}", algorithm="HmacSHA256", headers="${headers}", signature="${signature}"`;
}

async function cybsRequest({ method, resourcePath, bodyObject }) {
  const creds = credentials();
  if (!creds) {
    throw new Error("Cybersource credentials are not configured");
  }
  const host = getHost(resolveCybsEnv());
  const body = bodyObject ? JSON.stringify(bodyObject) : null;
  const date = new Date().toUTCString();
  const digest = body
    ? `SHA-256=${crypto.createHash("sha256").update(body, "utf8").digest("base64")}`
    : null;
  const signature = createSignatureHeader({
    method,
    resourcePath,
    host,
    date,
    digest,
    ...creds,
  });
  const headers = {
    Host: host,
    Date: date,
    Signature: signature,
    "v-c-merchant-id": creds.merchantId,
    Accept: "application/hal+json, application/json",
  };
  if (digest) {
    headers.Digest = digest;
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`https://${host}${resourcePath}`, {
    method,
    headers,
    body: body || undefined,
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    const error = new Error(`Cybersource ${method} ${resourcePath} failed (${response.status})`);
    error.status = response.status;
    error.details = text;
    error.payload = parsed;
    throw error;
  }
  return parsed;
}

function relativeRangeQuery(from, to, now = new Date()) {
  // This merchant's TSS rejects absolute ISO timestamps and only accepts NOW-relative
  // expressions. Pull a covering window, then filter precisely in-process.
  const nowMs = now.getTime();
  const fromMs = new Date(from).getTime();
  const toMs = new Date(to).getTime();
  const daysBack = Math.max(0, Math.ceil((nowMs - fromMs) / 86400000) + 1);
  const daysForward = Math.max(0, Math.ceil((toMs - nowMs) / 86400000) + 1);
  return `submitTimeUtc:[NOW/DAY-${daysBack}DAYS TO NOW/DAY+${daysForward}DAYS]`;
}

function mapOverallStatus(
  applicationInformation = {},
  errorInformation = {},
  amountDetails = {},
) {
  const appStatus = String(applicationInformation.status || "").toUpperCase();
  if (appStatus === "CANCELLED" || appStatus === "CANCELED") return "failed";

  const flag = String(applicationInformation.rFlag || "").toUpperCase();
  const rCode = String(applicationInformation.rCode ?? "");
  const reason = String(applicationInformation.reasonCode ?? "");
  const apps = applicationInformation.applications || [];
  const auth = apps.find((app) => app.name === "ics_auth") || {};
  const authFlag = String(auth.rFlag || "").toUpperCase();
  const charged = Number(
    amountDetails.authorizedAmount ?? amountDetails.totalAmount ?? NaN,
  );

  // UC completeMandate on this MID has returned reason 100 with a $0
  // SDISCOUNT auth and cancelled bill — that is not a collected gift.
  if (Number.isFinite(charged) && charged <= 0) return "failed";
  if (authFlag === "SDISCOUNT" && (!Number.isFinite(charged) || charged <= 0)) {
    return "failed";
  }

  // Payer Authentication setup/enrollment rows often carry reason 100 with no
  // amount and no card auth. Those are not completed gifts.
  const hasCardAuth = apps.some(
    (app) =>
      app.name === "ics_auth" &&
      (String(app.rFlag || "").toUpperCase() === "SOK" || String(app.rCode) === "1"),
  );
  if (!Number.isFinite(charged) && !hasCardAuth) {
    const isPayerAuthOnly = apps.length > 0 && apps.every((app) =>
      String(app.name || "").startsWith("ics_pa_"),
    );
    if (isPayerAuthOnly || apps.length === 0) return "failed";
  }

  const decision = apps.find((app) => app.name === "ics_decision") || {};
  const decisionFlag = String(decision.rFlag || "").toUpperCase();
  const decisionReason = String(decision.reasonCode || "");

  // Decision Manager reject must win over a successful auth flag. Zanaco's
  // "Non 3Ds Reject Rule" returns reason 481 after ics_auth SOK, then reverses.
  if (
    flag.includes("REJECT") ||
    flag.includes("DECLINE") ||
    flag === "DREJECT" ||
    decisionFlag.includes("REJECT") ||
    decisionFlag.includes("DECLINE") ||
    decisionFlag === "DREJECT" ||
    rCode === "0" ||
    reason === "481" ||
    decisionReason === "481" ||
    reason === "203"
  ) {
    return "declined";
  }

  if (flag === "SOK" || rCode === "1" || reason === "100") return "approved";
  if (errorInformation?.message) return "failed";
  if (!flag && !rCode && !reason) {
    // Fall back to application outcomes when the summary omits overall flags.
    if (auth && (authFlag === "SOK" || String(auth.rCode) === "1")) {
      return "approved";
    }
  }
  return "failed";
}

function explainFailure(summary) {
  const apps = summary?.applicationInformation?.applications || [];
  const amountDetails = summary?.orderInformation?.amountDetails || {};
  const charged = Number(amountDetails.authorizedAmount ?? amountDetails.totalAmount);
  const appStatus = String(summary?.applicationInformation?.status || "").toUpperCase();
  const auth = apps.find((app) => app.name === "ics_auth") || {};
  const decisionMessage = apps.find((app) =>
    String(app.rFlag || "").toUpperCase().includes("REJECT") ||
    String(app.rFlag || "").toUpperCase().includes("DECLINE") ||
    String(app.rCode) === "0",
  )?.rMessage;
  const errorMessage = summary?.errorInformation?.message || "";
  const riskDecision = summary?.riskInformation?.profile?.decision;
  const riskRules = (summary?.riskInformation?.rules || [])
    .filter((rule) => String(rule.decision || "").toUpperCase() === "REJECT")
    .map((rule) => rule.name)
    .filter(Boolean)
    .join(", ");
  const parts = [];
  if (appStatus === "CANCELLED" || appStatus === "CANCELED") {
    parts.push("Capture cancelled");
  }
  if (String(auth.rFlag || "").toUpperCase() === "SDISCOUNT" && (!Number.isFinite(charged) || charged <= 0)) {
    parts.push("Authorised for 0.00 after discount, so the gift was not collected");
  } else if (Number.isFinite(charged) && charged <= 0) {
    parts.push("No amount was collected");
  }
  if (errorMessage && !/processed successfully/i.test(errorMessage)) parts.push(errorMessage);
  else if (decisionMessage) parts.push(decisionMessage);
  if (riskRules) parts.push(`Risk rule: ${riskRules}`);
  else if (riskDecision && String(riskDecision).toUpperCase() !== "ACCEPT") {
    parts.push(`Risk: ${riskDecision}`);
  }
  const reason = summary?.applicationInformation?.reasonCode;
  if (reason && String(reason) !== "100") parts.push(`Reason ${reason}`);
  return parts.join(". ") || "";
}

function cardLabel(paymentInformation = {}) {
  const card = paymentInformation.card || {};
  const method = paymentInformation.paymentType?.method || "";
  const brand =
    method === "VI" || card.type === "001"
      ? "Visa"
      : method === "MC" || card.type === "002"
        ? "Mastercard"
        : method || "Card";
  const suffix = card.suffix ? `•••• ${card.suffix}` : "";
  return [brand, suffix].filter(Boolean).join(" ");
}

function normalizeSummary(summary) {
  const billTo = summary?.orderInformation?.billTo || {};
  const amountDetails = summary?.orderInformation?.amountDetails || {};
  const status = mapOverallStatus(
    summary?.applicationInformation,
    summary?.errorInformation,
    amountDetails,
  );
  const first = billTo.firstName || "";
  const last = billTo.lastName || "";
  const donorName = [first, last].filter(Boolean).join(" ").trim();

  return {
    id: summary.id,
    recorded_at: summary.submitTimeUtc || summary.submitTimeUTC || "",
    status,
    amount: amountDetails.totalAmount || amountDetails.authorizedAmount || "",
    currency: String(amountDetails.currency || "").toUpperCase(),
    donor_name: donorName,
    donor_email: billTo.email || "",
    reference: summary.id || summary.reconciliationId || "",
    client_reference: summary?.clientReferenceInformation?.code || "",
    error_message: status === "approved" ? "" : explainFailure(summary),
    card: cardLabel(summary.paymentInformation),
    approval_code: summary?.processorInformation?.approvalCode || "",
    processor: summary?.processorInformation?.processor?.name || "",
    reason_code: String(summary?.applicationInformation?.reasonCode || ""),
    applications: summary?.applicationInformation?.applications || [],
  };
}

function friendlyDetail(detail) {
  const row = normalizeSummary(detail);
  const billTo = detail?.orderInformation?.billTo || {};
  const apps = detail?.applicationInformation?.applications || [];
  const riskRules = detail?.riskInformation?.rules || [];
  const authApp = apps.find((app) => app.name === "ics_auth") || {};
  const decisionApp = apps.find((app) => app.name === "ics_decision") || {};
  const billApp = apps.find((app) => app.name === "ics_bill") || {};

  return {
    ...row,
    reconciliation_id: detail.reconciliationId || detail.id || "",
    submit_time: detail.submitTimeUTC || detail.submitTimeUtc || row.recorded_at,
    merchant_id: detail.merchantId || "",
    bill_to: {
      name: row.donor_name,
      email: row.donor_email,
      country: billTo.country || "",
      postal_code: billTo.postalCode || "",
      state: billTo.administrativeArea || billTo.state || "",
    },
    payment: {
      card: row.card,
      prefix: detail?.paymentInformation?.card?.prefix || "",
      suffix: detail?.paymentInformation?.card?.suffix || "",
      expiration: [
        detail?.paymentInformation?.card?.expirationMonth,
        detail?.paymentInformation?.card?.expirationYear,
      ]
        .filter(Boolean)
        .join("/"),
      type: detail?.paymentInformation?.paymentType?.type || "",
      method: detail?.paymentInformation?.paymentType?.method || "",
    },
    processor: {
      name: detail?.processorInformation?.processor?.name || "",
      approval_code: detail?.processorInformation?.approvalCode || "",
      response_code: detail?.processorInformation?.responseCode || "",
      retrieval_reference: detail?.processorInformation?.retrievalReferenceNumber || "",
      avs: detail?.processorInformation?.avs?.code || "",
      cvv: detail?.processorInformation?.cardVerification?.resultCode || "",
    },
    decision: {
      overall_reason: String(detail?.applicationInformation?.reasonCode || ""),
      overall_flag: detail?.applicationInformation?.rFlag || "",
      message: detail?.errorInformation?.message || decisionApp.rMessage || "",
      risk_profile: detail?.riskInformation?.profile?.name || "",
      risk_decision: detail?.riskInformation?.profile?.decision || "",
      risk_rules: riskRules.map((rule) => ({
        name: rule.name || "",
        decision: rule.decision || "",
      })),
    },
    services: {
      authorization: {
        status: authApp.rFlag || "",
        reason_code: authApp.reasonCode || "",
        message: authApp.rMessage || "",
      },
      capture: {
        status: billApp.rFlag || (billApp.name ? "requested" : ""),
        reason_code: billApp.reasonCode || "",
        message: billApp.rMessage || "",
      },
      decision_manager: {
        status: decisionApp.rFlag || "",
        reason_code: decisionApp.reasonCode || "",
        message: decisionApp.rMessage || "",
      },
    },
    applications: apps.map((app) => ({
      name: app.name || "",
      status: app.rFlag || "",
      reason_code: app.reasonCode || "",
      message: app.rMessage || "",
    })),
    raw_status: detail.status || "",
  };
}

async function searchTransactions({ from, to, limit = 500 } = {}) {
  const end = to || new Date();
  const start = from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  const pageSize = Math.min(Number(limit) || 500, 2500);
  let offset = 0;
  const all = [];

  while (offset < 10000) {
    const payload = await cybsRequest({
      method: "POST",
      resourcePath: "/tss/v2/searches",
      bodyObject: {
        save: false,
        name: "Mulatiwa donations",
        timezone: TIME_ZONE,
        query: relativeRangeQuery(start, end),
        offset,
        limit: pageSize,
        sort: "submitTimeUtc:desc",
      },
    });

    const batch = payload?._embedded?.transactionSummaries || [];
    all.push(
      ...batch
        .map(normalizeSummary)
        .filter((row) => {
          const at = new Date(row.recorded_at).getTime();
          if (!Number.isFinite(at) || at < startMs || at > endMs) return false;
          // Drop payer-auth / empty-amount noise from the staff donations log.
          const amount = Number(row.amount);
          if (!Number.isFinite(amount) || amount <= 0) return false;
          return true;
        }),
    );

    const total = Number(payload?.totalCount || 0);
    offset += batch.length;
    if (!batch.length || offset >= total || batch.length < pageSize) break;
  }

  return all;
}

async function getTransaction(id) {
  if (!id) throw new Error("Missing transaction id");
  const detail = await cybsRequest({
    method: "GET",
    resourcePath: `/tss/v2/transactions/${encodeURIComponent(id)}`,
  });
  return friendlyDetail(detail);
}

async function findRecentDonorContact({ amount, currency, withinMs = 8 * 60 * 1000 } = {}) {
  const targetAmount = Number(amount);
  const targetCurrency = String(currency || "").toUpperCase();
  if (!Number.isFinite(targetAmount) || targetAmount <= 0 || !targetCurrency) return null;

  const to = new Date();
  const from = new Date(Date.now() - withinMs);
  const rows = await searchTransactions({ from, to, limit: 40 });
  const match = rows.find((row) => {
    if (String(row.status || "").toLowerCase() !== "approved") return false;
    if (String(row.currency || "").toUpperCase() !== targetCurrency) return false;
    if (!row.donor_email) return false;
    return Math.abs(Number(row.amount) - targetAmount) < 0.009;
  });
  if (!match) return null;
  return {
    id: match.id || match.reference || "",
    name: match.donor_name || "",
    email: match.donor_email || "",
  };
}

async function readDonations(options = {}) {
  return searchTransactions(options);
}

async function recordDonation(donation) {
  // Durable payment history lives in Cybersource. This returns the email/ledger shape only.
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

function zonedYmd_(date = new Date(), timeZone = TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function weekdayInZone_(date = new Date(), timeZone = TIME_ZONE) {
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(date);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(label);
}

function addDaysYmd_(ymd, days) {
  const date = new Date(`${ymd}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dayBoundsUtc_(ymd) {
  const start = new Date(`${ymd}T00:00:00.000+02:00`);
  const next = addDaysYmd_(ymd, 1);
  const end = new Date(`${next}T00:00:00.000+02:00`);
  return { start, end };
}

function summarizeWeek(donations, now = new Date()) {
  const today = zonedYmd_(now);
  const dow = weekdayInZone_(now);
  const daysFromMonday = (dow + 6) % 7;
  const thisMonday = addDaysYmd_(today, -daysFromMonday);
  const prevMonday = addDaysYmd_(thisMonday, -7);
  const { start } = dayBoundsUtc_(prevMonday);
  const { start: end } = dayBoundsUtc_(thisMonday);

  const approved = donations.filter((row) => {
    if (row.status && String(row.status).toLowerCase() !== "approved") return false;
    const at = new Date(row.recorded_at);
    return !Number.isNaN(at.getTime()) && at >= start && at < end;
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

async function buildWeekDonations(now = new Date()) {
  const summary = summarizeWeek([], now);
  return searchTransactions({
    from: new Date(summary.startIso),
    to: new Date(summary.endIso),
  });
}

module.exports = {
  recordDonation,
  readDonations,
  searchTransactions,
  getTransaction,
  findRecentDonorContact,
  summarizeWeek,
  buildWeekDonations,
  ledgerReady,
  normalizeSummary,
  friendlyDetail,
};
