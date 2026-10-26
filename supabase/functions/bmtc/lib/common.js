// Shared helpers for edge functions (Deno).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

export const admin = () =>
  createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

export const APP_URL = () => (Deno.env.get('APP_URL') || 'https://bmtc-roster.pages.dev').replace(/\/$/, '');

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// Singapore date helpers (UTC+8, no DST)
export function sgDate(offsetDays = 0) {
  const d = new Date(Date.now() + 8 * 3600000 + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}
export function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDate(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
}
export function relDay(iso) {
  if (iso === sgDate(0)) return ' (today)';
  if (iso === sgDate(1)) return ' (tomorrow)';
  return '';
}

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export function randomCode(bytes = 24) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Internal secrets live in env if set, else in the locked app_secrets table (service role only)
const secretCache = new Map();
export async function getSecret(db, name) {
  const env = Deno.env.get(name);
  if (env) return env;
  if (secretCache.has(name)) return secretCache.get(name);
  const { data } = await db.from('app_secrets').select('value').eq('name', name).maybeSingle();
  secretCache.set(name, data?.value ?? null);
  return data?.value ?? null;
}

// ---------- Telegram ----------
export async function tg(method, payload) {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
  if (!token) return { ok: false, description: 'TELEGRAM_BOT_TOKEN not set' };
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return r.json().catch(() => ({ ok: false }));
}
export const sendTelegram = (chat_id, html, extra = {}) =>
  tg('sendMessage', { chat_id, text: html, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });

// ---------- Web push ----------
let webpush = null;
async function getWebPush(db) {
  if (webpush) return webpush;
  const pub = await getSecret(db, 'VAPID_PUBLIC_KEY'), priv = await getSecret(db, 'VAPID_PRIVATE_KEY');
  if (!pub || !priv) return null;
  const mod = await import('npm:web-push@3.6.7');
  webpush = mod.default || mod;
  webpush.setVapidDetails('mailto:admin@bmtc-roster.app', pub, priv);
  return webpush;
}
export async function sendPush(db, instructorId, payload) {
  const wp = await getWebPush(db);
  if (!wp) return 0;
  const { data: subs } = await db.from('push_subscriptions').select('*').eq('instructor_id', instructorId);
  let sent = 0;
  for (const s of subs || []) {
    try {
      await wp.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 3600, urgency: 'high' });
      sent++;
    } catch (e) {
      if (e?.statusCode === 404 || e?.statusCode === 410) await db.from('push_subscriptions').delete().eq('id', s.id);
    }
  }
  return sent;
}

// Send to one instructor on every channel they have switched on.
// html = Telegram text; push = {title, body}
export async function notify(db, instructorId, html, push) {
  const { data: c } = await db.from('contacts').select('*').eq('instructor_id', instructorId).maybeSingle();
  let ok = false;
  if (c?.telegram_chat_id && c.notify_telegram) {
    const r = await sendTelegram(c.telegram_chat_id, html);
    ok = ok || !!r.ok;
  }
  if (push && (!c || c.notify_push)) {
    const n = await sendPush(db, instructorId, { ...push, url: APP_URL() });
    ok = ok || n > 0;
  }
  return ok;
}

export async function notifyAdmins(db, html, push) {
  const { data } = await db.from('instructors').select('id').eq('is_admin', true).eq('active', true);
  for (const a of data || []) await notify(db, a.id, html, push);
}

// Resolve the calling user (from the Authorization header) to an instructor row
export async function caller(req, db) {
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer /, '');
  if (!jwt) return null;
  const { data } = await db.auth.getUser(jwt);
  if (!data?.user) return null;
  const { data: me } = await db.from('instructors').select('*').eq('user_id', data.user.id).eq('active', true).maybeSingle();
  return me;
}

export async function getSetting(db, key) {
  const { data } = await db.from('settings').select('value').eq('key', key).maybeSingle();
  return data?.value ?? null;
}
export async function setSetting(db, key, value) {
  await db.from('settings').upsert({ key, value: value == null ? null : String(value) });
}
