# BMTC Roster

Watches the BMTC deployment Google Sheet, mirrors it into a database, and alerts instructors
(Telegram + web push) when their slots change. Runs free on Cloudflare.

- `web/` – the app (static; Cloudflare Pages project `bmtc-roster`, deploys from GitHub)
- `worker/` – Cloudflare Worker `bmtc-roster-api` with D1 database `bmtc-roster`
  - `POST /api` – everything the app does (`src/api.js`)
  - `POST /telegram` – Telegram bot webhook (`src/telegram.js`)
  - every minute (cron): send queued alerts; every 5 minutes: sync the Sheet (`src/sync.js`);
    06:30, 12:00 and 19:00 Singapore time: daily reminders (`src/reminder.js`)
  - `schema.sql` – database tables (safe to run again)
  - `migrate/` – one-off copy of people, PINs and alert settings from the old Supabase project
- `test/` – parser tests against an exported .xlsx; `worker/test/local.mjs` – end-to-end test on a local database

Worker secrets (Cloudflare → Workers & Pages → bmtc-roster-api → Settings → Variables and Secrets):
`TELEGRAM_BOT_TOKEN`, `GOOGLE_SERVICE_ACCOUNT_JSON`.
Internal keys (VAPID for phone notifications, Telegram webhook secret) are created automatically
and live in the `secrets` table.

Sign-in: people join with the team link and a PIN; each phone gets its own session.
Admin → People → Reset PIN / Remove access signs that person out everywhere.

Alerts are queued and sent by the every-minute job, at most about 35 messages a minute
(the free plan's limit per run), so a reminder to the whole team goes out within two minutes.

## Deploys
- `web/` → Cloudflare Pages (Git-connected).
- `worker/` → `.github/workflows/deploy-worker.yml` on every push to `main` that changes it.
  Needs repository secrets `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`
  (Workers Scripts: Edit, D1: Edit, Account Settings: Read).

## Local
```bash
cd worker && npm install
npx wrangler d1 execute bmtc-roster --local --file=schema.sql
node test/local.mjs        # end-to-end checks
npx wrangler dev           # API on http://localhost:8787
```
