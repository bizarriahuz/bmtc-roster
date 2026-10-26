// Nightly "tomorrow" reminder (pg_cron, ~20:00 SGT).
import { admin, getSecret, json, sgDate, fmtDate, esc, notify, APP_URL } from '../lib/common.js';
import { describe } from '../lib/parser.js';

export default async function handler(req: Request): Promise<Response> {
  const db = admin();
  const secret = await getSecret(db, 'CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) return json({ error: 'forbidden' }, 403);
  const tomorrow = sgDate(1);
  const { data: rows } = await db.from('assignments').select('company,instructor_id,slots,lessons').eq('date', tomorrow);
  const { data: contacts } = await db.from('contacts').select('instructor_id,nightly_reminder').eq('nightly_reminder', true);
  const wants = new Set((contacts || []).map((c) => c.instructor_id));
  const by = new Map<string, any[]>();
  for (const r of rows || []) { if (!by.has(r.instructor_id)) by.set(r.instructor_id, []); by.get(r.instructor_id)!.push(r); }
  let sent = 0;
  for (const [id, list] of by) {
    if (!wants.has(id)) continue;
    const lines = [`🌙 <b>Tomorrow, ${fmtDate(tomorrow)}</b>`, ...list.map((a) => `• ${esc(a.company)}: ${esc(describe({ ...a, lessons: a.lessons || {} }))}`), '', `<a href="${APP_URL()}">Open roster</a>`];
    const body = list.map((a) => `${a.company}: ${describe({ ...a, lessons: a.lessons || {} })}`).join(' · ');
    if (await notify(db, id, lines.join('\n'), { title: `Tomorrow, ${fmtDate(tomorrow)}`, body })) sent++;
  }
  return json({ ok: true, sent });
}
