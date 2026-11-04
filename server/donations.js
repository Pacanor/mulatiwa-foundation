const { getHost, createPaymentWithTransientToken } = require("./cybersource");
const crypto = require("crypto");

function decodeJwtPayload(jwt) {
  try {
    const parts = String(jwt).split(".");
    if (parts.length < 2) return null;
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function isTransientTokenPayload(payload) {
  if (!payload || typeof payload !== "object") return false;
  const type = String(payload.type || "");
  const iss = String(payload.iss || "");
  if (type.startsWith("gda")) return true;
  if (/Flex/i.test(iss)) return true;
  // Completed UC payment JWTs usually expose a processing/status block.
  if (payload.content?.processingInformation || payload.content?.status || payload.status) {
    return false;
  }
  return Boolean(payload.jti);
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
  const signingString = lines.join("\n");
  const signature = crypto
    .createHmac("sha256", Buffer.from(secretKey, "base64"))
    .update(signingString, "utf8")
    .digest("base64");
  const headers = digest
    ? "host date (request-target) digest v-c-merchant-id"
    : "host date (request-target) v-c-merchant-id";
  return `keyid="${keyId}", algorithm="HmacSHA256", headers="${headers}", signature="${signature}"`;
}

async function fetchPaymentDetails(jti) {
  if (!jti) return null;
  const merchantId = process.env.MERCHANT_ID;
  const keyId = process.env.CYBS_KEY_ID;
  const secretKey = process.env.CYBS_SECRET_KEY;
  if (!merchantId || !keyId || !secretKey) return null;

  const host = getHost(process.env.CYBS_ENV === "production" ? "production" : "test");
  const resourcePath = `/ups/v1/payment-details/${encodeURIComponent(jti)}`;
  // Prefer documented flex path; fall back handled by caller if 404
  const candidates = [
    `/flex/v2/payment-details/${encodeURIComponent(jti)}`,
    resourcePath,
  ];

  for (const path of candidates) {
    const date = new Date().toUTCString();
    const signature = createSignatureHeader({
      method: "GET",
      resourcePath: path,
      host,
      date,
      digest: null,
      merchantId,
      keyId,
      secretKey,
    });
    try {
      const response = await fetch(`https://${host}${path}`, {
        method: "GET",
        headers: {
          Host: host,
          Date: date,
          Signature: signature,
          "v-c-merchant-id": merchantId,
        },
      });
      if (!response.ok) continue;
      return await response.json();
    } catch {
      // try next candidate
    }
  }
  return null;
}

function pickDonorFromDetails(details, payload) {
  const billTo = details?.orderInformation?.billTo || {};
  const contentBillTo = payload?.content?.orderInformation?.billTo || {};
  const first =
    billTo.firstName ||
    contentBillTo.firstName?.value ||
    contentBillTo.firstName ||
    "";
  const last =
    billTo.lastName || contentBillTo.lastName?.value || contentBillTo.lastName || "";
  const email =
    billTo.email ||
    contentBillTo.email?.value ||
    contentBillTo.email ||
    payload?.email ||
    "";
  const name = [first, last].filter(Boolean).join(" ").trim();
  return { name, email: String(email || "").trim() };
}

function readChargedAmount(source) {
  if (!source || typeof source !== "object") return null;
  const details =
    source.orderInformation?.amountDetails ||
    source.content?.orderInformation?.amountDetails ||
    null;
  if (!details) return null;
  const raw =
    details.authorizedAmount?.value ??
    details.authorizedAmount ??
    details.totalAmount?.value ??
    details.totalAmount ??
    null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function amountsMatch(expected, actual) {
  if (!Number.isFinite(actual)) return false;
  return Math.abs(Number(expected) - actual) < 0.009;
}

function paymentStatusFromPts(payload, expectedAmount) {
  const status = String(payload?.status || "").toUpperCase();
  const charged = readChargedAmount(payload);
  if (
    status === "AUTHORIZED" ||
    status === "PARTIAL_AUTHORIZED" ||
    status === "PENDING" ||
    status === "AUTHORIZED_PENDING_REVIEW" ||
    status === "PENDING_REVIEW"
  ) {
    if (!Number.isFinite(charged) || charged <= 0) return "failed";
    if (expectedAmount != null && !amountsMatch(expectedAmount, charged)) return "failed";
    return "approved";
  }
  if (status === "DECLINED" || status === "AUTHORIZED_RISK_DECLINED") {
    return "declined";
  }
  return "failed";
}

async function enrichDonation({
  amount,
  currency,
  reference,
  resultJwt,
  status = "approved",
  errorMessage = "",
}) {
  const payload = resultJwt ? decodeJwtPayload(resultJwt) : null;
  let jti = payload?.jti || (typeof reference === "string" ? reference : null);
  let details = null;
  let normalizedStatus = status || "approved";
  let normalizedError = errorMessage || "";
  let paymentId = null;

  let chargedAmount = null;

  // Prefer server-side PTS with the explicit gift amount. UC browser capture on
  // this MID has produced $0 SDISCOUNT auths that looked successful in the UI.
  if (
    resultJwt &&
    isTransientTokenPayload(payload) &&
    String(normalizedStatus).toLowerCase() === "approved" &&
    !String(reference || "").startsWith("SEED-")
  ) {
    try {
      const payment = await createPaymentWithTransientToken({
        merchantId: process.env.MERCHANT_ID,
        keyId: process.env.CYBS_KEY_ID,
        secretKey: process.env.CYBS_SECRET_KEY,
        env: process.env.CYBS_ENV === "production" ? "production" : "test",
        amount: String(amount),
        currency: String(currency).toUpperCase(),
        transientTokenJwt: resultJwt,
        referenceCode: `MF-${Date.now()}`,
      });
      paymentId = payment?.id || payment?.reconciliationId || null;
      chargedAmount = readChargedAmount(payment);
      normalizedStatus = paymentStatusFromPts(payment, amount);
      if (normalizedStatus !== "approved") {
        if (Number.isFinite(chargedAmount) && chargedAmount <= 0) {
          normalizedError =
            "The bank response did not collect the gift amount. Nothing was charged.";
        } else if (
          Number.isFinite(chargedAmount) &&
          !amountsMatch(amount, chargedAmount)
        ) {
          normalizedError = `The charged amount (${chargedAmount}) did not match the gift (${amount}).`;
        } else {
          normalizedError =
            payment?.errorInformation?.message ||
            payment?.message ||
            payment?.status ||
            "Payment was not approved";
        }
      }
      console.log(
        "[donations] captured transient token via PTS",
        paymentId,
        payment?.status,
        chargedAmount,
      );
    } catch (error) {
      console.error("[donations] PTS capture failed:", error.message, error.details || "");
      normalizedStatus = "failed";
      const detail =
        error.payload?.message ||
        error.payload?.reason ||
        error.payload?.errorInformation?.message ||
        error.message;
      normalizedError = String(detail || "Payment capture failed");
    }
  } else if (
    resultJwt &&
    payload &&
    !isTransientTokenPayload(payload) &&
    String(normalizedStatus).toLowerCase() === "approved" &&
    !String(reference || "").startsWith("SEED-")
  ) {
    // UC already orchestrated payment — only accept if the charged amount matches.
    chargedAmount = readChargedAmount(payload);
    paymentId =
      payload?.id ||
      payload?.transactionId ||
      payload?.content?.id ||
      payload?.content?.transactionId ||
      paymentId;
    if (!Number.isFinite(chargedAmount) || chargedAmount <= 0) {
      normalizedStatus = "failed";
      normalizedError =
        "The payment was not collected for the selected amount. Nothing was charged.";
    } else if (!amountsMatch(amount, chargedAmount)) {
      normalizedStatus = "failed";
      normalizedError = `The charged amount (${chargedAmount}) did not match the gift (${amount}).`;
    }
  }

  try {
    details = await fetchPaymentDetails(jti);
  } catch (error) {
    console.warn("[donations] payment-details lookup failed:", error.message);
  }

  const donor = pickDonorFromDetails(details, payload);
  if (chargedAmount == null) {
    chargedAmount = readChargedAmount(details) ?? readChargedAmount(payload);
  }
  if (
    String(normalizedStatus).toLowerCase() === "approved" &&
    Number.isFinite(chargedAmount) &&
    chargedAmount <= 0
  ) {
    normalizedStatus = "failed";
    normalizedError =
      normalizedError ||
      "The payment was not collected for the selected amount. Nothing was charged.";
  }

  const amountFromDetails =
    Number.isFinite(chargedAmount) && chargedAmount > 0
      ? chargedAmount.toFixed(2)
      : details?.orderInformation?.amountDetails?.totalAmount ||
        payload?.content?.orderInformation?.amountDetails?.totalAmount?.value ||
        amount;
  const currencyFromDetails =
    details?.orderInformation?.amountDetails?.currency ||
    payload?.content?.orderInformation?.amountDetails?.currency?.value ||
    currency;

  return {
    amount: String(amountFromDetails),
    currency: String(currencyFromDetails || currency).toUpperCase(),
    name: donor.name,
    email: donor.email,
    reference: paymentId || jti || reference || "",
    whenIso: new Date().toISOString(),
    status: normalizedStatus || "approved",
    error_message: normalizedError || "",
  };
}

module.exports = {
  decodeJwtPayload,
  isTransientTokenPayload,
  enrichDonation,
};
