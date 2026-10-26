// Daily reminders (pg_cron), ?kind=
//   morning (06:30 SGT) – today's slots
//   midday  (12:00 SGT) – what's left today (Mid 2 / PM)
//   evening (19:00 SGT) – tomorrow's slots
import { admin, getSecret, json, sgDate, fmtDate, esc, notify, APP_URL } from '../lib/common.js';
import { describe, SLOT_ORDER } from '../lib/parser.js';

const AFTERNOON = ['MID2', 'PM'];

// For midday: keep only the afternoon part of an assignment, or null if nothing is left
function afternoonOnly(a) {
  const slots = (a.slots || SLOT_ORDER.filter((s) => a.lessons[s])).filter((s) => AFTERNOON.includes(s));
  return slots.length ? { ...a, slots } : null;
}

export default async function handler(req: Request): Promise<Response> {
  const db = admin();
  const secret = await getSecret(db, 'CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) return json({ error: 'forbidden' }, 403);
  const kind = new URL(req.url).searchParams.get('kind') || 'evening';
  const date = kind === 'evening' ? sgDate(1) : sgDate(0);

  const { data: rows } = await db.from('assignments').select('company,instructor_id,slots,lessons').eq('date', date);
  const { data: off } = await db.from('contacts').select('instructor_id').eq('nightly_reminder', false);
  const optedOut = new Set((off || []).map((c) => c.instructor_id));

  const by = new Map<string, any[]>();
  for (const r of rows || []) {
    let a = { ...r, lessons: r.lessons || {} };
    if (kind === 'midday') { a = afternoonOnly(a); if (!a) continue; }
    if (!by.has(r.instructor_id)) by.set(r.instructor_id, []);
    by.get(r.instructor_id)!.push(a);
  }

  const head = kind === 'morning' ? `☀️ <b>Today, ${fmtDate(date)}</b>`
    : kind === 'midday' ? `🕛 <b>This afternoon</b>`
    : `🌙 <b>Tomorrow, ${fmtDate(date)}</b>`;
  const title = kind === 'morning' ? `Today, ${fmtDate(date)}` : kind === 'midday' ? 'This afternoon' : `Tomorrow, ${fmtDate(date)}`;

  let sent = 0;
  for (const [id, list] of by) {
    if (optedOut.has(id)) continue;
    const lines = [head, ...list.map((a) => `• ${esc(a.company)}: ${esc(describe(a))}`), '', `<a href="${APP_URL()}">Open roster</a>`];
    const body = list.map((a) => `${a.company}: ${describe(a)}`).join(' · ');
    if (await notify(db, id, lines.join('\n'), { title, body })) sent++;
  }
  return json({ ok: true, kind, date, people: by.size, sent });
}
