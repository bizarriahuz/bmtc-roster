// Daily reminders, queued for the every-minute sender:
//   morning (06:30 SGT) – today's slots
//   midday  (12:00 SGT) – what's left today (Mid 2 / PM)
//   evening (19:00 SGT) – tomorrow's slots
import { sgDate, fmtDate, esc, APP_URL, all, asAssignment } from './common.js';
import { describe, SLOT_ORDER } from './parser.js';

const AFTERNOON = ['MID2', 'PM'];

// For midday: keep only the afternoon part of an assignment, or null if nothing is left
function afternoonOnly(a) {
  const slots = (a.slots || SLOT_ORDER.filter((s) => a.lessons[s])).filter((s) => AFTERNOON.includes(s));
  return slots.length ? { ...a, slots } : null;
}

export async function queueReminders(env, kind) {
  const db = env.DB;
  const date = kind === 'evening' ? sgDate(1) : sgDate(0);
  const rows = (await all(db, `select a.company, a.instructor_id, a.slots, a.lessons from assignments a
    left join contacts c on c.instructor_id = a.instructor_id
    where a.date = ? and coalesce(c.nightly_reminder, 1) = 1`, date)).map(asAssignment);

  const by = new Map();
  for (const r of rows) {
    let a = r;
    if (kind === 'midday') { a = afternoonOnly(a); if (!a) continue; }
    if (!by.has(r.instructor_id)) by.set(r.instructor_id, []);
    by.get(r.instructor_id).push(a);
  }

  const head = kind === 'morning' ? `☀️ <b>Today, ${fmtDate(date)}</b>`
    : kind === 'midday' ? '🕛 <b>This afternoon</b>'
    : `🌙 <b>Tomorrow, ${fmtDate(date)}</b>`;
  const title = kind === 'morning' ? `Today, ${fmtDate(date)}` : kind === 'midday' ? 'This afternoon' : `Tomorrow, ${fmtDate(date)}`;

  const alerts = [...by].map(([id, list]) => ({
    id,
    html: [head, ...list.map((a) => `• ${esc(a.company)}: ${esc(describe(a))}`), '', `<a href="${APP_URL(env)}">Open roster</a>`].join('\n'),
    push: JSON.stringify({ title, body: list.map((a) => `${a.company}: ${describe(a)}`).join(' · ') }),
  }));
  if (alerts.length) {
    await db.prepare(`insert into outbox(instructor_id, html, push) select value->>'id', value->>'html', value->>'push' from json_each(?)`)
      .bind(JSON.stringify(alerts)).run();
  }
  return { kind, date, people: alerts.length };
}
