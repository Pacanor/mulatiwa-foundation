const crypto = require("crypto");
const { getHost, resolveCybsEnv } = require("./cybersource");

function credentials() {
  const merchantId = process.env.MERCHANT_ID;
  const keyId = process.env.CYBS_KEY_ID;
  const secretKey = process.env.CYBS_SECRET_KEY;
  if (!merchantId || !keyId || !secretKey) {
    throw new Error("Cybersource credentials are not configured");
  }
  return { merchantId, keyId, secretKey };
}

function createDigest(body) {
  return `SHA-256=${crypto.createHash("sha256").update(body, "utf8").digest("base64")}`;
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
  const host = getHost(resolveCybsEnv());
  const body = bodyObject ? JSON.stringify(bodyObject) : null;
  const date = new Date().toUTCString();
  const digest = body ? createDigest(body) : null;
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

function pickAuthInfo(payload = {}) {
  return payload.consumerAuthenticationInformation || {};
}

/**
 * Start EMV 3DS device-data collection for a Unified Checkout transient token.
 */
async function setupPayerAuth({ transientToken, referenceCode }) {
  const payload = await cybsRequest({
    method: "POST",
    resourcePath: "/risk/v1/authentication-setups",
    bodyObject: {
      clientReferenceInformation: {
        code: referenceCode || `MF-PA-${Date.now()}`,
      },
      tokenInformation: {
        transientToken,
      },
    },
  });
  const info = pickAuthInfo(payload);
  if (!info.accessToken || !info.deviceDataCollectionUrl || !info.referenceId) {
    const error = new Error("Payer Authentication setup did not return device-data details.");
    error.payload = payload;
    throw error;
  }
  return {
    id: payload.id || "",
    status: payload.status || "",
    access_token: info.accessToken,
    device_data_collection_url: info.deviceDataCollectionUrl,
    reference_id: info.referenceId,
  };
}

/**
 * Check 3DS enrollment after device-data collection. May return a challenge.
 */
async function enrollPayerAuth({
  transientToken,
  referenceId,
  referenceCode,
  amount,
  currency,
  browserInformation = {},
  billTo = {},
}) {
  const payload = await cybsRequest({
    method: "POST",
    resourcePath: "/risk/v1/authentications",
    bodyObject: {
      clientReferenceInformation: {
        code: referenceCode || `MF-PA-${Date.now()}`,
      },
      orderInformation: {
        amountDetails: {
          totalAmount: String(amount),
          currency: String(currency).toUpperCase(),
        },
        billTo: {
          firstName: billTo.firstName || billTo.first_name || "Donor",
          lastName: billTo.lastName || billTo.last_name || "Friend",
          email: billTo.email || "donor@mulatiwafoundation.org",
          address1: billTo.address1 || billTo.address_1 || "Lusaka",
          locality: billTo.locality || "Lusaka",
          country: billTo.country || "ZM",
          ...(billTo.postalCode || billTo.postal_code
            ? { postalCode: billTo.postalCode || billTo.postal_code }
            : {}),
        },
      },
      tokenInformation: {
        transientToken,
      },
      deviceInformation: {
        httpBrowserColorDepth: String(browserInformation.color_depth || "24"),
        httpBrowserJavaEnabled: Boolean(browserInformation.java_enabled),
        httpBrowserJavaScriptEnabled: true,
        httpBrowserLanguage: browserInformation.language || "en-US",
        httpBrowserScreenHeight: String(browserInformation.screen_height || "900"),
        httpBrowserScreenWidth: String(browserInformation.screen_width || "1440"),
        httpBrowserTimeDifference: String(browserInformation.time_difference || "0"),
        userAgentBrowserValue: browserInformation.user_agent || "Mozilla/5.0",
        ipAddress: browserInformation.ip_address || undefined,
      },
      consumerAuthenticationInformation: {
        challengeCode: "04",
        deviceChannel: "Browser",
        referenceId,
        returnUrl:
          browserInformation.return_url ||
          `${String(process.env.PUBLIC_SITE_URL || "").replace(/\/$/, "")}/donate.html`,
      },
    },
  });

  const info = pickAuthInfo(payload);
  const status = String(payload.status || "").toUpperCase();
  return {
    id: payload.id || "",
    status,
    authentication_transaction_id: info.authenticationTransactionId || "",
    access_token: info.accessToken || "",
    step_up_url: info.stepUpUrl || info.step_up_url || "",
    eci: info.eciRaw || "",
    cavv: info.cavv || "",
    xid: info.xid || "",
    directory_server_transaction_id: info.directoryServerTransactionId || "",
    spec_version: info.specificationVersion || info.paSpecificationVersion || "",
    veres_enrolled: info.veresEnrolled || "",
    commerce_indicator: info.ecommerceIndicator || "",
  };
}

/**
 * Validate a completed issuer challenge before authorization.
 */
async function validatePayerAuth({
  authenticationTransactionId,
  referenceCode,
  amount,
  currency,
}) {
  const payload = await cybsRequest({
    method: "POST",
    resourcePath: "/risk/v1/authentication-results",
    bodyObject: {
      clientReferenceInformation: {
        code: referenceCode || `MF-PA-${Date.now()}`,
      },
      orderInformation: {
        amountDetails: {
          totalAmount: String(amount),
          currency: String(currency).toUpperCase(),
        },
      },
      consumerAuthenticationInformation: {
        authenticationTransactionId,
      },
    },
  });
  const info = pickAuthInfo(payload);
  return {
    id: payload.id || "",
    status: String(payload.status || "").toUpperCase(),
    authentication_transaction_id:
      info.authenticationTransactionId || authenticationTransactionId || "",
    eci: info.eciRaw || "",
    cavv: info.cavv || "",
    xid: info.xid || "",
    directory_server_transaction_id: info.directoryServerTransactionId || "",
    spec_version: info.specificationVersion || info.paSpecificationVersion || "",
    commerce_indicator: info.ecommerceIndicator || "",
  };
}

function commerceIndicatorFromEci(eci) {
  const value = String(eci || "").trim();
  // Common Visa/Mastercard ECI → Cybersource commerce indicators.
  if (value === "05" || value === "02") return "vbv";
  if (value === "06" || value === "01") return "vbv";
  return "";
}

function authenticationPayloadForPayment(auth = {}) {
  if (!auth || typeof auth !== "object") return {};
  const out = {};
  if (auth.cavv) out.cavv = auth.cavv;
  if (auth.xid) out.xid = auth.xid;
  if (auth.eci || auth.eci_raw) out.eciRaw = auth.eci || auth.eci_raw;
  const indicator =
    auth.commerce_indicator || commerceIndicatorFromEci(auth.eci || auth.eci_raw);
  if (indicator) out.ecommerceIndicator = indicator;
  if (auth.directory_server_transaction_id) {
    out.directoryServerTransactionId = auth.directory_server_transaction_id;
  }
  if (auth.spec_version) out.paSpecificationVersion = auth.spec_version;
  if (auth.authentication_transaction_id) {
    out.authenticationTransactionId = auth.authentication_transaction_id;
  }
  return out;
}

module.exports = {
  setupPayerAuth,
  enrollPayerAuth,
  validatePayerAuth,
  authenticationPayloadForPayment,
};
