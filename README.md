# BMTC Roster

Watches the BMTC deployment Google Sheet, mirrors it into Supabase, and alerts instructors
(Telegram + web push) when their slots change.

- `web/` – the app (static; deploy to Cloudflare Pages as `bmtc-roster`)
- `supabase/functions/bmtc/` – one edge function with routes `/sync`, `/reminder`, `/telegram`, `/api`
- `supabase/migrations/` – database schema
- `test/` – parser tests against an exported .xlsx

Secrets set in Supabase → Edge Functions → Secrets: `TELEGRAM_BOT_TOKEN`, `GOOGLE_SERVICE_ACCOUNT_JSON`.
Internal keys (cron secret, webhook secret, VAPID) live in the locked `app_secrets` table.
