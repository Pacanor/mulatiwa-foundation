const crypto = require("crypto");

const HOSTS = {
  test: "apitest.cybersource.com",
  production: "api.cybersource.com",
};

function getHost(env) {
  return HOSTS[env] || HOSTS.test;
}

function createDigest(body) {
  const hash = crypto.createHash("sha256").update(body, "utf8").digest("base64");
  return `SHA-256=${hash}`;
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
  const signingString = [
    `host: ${host}`,
    `date: ${date}`,
    `(request-target): ${requestTarget}`,
    `digest: ${digest}`,
    `v-c-merchant-id: ${merchantId}`,
  ].join("\n");

  const signature = crypto
    .createHmac("sha256", Buffer.from(secretKey, "base64"))
    .update(signingString, "utf8")
    .digest("base64");

  return [
    `keyid="${keyId}"`,
    'algorithm="HmacSHA256"',
    'headers="host date (request-target) digest v-c-merchant-id"',
    `signature="${signature}"`,
  ].join(", ");
}

function decodeJwtPayload(jwt) {
  const parts = String(jwt).split(".");
  if (parts.length < 2) {
    throw new Error("Capture context response is not a JWT");
  }
  const payload = Buffer.from(parts[1], "base64url").toString("utf8");
  return JSON.parse(payload);
}

function extractClientLibrary(captureContextJwt) {
  const payload = decodeJwtPayload(captureContextJwt);
  const data =
    payload?.ctx?.[0]?.data ||
    payload?.data ||
    payload?.flx?.data ||
    null;

  const clientLibrary = data?.clientLibrary;
  const clientLibraryIntegrity = data?.clientLibraryIntegrity;

  if (!clientLibrary) {
    throw new Error("Capture context JWT missing clientLibrary");
  }

  return { clientLibrary, clientLibraryIntegrity: clientLibraryIntegrity || null };
}

async function createCaptureContext({
  merchantId,
  keyId,
  secretKey,
  env,
  targetOrigins,
  amount,
  currency,
}) {
  const host = getHost(env);
  const resourcePath = "/uc/v1/sessions";
  const bodyObject = {
    targetOrigins,
    // Card opens via Trigger (no "Checkout with card" step). Wallets mount as separate buttons.
    allowedPaymentTypes: ["PANENTRY", "APPLEPAY", "GOOGLEPAY"],
    allowedCardNetworks: ["VISA", "MASTERCARD"],
    country: "ZM",
    locale: "en_US",
    captureMandate: {
      billingType: "PARTIAL",
      requestEmail: true,
      requestPhone: false,
      requestShipping: false,
      showConfirmationStep: false,
      showAcceptedNetworkIcons: true,
    },
    // Do not send completeMandate. Business Center may still inject one when
    // "Payment Processing" is enabled; the client forces autoProcessing:false
    // and we capture via PTS with the explicit gift amount. UC browser capture
    // on this MID previously settled discounted $0 auths (SDISCOUNT + cancelled
    // bill) while the UI still showed the selected gift.
    appearance: {
      theme: "LIGHT",
      variables: {
        backgroundColor: "#fffdf8",
        textColor: "#17212b",
        headerBackground: "#123a6d",
        headerForeground: "#ffffff",
        buttonBackground: "#e8c23a",
        buttonForeground: "#123a6d",
        buttonBorderRadius: "999px",
        fontFamily: '"Source Sans 3", "Helvetica Neue", Arial, sans-serif',
        paymentSelectionBackground: "#f6f3ea",
      },
    },
    data: {
      clientReferenceInformation: {
        code: `MF-${Date.now()}`,
      },
      orderInformation: {
        amountDetails: {
          totalAmount: String(amount),
          currency,
        },
        lineItems: [
          {
            unitPrice: String(amount),
            quantity: 1,
            productCode: "donation",
            productName: "Donation",
            productSku: "DONATE",
            productDescription: "Mulatiwa Foundation gift",
          },
        ],
      },
    },
  };

  const body = JSON.stringify(bodyObject);
  const date = new Date().toUTCString();
  const digest = createDigest(body);
  const signature = createSignatureHeader({
    method: "POST",
    resourcePath,
    host,
    date,
    digest,
    merchantId,
    keyId,
    secretKey,
  });

  const response = await fetch(`https://${host}${resourcePath}`, {
    method: "POST",
    headers: {
      Host: host,
      Date: date,
      Digest: digest,
      Signature: signature,
      "v-c-merchant-id": merchantId,
      "Content-Type": "application/json",
    },
    body,
  });

  const raw = await response.text();
  if (!response.ok) {
    const error = new Error(`Cybersource session failed (${response.status})`);
    error.status = response.status;
    error.details = raw;
    throw error;
  }

  let captureContext = raw.trim();
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string") {
      captureContext = parsed;
    } else if (parsed?.captureContext) {
      captureContext = parsed.captureContext;
    } else if (parsed?.jwt) {
      captureContext = parsed.jwt;
    }
  } catch {
    // Response is the JWT string itself
  }

  const { clientLibrary, clientLibraryIntegrity } = extractClientLibrary(captureContext);

  return {
    capture_context: captureContext,
    client_library: clientLibrary,
    client_library_integrity: clientLibraryIntegrity,
  };
}

async function createPaymentWithTransientToken({
  merchantId,
  keyId,
  secretKey,
  env,
  amount,
  currency,
  transientTokenJwt,
  referenceCode,
}) {
  const host = getHost(env);
  const resourcePath = "/pts/v2/payments";
  const bodyObject = {
    clientReferenceInformation: {
      code: referenceCode || `MF-${Date.now()}`,
    },
    processingInformation: {
      capture: true,
      commerceIndicator: "internet",
    },
    tokenInformation: {
      transientTokenJwt,
    },
    orderInformation: {
      amountDetails: {
        totalAmount: amount,
        currency,
      },
    },
  };

  const body = JSON.stringify(bodyObject);
  const date = new Date().toUTCString();
  const digest = createDigest(body);
  const signature = createSignatureHeader({
    method: "POST",
    resourcePath,
    host,
    date,
    digest,
    merchantId,
    keyId,
    secretKey,
  });

  const response = await fetch(`https://${host}${resourcePath}`, {
    method: "POST",
    headers: {
      Host: host,
      Date: date,
      Digest: digest,
      Signature: signature,
      "v-c-merchant-id": merchantId,
      "Content-Type": "application/json",
    },
    body,
  });

  const raw = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const error = new Error(`Cybersource payment failed (${response.status})`);
    error.status = response.status;
    error.details = raw;
    error.payload = parsed;
    throw error;
  }

  return parsed;
}

module.exports = {
  createCaptureContext,
  createPaymentWithTransientToken,
  getHost,
};
