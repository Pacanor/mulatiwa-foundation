const { getHost, createPaymentWithTransientToken } = require("./cybersource");
const crypto = require("crypto");

function lookupTransactionSafe(id) {
  try {
    // Lazy require avoids a circular dependency at module load.
    const { getTransaction } = require("./ledger");
    return getTransaction(id);
  } catch {
    return null;
  }
}

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
  // Documented UC Payment Details path first, then alternate hosts used by older docs.
  const candidates = [
    `/flex/v2/payment-details/${encodeURIComponent(jti)}`,
    `/up/v1/payment-details/${encodeURIComponent(jti)}`,
    `/ups/v1/payment-details/${encodeURIComponent(jti)}`,
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

function readBillField(billTo, key) {
  if (!billTo || typeof billTo !== "object") return "";
  const value = billTo[key];
  if (value && typeof value === "object" && "value" in value) {
    return String(value.value || "").trim();
  }
  return String(value || "").trim();
}

function pickDonorFromDetails(details, payload) {
  const sources = [
    details?.orderInformation?.billTo,
    payload?.orderInformation?.billTo,
    payload?.content?.orderInformation?.billTo,
    payload?.data?.orderInformation?.billTo,
    payload?.billTo,
  ].filter(Boolean);

  let first = "";
  let last = "";
  let email = "";
  for (const billTo of sources) {
    first = first || readBillField(billTo, "firstName");
    last = last || readBillField(billTo, "lastName");
    email = email || readBillField(billTo, "email");
  }
  if (!email) {
    email = String(
      payload?.email ||
        payload?.content?.email ||
        payload?.data?.email ||
        "",
    ).trim();
  }
  const name = [first, last].filter(Boolean).join(" ").trim();
  return { name, email };
}

function readChargedAmount(source) {
  if (!source || typeof source !== "object") return null;
  const details =
    source.orderInformation?.amountDetails ||
    source.content?.orderInformation?.amountDetails ||
    source.data?.orderInformation?.amountDetails ||
    null;
  if (!details) return null;
  const raw =
    details.authorizedAmount?.value ??
    details.authorizedAmount ??
    details.totalAmount?.value ??
    details.totalAmount ??
    details.amount?.value ??
    details.amount ??
    null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function amountsMatch(expected, actual) {
  if (!Number.isFinite(actual)) return false;
  return Math.abs(Number(expected) - actual) < 0.009;
}

function readPaymentStatus(source) {
  if (!source || typeof source !== "object") return "";
  return String(
    source.status ||
      source.outcome ||
      source.content?.status ||
      source.content?.processingInformation?.status ||
      "",
  ).toUpperCase();
}

function isSuccessfulPaymentStatus(status) {
  const value = String(status || "").toUpperCase();
  return (
    value === "AUTHORIZED" ||
    value === "PARTIAL_AUTHORIZED" ||
    value === "PENDING" ||
    value === "AUTHORIZED_PENDING_REVIEW" ||
    value === "PENDING_REVIEW" ||
    value === "SETTLED" ||
    value === "SETTLING" ||
    value === "ACCEPTED" ||
    value === "TRANSMITTED" ||
    value === "CAPTURED" ||
    value === "COMPLETED" ||
    value === "SUCCESS"
  );
}

function paymentStatusFromPts(payload, expectedAmount) {
  const status = readPaymentStatus(payload);
  const charged = readChargedAmount(payload);
  if (isSuccessfulPaymentStatus(status)) {
    // Prefer an explicit charged amount when present. If Cybersource omits it
    // on an otherwise successful sale, fall back to the session gift amount.
    if (Number.isFinite(charged) && charged > 0) {
      if (expectedAmount != null && !amountsMatch(expectedAmount, charged)) {
        return "failed";
      }
      return "approved";
    }
    if (expectedAmount != null && Number(expectedAmount) > 0) return "approved";
    return "failed";
  }
  if (
    status === "DECLINED" ||
    status === "AUTHORIZED_RISK_DECLINED" ||
    status === "AUTHENTICATION_FAILED" ||
    status === "PENDING_AUTHENTICATION"
  ) {
    return "declined";
  }
  return "failed";
}

async function enrichDonation({
  amount,
  currency,
  reference,
  resultJwt,
  transientToken = "",
  paymentResult = null,
  paymentCompleted = false,
  status = "approved",
  errorMessage = "",
}) {
  const payload = resultJwt ? decodeJwtPayload(resultJwt) : null;
  const transientPayload = transientToken ? decodeJwtPayload(transientToken) : null;
  const inlineResult =
    paymentResult && typeof paymentResult === "object" ? paymentResult : null;
  // Prefer the mount transient-token jti for Payment Details (bill-to / email).
  let jti = transientPayload?.jti || payload?.jti || null;
  let details = null;
  let normalizedStatus = status || "approved";
  let normalizedError = errorMessage || "";
  let paymentId =
    inlineResult?.id ||
    inlineResult?.transactionId ||
    inlineResult?.reconciliationId ||
    payload?.content?.id ||
    payload?.content?.transactionId ||
    payload?.transactionId ||
    payload?.id ||
    null;
  if (
    !paymentId &&
    typeof reference === "string" &&
    /^\d{15,}$/.test(reference.trim())
  ) {
    paymentId = reference.trim();
  }

  let currencyCode = String(currency || "").toUpperCase();
  let chargedAmount = readChargedAmount(inlineResult);
  let paymentStatus = readPaymentStatus(inlineResult);
  const alreadyCompleted = Boolean(paymentCompleted) || Boolean(inlineResult?.id);

  // Prefer server-side PTS with the explicit gift amount when UC only returns a
  // Flex transient token. If UC already completed the sale (completeMandate),
  // do not capture again — verify against the payment result / TSS instead.
  if (
    resultJwt &&
    isTransientTokenPayload(payload) &&
    !alreadyCompleted &&
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
        currency: currencyCode,
        transientTokenJwt: resultJwt,
        referenceCode: `MF-${Date.now()}`,
      });
      paymentId = payment?.id || payment?.reconciliationId || paymentId;
      chargedAmount = readChargedAmount(payment);
      paymentStatus = readPaymentStatus(payment);
      normalizedStatus = paymentStatusFromPts(payment, amount);
      if (normalizedStatus !== "approved") {
        normalizedError =
          payment?.errorInformation?.message ||
          payment?.message ||
          payment?.status ||
          "Payment was not approved";
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
    (inlineResult || (resultJwt && payload && !isTransientTokenPayload(payload))) &&
    String(normalizedStatus).toLowerCase() === "approved" &&
    !String(reference || "").startsWith("SEED-")
  ) {
    const source = inlineResult || payload;
    chargedAmount = readChargedAmount(source) ?? chargedAmount;
    paymentStatus = readPaymentStatus(source) || paymentStatus;
    paymentId =
      source?.id ||
      source?.transactionId ||
      source?.reconciliationId ||
      source?.content?.id ||
      source?.content?.transactionId ||
      paymentId;

    if (isSuccessfulPaymentStatus(paymentStatus)) {
      if (Number.isFinite(chargedAmount) && chargedAmount > 0) {
        if (!amountsMatch(amount, chargedAmount)) {
          normalizedStatus = "failed";
          normalizedError = `The charged amount (${chargedAmount}) did not match the gift (${amount}).`;
        } else {
          normalizedStatus = "approved";
        }
      } else {
        // Successful UC/PTS responses sometimes omit amountDetails. Use the
        // selected gift amount and confirm via transaction lookup below.
        normalizedStatus = "approved";
        chargedAmount = Number(amount);
      }
    } else if (paymentStatus) {
      normalizedStatus = paymentStatusFromPts(source, amount);
      if (normalizedStatus !== "approved") {
        normalizedError =
          source?.errorInformation?.message ||
          source?.message ||
          paymentStatus ||
          "Payment was not approved";
      }
    }
  } else if (
    alreadyCompleted &&
    String(normalizedStatus).toLowerCase() === "approved"
  ) {
    // UC complete() already finished the sale. Keep the selected gift amount
    // until Transaction Search can confirm the charged total.
    if (!Number.isFinite(chargedAmount) || chargedAmount <= 0) {
      chargedAmount = Number(amount);
    }
  }

  try {
    details = await fetchPaymentDetails(jti);
  } catch (error) {
    console.warn("[donations] payment-details lookup failed:", error.message);
  }

  // Authoritative confirmation from Transaction Search when we have a payment id.
  // Retry briefly: TSS can lag a second behind Unified Checkout complete().
  let txnDonor = { name: "", email: "" };
  const applyTxn = (txn) => {
    if (!txn) return false;
    const txnAmount = Number(txn.amount);
    if (Number.isFinite(txnAmount) && txnAmount > 0) chargedAmount = txnAmount;
    if (txn.currency) currencyCode = String(txn.currency).toUpperCase();
    if (txn.status === "approved") {
      normalizedStatus = "approved";
      normalizedError = "";
    } else if (txn.status === "declined" || txn.status === "failed") {
      normalizedStatus = txn.status;
      normalizedError = txn.error_message || normalizedError || txn.status;
    }
    txnDonor = {
      name: txn.donor_name || txn.bill_to?.name || "",
      email: txn.donor_email || txn.bill_to?.email || "",
    };
    if (txn.id && !paymentId) paymentId = txn.id;
    return Boolean(txnDonor.email);
  };

  if (paymentId && !String(paymentId).startsWith("SEED-")) {
    try {
      let txn = await lookupTransactionSafe(paymentId);
      let foundEmail = applyTxn(txn);
      if (!foundEmail) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        txn = await lookupTransactionSafe(paymentId);
        applyTxn(txn);
      }
    } catch (error) {
      console.warn("[donations] transaction lookup failed:", error.message);
    }
  }

  const donor = pickDonorFromDetails(details, payload || inlineResult || transientPayload);
  if (!donor.email && txnDonor.email) donor.email = String(txnDonor.email).trim();
  if (!donor.name && txnDonor.name) donor.name = String(txnDonor.name).trim();

  // Last resort: match a just-completed TSS row by amount/currency. UC already
  // stored bill-to there even when the complete() payload omitted it.
  if (
    !donor.email &&
    String(normalizedStatus).toLowerCase() === "approved" &&
    !String(reference || "").startsWith("SEED-")
  ) {
    try {
      const { findRecentDonorContact } = require("./ledger");
      const recent = await findRecentDonorContact({
        amount: Number.isFinite(chargedAmount) ? chargedAmount : amount,
        currency: currencyCode,
      });
      if (recent) {
        if (recent.email) donor.email = recent.email;
        if (!donor.name && recent.name) donor.name = recent.name;
        if (!paymentId && recent.id) paymentId = recent.id;
      }
    } catch (error) {
      console.warn("[donations] recent donor lookup failed:", error.message);
    }
  }
  if (chargedAmount == null) {
    chargedAmount =
      readChargedAmount(details) ??
      readChargedAmount(payload) ??
      readChargedAmount(inlineResult);
  }

  // Only treat a true zero charge as failure. Missing amount on an approved
  // Cybersource sale should fall back to the selected gift amount.
  if (
    String(normalizedStatus).toLowerCase() === "approved" &&
    Number.isFinite(chargedAmount) &&
    chargedAmount <= 0
  ) {
    normalizedStatus = "failed";
    normalizedError =
      normalizedError ||
      "The payment was not collected for the selected amount. Nothing was charged.";
  } else if (
    String(normalizedStatus).toLowerCase() === "approved" &&
    !Number.isFinite(chargedAmount)
  ) {
    chargedAmount = Number(amount);
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
    currencyCode;

  return {
    amount: String(amountFromDetails),
    currency: String(currencyFromDetails || currencyCode).toUpperCase(),
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
