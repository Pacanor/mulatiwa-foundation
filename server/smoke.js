/**
 * Local smoke checks for static routes and donate validation.
 * Does not call Cybersource (use DONATIONS.md sandbox checklist for that).
 */
const base = process.env.SMOKE_BASE || "https://localhost:8080";
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

async function request(path, options) {
  const response = await fetch(`${base}${path}`, options);
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // non-JSON
  }
  return { status: response.status, text, json };
}

async function main() {
  const failures = [];

  const health = await request("/api/health");
  if (health.status !== 200 || health.json?.status !== "ok") {
    failures.push("health check failed");
  }

  for (const path of ["/", "/donate.html", "/donate.js", "/styles.css"]) {
    const page = await request(path);
    if (page.status !== 200) failures.push(`${path} returned ${page.status}`);
  }

  const origin = new URL(base).origin;
  const badCurrency = await request("/api/donate/session", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ amount: 50, currency: "EUR" }),
  });
  if (badCurrency.status !== 400 || !/USD or ZMW/i.test(badCurrency.json?.error || "")) {
    failures.push("expected 400 for invalid currency");
  }

  const badAmount = await request("/api/donate/session", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ amount: -1, currency: "USD" }),
  });
  if (badAmount.status !== 400 || !/between/i.test(badAmount.json?.error || "")) {
    failures.push("expected 400 for invalid amount");
  }

  const applePayFile = await request("/.well-known/apple-developer-merchantid-domain-association");
  if (applePayFile.status !== 200 || applePayFile.text.length < 100) {
    failures.push("Apple Pay domain association file missing");
  }

  if (failures.length) {
    console.error("Smoke failed:\n- " + failures.join("\n- "));
    process.exit(1);
  }

  console.log("Smoke passed against", base);
}

main().catch((error) => {
  console.error("Smoke failed:", error.message);
  console.error("Is the server running? Try: npm start");
  process.exit(1);
});
