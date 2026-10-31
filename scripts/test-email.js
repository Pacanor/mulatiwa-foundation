#!/usr/bin/env node
/**
 * Fires a test donor + staff email via the local server.
 * Requires: npm start running, RESEND_API_KEY, ALLOW_TEST_EMAIL=true
 *
 * Usage:
 *   TEST_DONOR_EMAIL=you@example.com node scripts/test-email.js
 *   node scripts/test-email.js you@example.com
 */
require("dotenv").config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const email =
  process.argv[2] || process.env.TEST_DONOR_EMAIL || "";

if (!email) {
  console.error("Pass an email: node scripts/test-email.js you@example.com");
  console.error("Or set TEST_DONOR_EMAIL in .env");
  process.exit(1);
}

const port = process.env.PORT || 8080;
const url = `https://localhost:${port}/api/donate/test-email`;

fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    email,
    name: "Test Donor",
    amount: "50.00",
    currency: "USD",
  }),
})
  .then(async (res) => {
    const text = await res.text();
    console.log(res.status, text);
    if (!res.ok) process.exit(1);
  })
  .catch((err) => {
    console.error("Request failed. Is npm start running on HTTPS?", err.message);
    process.exit(1);
  });
