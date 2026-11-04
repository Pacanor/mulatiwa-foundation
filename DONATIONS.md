# Donations — Cybersource Unified Checkout

One-time gifts in **USD** and **ZMW**, card entry only. Cybersource completes the sale via `completeMandate.type: CAPTURE`. Transactions are reviewed in the Business Center; this site does not store card data or a donor database.

## What you need to do (checklist)

Code and DigitalOcean env wiring are in place. Finish these outside the repo:

### 1. Local testing (now)

| Step | Action |
|------|--------|
| Decline UI | Open `https://localhost:8080/donate.html?preview=declined` |
| Success UI | Open `https://localhost:8080/donate.html?preview=success` |
| Resend | Create API key at [resend.com](https://resend.com) → put in `.env` as `RESEND_API_KEY` → set `TEST_DONOR_EMAIL` to your inbox → restart `npm start` → run `npm run test-email` (or `node scripts/test-email.js you@email.com`) |
| Sandbox gift | Visa `4111111111111111` / `12/2026` / `123` on `/donate.html` → confirm success UI + emails + new row in `data/donations.csv` |

Verified domain sending uses `RESEND_FROM=Mulatiwa Foundation <donations@mulatiwafoundation.org>`.

### 2. DigitalOcean cutover (keep the current site live)

The live app is still the **old static site** (September build). Do **not** edit that app’s component type in place. Spin up a parallel Node app, then switch traffic when it looks good.

1. In DigitalOcean → **Apps** → **Create App** → GitHub → `Pacanor/mulatiwa-foundation` → branch `main`
2. Confirm it detects a **Web Service** (Node) from `.do/app.yaml` with `npm ci` / `npm start`, HTTP port `8080`
3. If the UI offers to import the app spec, accept `.do/app.yaml`
4. Add secrets before the first deploy finishes (or edit and redeploy):

| Secret | Value |
|--------|--------|
| `MERCHANT_ID` | `zanaco_mulatiwafou` |
| `CYBS_KEY_ID` / `CYBS_SECRET_KEY` | sandbox keys for now |
| `TARGET_ORIGINS` | `https://mulatiwa-foundation-2-qaz68.ondigitalocean.app` (no trailing slash); add custom domains later. The server also auto-allows its own host. |
| `RESEND_API_KEY` | from Resend |
| `RESEND_FROM` | `Mulatiwa Foundation <donations@mulatiwafoundation.org>` |

5. Set `PUBLIC_SITE_URL` to `https://mulatiwa-foundation-2-qaz68.ondigitalocean.app`
6. Wait until the new app is **Healthy**. Check:
   - `https://<new-app>/` (landing, no Donate buttons)
   - `https://<new-app>/donate.html`
   - `https://<new-app>/api/health` → JSON with `donate_ready` / `mail_ready`
7. Share the new donate URL with Prof for review
8. When ready: move any custom domain from the old static app to the new one (DNS/App Platform domains). Old static app stays up until you delete it
9. **Google Sheet ledger (no paid volume):** use spreadsheet
   `1-BfsegzvrqhRZAafrS43MGjfCKCUQ5jKHEIuLZ8zF1s`.
   1. Open [scripts/donation-ledger.gs](scripts/donation-ledger.gs)
   2. In [Apps Script](https://script.google.com/) create/open a project, paste the file, save
   3. Run `setupSheet` once (authorize access to the spreadsheet)
   4. Deploy → New deployment → Web app → Execute as Me → Anyone → Deploy
   5. Put the web app URL in App Platform secrets `DONATION_LEDGER_WEBHOOK_URL` and `DONATION_LEDGER_EXPORT_URL`
   6. Confirm `/api/health` shows `ledger_sheet: true`

### 3. Donate UI gating (static vs app)

Landing-page Donate buttons are marked `data-donate-gate` and stay `hidden` until `script.js` gets `{"status":"ok"}` from `/api/health`.

| Host | `/api/health` | Donate CTAs |
|------|---------------|-------------|
| Old static App Platform site | 404 / HTML | Hidden |
| New Node app | JSON ok | Shown |

So Prof can exercise the full flow on the Node URL while the public static domain stays unchanged. When you point the live domain at the Node app, Donate appears automatically.

### 4. After first production deploy

- [ ] Open live `/donate.html` and run a sandbox card gift (while `CYBS_ENV=test`)
- [ ] Confirm donor + Esther emails arrive
- [ ] Confirm a row lands in `/data/donations.csv` on the app volume (or download via console)
- [ ] Business Center → verify Apple Pay domain using the live HTTPS origin (file is already at `/.well-known/apple-developer-merchantid-domain-association`)
- [ ] When Zanaco confirms dual currency + go-live: set `CYBS_ENV=production` and production REST keys; one low-value real gift per currency

## Business Center prerequisites (sandbox)

Merchant: `zanaco_mulatiwafou` · Account: `zanaco_dm_acct` · Environment: **test**

1. **Enable Unified Checkout**  
   Payment Configuration → Unified Checkout → enable for this merchant. Prefer card / PAN entry only for Zambia.

2. **Create a REST Shared Secret key**  
   Payment Configuration → Key Management (or Account Management → API Keys) → Generate key → REST – Shared Secret.  
   Copy **Key ID** and **Shared Secret** into App Platform secrets / local `.env` as `CYBS_KEY_ID` and `CYBS_SECRET_KEY`. Set `MERCHANT_ID=zanaco_mulatiwafou`.

3. **Confirm dual currency**  
   Ask Zanaco / Cybersource that this MID can settle **both USD and ZMW**. If sandbox rejects one currency, disable that toggle on the donate page until settled.

4. **Sandbox smoke test**  
   Run the app locally with `.env` filled, open `/donate.html`, try a small USD and ZMW gift with [Unified Checkout test cards](https://developer.cybersource.com/docs/cybs/en-us/unified-checkout/developer/all/rest/unified-checkout/uc-reference-info/uc-appendix-test-cards.html). Confirm the sale appears under Transaction Management.

### Automated checks (no Cybersource keys required)

```bash
npm start
curl -sk https://localhost:8080/api/health
curl -sk -X POST https://localhost:8080/api/donate/session \
  -H 'Content-Type: application/json' \
  -d '{"amount":50,"currency":"EUR"}'
# expect: {"error":"currency must be USD or ZMW"}
```

### Full sandbox checklist (keys required)

- [ ] `.env` has sandbox `MERCHANT_ID`, `CYBS_KEY_ID`, `CYBS_SECRET_KEY`
- [ ] `TARGET_ORIGINS` includes `https://localhost:8080`
- [ ] Unified Checkout enabled on `zanaco_mulatiwafou`
- [ ] Donate USD preset → card entry → sale in Transaction Management
- [ ] Donate ZMW preset → card entry → sale in Transaction Management
- [ ] Cancel/close checkout returns to amount step without a false “success”
- [ ] If ZMW (or USD) is rejected by the MID, note it and hide that currency until Zanaco confirms settlement

## How to test UI states + Resend

### Success / declined screens (no payment needed)

```
https://localhost:8080/donate.html?preview=success
https://localhost:8080/donate.html?preview=declined
```

### Real declined payment (sandbox)

Try an invalid card such as Visa `4111111111111112` (fails Luhn) or an expired year like `01/2020`. Cybersource may block entry in the form or return a decline/error; the page should land on the declined state or a friendly retry message, never the success screen.

### Resend emails (no payment needed)

1. Create a free API key at [resend.com](https://resend.com)
2. Put it in `.env` as `RESEND_API_KEY`
3. Set `TEST_DONOR_EMAIL=your@email.com` (or pass `email` in the body)
4. Restart `npm start`, then:

```bash
npm run test-email
# or: node scripts/test-email.js your@email.com
```

You should receive:
- donor thank-you at the address you passed
- staff alert at `DONATION_NOTIFY_EMAIL` (default Prof. Esther)

From address: `Mulatiwa Foundation <donations@mulatiwafoundation.org>` (domain verified in Resend).

### Successful gift end-to-end

Use Visa `4111111111111111` / `12/2026` / `123`, complete checkout, confirm:
- success UI
- new row in `data/donations.csv`
- both emails if Resend is configured

### Staff giving log

Staff donation emails include a discreet **View recent donations** footer link to `/internal/giving?t=…`.

- Signed with `REPORT_SECRET` (falls back to `CYBS_SECRET_KEY`), valid ~7 days, reusable in that window
- Not linked from the public site; `robots.txt` disallows `/internal/`
- Invalid/expired tokens redirect to the landing page
- Period filters (from/to) work while the token is valid
- Shows approved and unsuccessful gifts, with mailto links when an email was captured

One-time tokens are intentionally avoided: many email clients prefetch links and would burn a single-use URL before anyone opens it.

Email previews: `/api/donate/email-preview?kind=donor|staff|failed`

## Apple Pay domain file

The Business Center Apple Pay setup file is hosted at:

`.well-known/apple-developer-merchantid-domain-association`

After deploy to HTTPS, return to Business Center → Payment Configuration → Unified Checkout / Apple Pay and click **Verify domain** using the live site origin (not localhost). Non-profit merchants may need extra Apple Pay for Donations enrollment with Zanaco/Apple.

## Local run

```bash
cp .env.example .env
# fill CYBS_KEY_ID and CYBS_SECRET_KEY
npm install
# one-time local HTTPS certs (Cybersource rejects http:// origins)
mkdir -p server/certs
openssl req -x509 -newkey rsa:2048 -keyout server/certs/dev-key.pem -out server/certs/dev-cert.pem -days 825 -nodes -subj "/CN=localhost"
npm start
# open https://localhost:8080/donate.html (accept the browser warning once)
```

`TARGET_ORIGINS` must be **HTTPS** and must match the browser origin exactly.

## Production cutover

1. Create a **production** REST Shared Secret key in the live Business Center (same merchant once live).
2. Set App Platform secrets: `MERCHANT_ID`, `CYBS_KEY_ID`, `CYBS_SECRET_KEY`, `CYBS_ENV=production`.
3. Set `TARGET_ORIGINS` to the live HTTPS origin only (or include staging if needed).
4. Redeploy; run one real low-value test gift in each currency; verify settlement with Zanaco.
5. Keep sandbox keys out of production env.

## Emails + CSV ledger (no Google, no database)

After each approved gift the server:

1. Appends a row to `data/donations.csv` (or `$DATA_DIR/donations.csv`)
2. Emails the donor a thank-you (Resend)
3. Emails Prof. Esther at `e.munalula@mulatiwafoundation.org` with who / when / how much

CSV columns: `recorded_at,status,amount,currency,donor_name,donor_email,reference`

On DigitalOcean, `.do/app.yaml` mounts a persistent volume at `/data` with `DATA_DIR=/data` so the CSV survives redeploys. Locally it writes under `data/` (gitignored).

### Resend setup

1. Create a free [Resend](https://resend.com) account and API key
2. Set `RESEND_API_KEY` (and optionally verify a sending domain, then set `RESEND_FROM`)
3. Keep `DONATION_NOTIFY_EMAIL=e.munalula@mulatiwafoundation.org`

### Weekly report (Monday 08:30 CAT)

Node cron schedules `runWeeklyReport()` Mondays at 08:30 `Africa/Lusaka` when `WEEKLY_REPORT_CRON=true`, reading the on-server CSV. Manual test: `npm run weekly-report`

## Ops

- Authoritative payment ledger / refunds: Cybersource Business Center → Transaction Management
- On-server mirror: `donations.csv` (open in Excel / Numbers anytime)
- Declined / abandoned checkouts show a clear result screen; only approved gifts trigger donor + staff emails.
