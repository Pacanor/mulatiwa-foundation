# Mulatiwa Foundation

A responsive website for Mulatiwa Foundation, a Zambian NGO focused on education, leadership, economic opportunity, wellbeing and community resilience. One-time donations (USD / ZMW) run through Cybersource Unified Checkout.

## Preview locally

```bash
cp .env.example .env
# Add Cybersource sandbox credentials — see DONATIONS.md
npm install
npm start
```

Open [http://localhost:8080](http://localhost:8080). The donate flow is at `/donate.html`.

You can still open `index.html` directly for static preview, but donation checkout requires the Node server.

## Project structure

- `index.html` — marketing page
- `donate.html` / `donate.js` — donation experience
- `styles.css` — shared visual design
- `script.js` — mobile navigation and scroll reveals
- `server/` — Express app: static files + `POST /api/donate/session`
- `DONATIONS.md` — Cybersource setup and production cutover

## Content sources

The website copy was developed from the Mulatiwa Foundation Constitution and the Mulatiwa Academy proposal. The visual identity is an initial design direction derived from the Academy's navy-and-gold palette and should be replaced or refined when official Foundation brand guidelines become available.
