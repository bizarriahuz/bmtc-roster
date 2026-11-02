// Shared helpers for the BMTC Roster Worker.
import { importVapidRaw, makeVapidRaw, sendPush } from './push.js';

export const APP_URL = (env) => (env.APP_URL || 'https://bmtc-roster.pages.dev').replace(/\/$/, '');

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};
export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// ---------- D1 ----------
export const all = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;
export const first = (db, sql, ...args) => db.prepare(sql).bind(...args).first();
export const run = (db, sql, ...args) => db.prepare(sql).bind(...args).run();
export const nowIso = () => new Date().toISOString();
export const inList = (arr) => arr.map(() => '?').join(',') || 'null';

// Rows come back with JSON stored as text and booleans as 0/1; turn them back into what the app expects.
export function asAssignment(r) {
  return { ...r, slots: r.slots ? JSON.parse(r.slots) : null, lessons: r.lessons ? JSON.parse(r.lessons) : {} };
}
export function asInstructor(r) {
  return r && { ...r, aliases: JSON.parse(r.aliases || '[]'), is_admin: !!r.is_admin, active: !!r.active };
}

// ---------- Singapore dates (UTC+8, no DST) ----------
export function sgDate(offsetDays = 0) {
  return new Date(Date.now() + 8 * 3600000 + offsetDays * 86400000).toISOString().slice(0, 10);
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

// ---------- settings / secrets ----------
export async function getSetting(db, key) {
  return (await first(db, 'select value from settings where key = ?', key))?.value ?? null;
}
export async function setSetting(db, key, value) {
  await run(db, 'insert into settings(key, value) values (?, ?) on conflict(key) do update set value = excluded.value', key, value == null ? null : String(value));
}
export async function getSecret(db, name) {
  return (await first(db, 'select value from secrets where name = ?', name))?.value ?? null;
}
export async function ensureSecrets(db) {
  const have = new Map((await all(db, 'select name, value from secrets')).map((r) => [r.name, r.value]));
  const add = [];
  if (!have.get('VAPID_PUBLIC_KEY')) {
    const k = await makeVapidRaw();
    add.push(['VAPID_PUBLIC_KEY', k.publicKey], ['VAPID_PRIVATE_KEY', k.privateKey]);
  }
  if (!have.get('TELEGRAM_WEBHOOK_SECRET')) add.push(['TELEGRAM_WEBHOOK_SECRET', randomCode(24)]);
  if (add.length) {
    await db.batch(add.map(([n, v]) => db.prepare('insert or ignore into secrets(name, value) values (?, ?)').bind(n, v)));
  }
}

// ---------- Telegram ----------
export async function tg(env, method, payload) {
  if (!env.TELEGRAM_BOT_TOKEN) return { ok: false, description: 'TELEGRAM_BOT_TOKEN not set' };
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return r.json().catch(() => ({ ok: false }));
}
export const sendTelegram = (env, chat_id, html, extra = {}) =>
  tg(env, 'sendMessage', { chat_id, text: html, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });

// ---------- sending alerts ----------
// A "sender" sends to many people within one run, sharing the VAPID key and counting outgoing requests
// (the free plan allows 50 per run; we stop at `budget`).
export async function makeSender(env, budget = 40) {
  const db = env.DB;
  const pub = await getSecret(db, 'VAPID_PUBLIC_KEY'), priv = await getSecret(db, 'VAPID_PRIVATE_KEY');
  const vapid = pub && priv ? await importVapidRaw(pub, priv) : null;
  const jwtCache = new Map();
  const gone = [];
  const s = {
    left: budget,
    // Send to one instructor on every channel they have switched on. html = Telegram text; push = {title, body}
    async notify(instructorId, html, push, contact, subs) {
      if (contact === undefined) contact = await first(db, 'select * from contacts where instructor_id = ?', instructorId);
      if (subs === undefined) subs = await all(db, 'select * from push_subscriptions where instructor_id = ?', instructorId);
      let ok = false;
      if (contact?.telegram_chat_id && contact.notify_telegram) {
        s.left--;
        const r = await sendTelegram(env, contact.telegram_chat_id, html);
        ok = ok || !!r.ok;
      }
      if (push && vapid && (!contact || contact.notify_push)) {
        for (const sub of subs) {
          s.left--;
          try {
            const status = await sendPush(sub, { ...push, url: APP_URL(env) }, vapid, jwtCache);
            if (status === 404 || status === 410) gone.push(sub.id);
            else if (status >= 200 && status < 300) ok = true;
          } catch { /* network error: skip */ }
        }
      }
      return ok;
    },
    async finish() {
      if (gone.length) await run(db, `delete from push_subscriptions where id in (${inList(gone)})`, ...gone);
    },
  };
  return s;
}

// Send now (for one person: test alert, admins on a join).
export async function notifyNow(env, instructorId, html, push) {
  const s = await makeSender(env);
  const ok = await s.notify(instructorId, html, push);
  await s.finish();
  return ok;
}
export async function notifyAdmins(env, html, push) {
  const s = await makeSender(env);
  for (const a of await all(env.DB, 'select id from instructors where is_admin = 1 and active = 1')) await s.notify(a.id, html, push);
  await s.finish();
}

// Queue alerts for many people; the every-minute job sends them in batches.
export function queueStmt(db, instructorId, html, push) {
  return db.prepare('insert into outbox(instructor_id, html, push) values (?, ?, ?)').bind(instructorId, html, push ? JSON.stringify(push) : null);
}

export async function drainOutbox(env, budget = 35) {
  const db = env.DB;
  await run(db, "delete from outbox where created_at < ?", new Date(Date.now() - 6 * 3600e3).toISOString());   // stale alerts are no use
  const jobs = await all(db, 'select * from outbox order by id limit 30');
  if (!jobs.length) return 0;
  const ids = [...new Set(jobs.map((j) => j.instructor_id))];
  const [contacts, subs] = await db.batch([
    db.prepare(`select * from contacts where instructor_id in (${inList(ids)})`).bind(...ids),
    db.prepare(`select * from push_subscriptions where instructor_id in (${inList(ids)})`).bind(...ids),
  ]);
  const cBy = new Map(contacts.results.map((c) => [c.instructor_id, c]));
  const s = await makeSender(env, budget);
  const done = [];
  for (const j of jobs) {
    const mine = subs.results.filter((x) => x.instructor_id === j.instructor_id);
    const c = cBy.get(j.instructor_id) || null;
    const cost = (c?.telegram_chat_id && c.notify_telegram ? 1 : 0) + mine.length;
    if (cost > s.left) break;                                 // the rest go next minute
    done.push(j.id);
    await s.notify(j.instructor_id, j.html, j.push ? JSON.parse(j.push) : null, c, mine);
  }
  if (done.length) await run(db, `delete from outbox where id in (${inList(done)})`, ...done);
  await s.finish();
  return done.length;
}
