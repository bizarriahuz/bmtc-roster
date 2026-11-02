// BMTC Roster Worker: the app's API, the Telegram webhook, and the every-minute job
// (send queued alerts; sync the Google Sheet every 5 minutes; daily reminders at 06:30, 12:00 and 19:00 SGT).
import { CORS, json, ensureSecrets, drainOutbox } from './common.js';
import { handleApi } from './api.js';
import { handleTelegram } from './telegram.js';
import { runSync, recordSyncError } from './sync.js';
import { queueReminders } from './reminder.js';

// Singapore clock time -> reminder kind
const REMINDERS = { '06:30': 'morning', '12:00': 'midday', '19:00': 'evening' };

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const path = new URL(req.url).pathname.replace(/\/+$/, '');
    await ensureSecrets(env.DB);
    if (req.method === 'POST' && path === '/api') return handleApi(req, env);
    if (req.method === 'POST' && path === '/telegram') return handleTelegram(req, env);
    if (path === '') return new Response('BMTC Roster API is running.', { headers: CORS });
    return json({ error: 'not found' }, 404);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(tick(env, new Date(event.scheduledTime)));
  },
};

export async function tick(env, at = new Date()) {
  await ensureSecrets(env.DB);
  const sg = new Date(at.getTime() + 8 * 3600e3);
  const hhmm = sg.toISOString().slice(11, 16);
  const out = {};
  if (REMINDERS[hhmm]) out.reminders = await queueReminders(env, REMINDERS[hhmm]);
  if (sg.getUTCMinutes() % 5 === 0) {
    try { out.sync = await runSync(env); }
    catch (e) { out.sync = { ok: false, error: await recordSyncError(env.DB, e) }; }
  }
  // Free plan: 50 outgoing requests per run. Leave room for the sync's Google and database calls.
  out.sent = await drainOutbox(env, out.sync ? 20 : 35);
  return out;
}
