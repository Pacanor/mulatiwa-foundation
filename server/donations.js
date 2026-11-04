const { getHost } = require("./cybersource");
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

async function enrichDonation({
  amount,
  currency,
  reference,
  resultJwt,
  status = "approved",
  errorMessage = "",
}) {
  const payload = resultJwt ? decodeJwtPayload(resultJwt) : null;
  const jti = payload?.jti || (typeof reference === "string" ? reference : null);
  let details = null;
  try {
    details = await fetchPaymentDetails(jti);
  } catch (error) {
    console.warn("[donations] payment-details lookup failed:", error.message);
  }

  const donor = pickDonorFromDetails(details, payload);
  const amountFromDetails =
    details?.orderInformation?.amountDetails?.totalAmount ||
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
    reference: jti || reference || "",
    whenIso: new Date().toISOString(),
    status: status || "approved",
    error_message: errorMessage || "",
  };
}

module.exports = {
  decodeJwtPayload,
  enrichDonation,
};
