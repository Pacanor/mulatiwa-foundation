const crypto = require("crypto");

const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function reportSecret() {
  return (
    process.env.REPORT_SECRET ||
    process.env.CYBS_SECRET_KEY ||
    process.env.RESEND_API_KEY ||
    ""
  );
}

function sign(payloadB64) {
  const secret = reportSecret();
  if (!secret) return null;
  return crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

function createReportToken({ ttlSeconds = DEFAULT_TTL_SECONDS } = {}) {
  const secret = reportSecret();
  if (!secret) return null;
  const payload = {
    v: 1,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = sign(payloadB64);
  return `${payloadB64}.${signature}`;
}

function verifyReportToken(token) {
  if (!token || typeof token !== "string" || !reportSecret()) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payloadB64, signature] = parts;
  const expected = sign(payloadB64);
  if (!expected || signature.length !== expected.length) return false;
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    if (!payload?.exp || Number(payload.exp) < Math.floor(Date.now() / 1000)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function buildReportUrl({ siteUrl, fromIso, toIso } = {}) {
  const token = createReportToken();
  if (!token) return null;
  const base = String(siteUrl || "").replace(/\/$/, "");
  const url = new URL(`${base}/internal/giving`);
  url.searchParams.set("t", token);
  if (fromIso) url.searchParams.set("from", fromIso.slice(0, 10));
  if (toIso) url.searchParams.set("to", toIso.slice(0, 10));
  return url.toString();
}

module.exports = {
  createReportToken,
  verifyReportToken,
  buildReportUrl,
  reportSecret,
  DEFAULT_TTL_SECONDS,
};
