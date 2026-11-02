-- Run once in the OLD Supabase project. Returns one JSON value: save it as export.json.
-- The schedule itself is not copied: the first sync on Cloudflare rebuilds it from the Google Sheet
-- (quietly, as a baseline, so nobody gets duplicate alerts). The "Recent changes" list starts fresh.
select json_build_object(
  'instructors', (select coalesce(json_agg(i), '[]') from public.instructors i),
  'contacts',    (select coalesce(json_agg(c), '[]') from public.contacts c),
  'pins',        (select coalesce(json_agg(json_build_object('instructor_id', instructor_id, 'pin_hash', pin_hash, 'set_at', set_at)), '[]') from public.pins),
  'push',        (select coalesce(json_agg(p), '[]') from public.push_subscriptions p),
  'settings',    (select coalesce(json_agg(s), '[]') from public.settings s where key in ('sheet_id', 'bot_username', 'team_code')),
  'secrets',     (select coalesce(json_agg(a), '[]') from public.app_secrets a where name in ('VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'TELEGRAM_WEBHOOK_SECRET')),
  'unmatched',   (select coalesce(json_agg(u), '[]') from public.unmatched_names u)
) as export;
