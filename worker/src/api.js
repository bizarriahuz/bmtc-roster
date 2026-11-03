// Everything the app does goes through POST /api with {action, ...}.
// Signed-in calls send "Authorization: Bearer <session token>".
import {
  json, sha256, randomCode, tg, esc, getSetting, setSetting, getSecret, APP_URL, first, all, run, nowIso, inList,
  sgDate, addDays, asAssignment, asInstructor, notifyNow, notifyAdmins,
} from './common.js';
import { serviceAccountEmail } from './google.js';
import { runSync, recordSyncError } from './sync.js';
import { hashPin, verifyPin } from './pins.js';

const CONTACT_KEYS = ['notify_telegram', 'notify_push', 'nightly_reminder'];

class AppError extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }
const fail = (msg, status) => { throw new AppError(msg, status); };

// A new signed-in session for this phone. Only the hash is stored.
async function issueSession(db, instructorId) {
  const token = randomCode(32);
  await run(db, 'insert into sessions(token_hash, instructor_id, last_seen) values (?, ?, ?)', await sha256(token), instructorId, nowIso());
  return token;
}

async function caller(req, db) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer /, '');
  if (!token) return null;
  const h = await sha256(token);
  const me = await first(db, `select i.*, s.last_seen from sessions s join instructors i on i.id = s.instructor_id and i.active = 1 where s.token_hash = ?`, h);
  if (me && (!me.last_seen || me.last_seen < new Date(Date.now() - 86400e3).toISOString())) {
    await run(db, 'update sessions set last_seen = ? where token_hash = ?', nowIso(), h);
  }
  return me ? { ...asInstructor(me), token_hash: h } : null;
}

async function botLink(db, payload) {
  const u = await getSetting(db, 'bot_username');
  return u ? `https://t.me/${u}?start=${payload}` : null;
}

async function teamCodeOk(db, code) {
  const t = await getSetting(db, 'team_code');
  return !!t && !!code && t === code;
}

async function checkPin(db, instructorId, pin) {
  const r = await first(db, 'select * from pins where instructor_id = ?', instructorId);
  if (!r) return 'nopin';
  if (r.locked_until && r.locked_until > nowIso()) return 'locked';
  const v = await verifyPin(pin, r.pin_hash);
  if (v.ok) {
    if (v.legacy) await run(db, 'update pins set pin_hash = ?, failed = 0, locked_until = null where instructor_id = ?', await hashPin(pin), instructorId);
    else await run(db, 'update pins set failed = 0, locked_until = null where instructor_id = ?', instructorId);
    return 'ok';
  }
  const failed = r.failed + 1;
  await run(db, 'update pins set failed = ?, locked_until = ? where instructor_id = ?',
    failed, failed >= 5 ? new Date(Date.now() + 15 * 60000).toISOString() : null, instructorId);
  return 'wrong';
}

async function forgetAccess(db, id, { telegram }) {
  const stmts = [
    db.prepare('delete from pins where instructor_id = ?').bind(id),
    db.prepare('delete from sessions where instructor_id = ?').bind(id),
  ];
  if (telegram) {
    stmts.push(
      db.prepare('update contacts set telegram_chat_id = null where instructor_id = ?').bind(id),
      db.prepare('delete from push_subscriptions where instructor_id = ?').bind(id),
      db.prepare('delete from invite_codes where instructor_id = ?').bind(id),
    );
  }
  await db.batch(stmts);
}

export async function handleApi(req, env) {
  const db = env.DB;
  let body = {};
  try { body = await req.json(); } catch { return json({ error: 'bad request' }, 400); }
  try {
    return json(await act(req, env, db, body.action, body));
  } catch (e) {
    if (e instanceof AppError) return json({ error: e.message }, e.status);
    console.error(body.action, e);
    return json({ error: String(e?.message || e) }, 500);
  }
}

async function act(req, env, db, action, body) {
  // ---------- public ----------
  if (action === 'public-config') {
    return { bot_username: await getSetting(db, 'bot_username'), vapid_public_key: await getSecret(db, 'VAPID_PUBLIC_KEY') };
  }

  if (action === 'exchange-login') {
    const code = String(body.code || '');
    if (code.length < 20) fail('invalid code');
    const h = await sha256(code);
    const lc = await first(db, 'select * from login_codes where code_hash = ?', h);
    if (!lc || lc.used_at || lc.expires_at < nowIso()) fail('This sign-in link has expired. Sign in with your name and PIN.');
    await run(db, 'update login_codes set used_at = ? where code_hash = ?', nowIso(), h);
    const inst = await first(db, 'select * from instructors where id = ?', lc.instructor_id);
    if (!inst?.active) fail('Your access has been removed.', 403);
    await run(db, 'delete from login_codes where expires_at < ?', new Date(Date.now() - 86400000).toISOString());
    return { session: await issueSession(db, inst.id) };
  }

  // ---- joining with the team link + PIN ----
  if (action === 'join-names') {
    if (!(await teamCodeOk(db, body.code))) fail('This join link is no longer active. Ask an admin for the current one.', 403);
    return { names: await all(db, `select id, name from instructors where active = 1
      and id not in (select instructor_id from pins) order by name collate nocase`) };
  }

  if (action === 'join') {
    if (!(await teamCodeOk(db, body.code))) fail('This join link is no longer active. Ask an admin for the current one.', 403);
    const pin = String(body.pin || '');
    if (!/^[0-9]{4,6}$/.test(pin)) fail('PIN must be 4 to 6 digits');
    const inst = await first(db, 'select * from instructors where id = ? and active = 1', String(body.instructor_id || ''));
    if (!inst) fail('That name is not on the roster');
    const r = await run(db, 'insert or ignore into pins(instructor_id, pin_hash) values (?, ?)', inst.id, await hashPin(pin));
    if (!r.meta.changes) fail(`${inst.name} has already joined. If that's you, sign in with your PIN or ask an admin to reset it.`, 409);
    await run(db, 'insert or ignore into contacts(instructor_id) values (?)', inst.id);
    await notifyAdmins(env, `👤 <b>${esc(inst.name)}</b> joined BMTC Roster.\nWrong person? Admin → People → Reset PIN.`, null);
    return { session: await issueSession(db, inst.id), name: inst.name };
  }

  if (action === 'pin-login') {
    const name = String(body.name || '').trim().toLowerCase();
    const pin = String(body.pin || '');
    const wrong = () => fail('Name or PIN is wrong', 401);
    if (!name || !pin) wrong();
    const people = (await all(db, 'select * from instructors where active = 1')).map(asInstructor);
    const inst = people.find((p) => p.name.toLowerCase() === name || p.aliases.some((a) => a.toLowerCase() === name));
    if (!inst) wrong();
    const res = await checkPin(db, inst.id, pin);
    if (res === 'locked') fail('Too many wrong tries. Wait 15 minutes, or ask an admin to reset your PIN.', 429);
    if (res === 'nopin') fail('You haven\'t joined yet. Use the join link from your team group.', 401);
    if (res !== 'ok') wrong();
    return { session: await issueSession(db, inst.id) };
  }

  // ---------- signed-in ----------
  const me = await caller(req, db);
  if (!me) fail('not signed in', 401);

  if (action === 'me') {
    const { token_hash, last_seen, ...rest } = me;
    return { me: rest };
  }

  if (action === 'sign-out') {
    await run(db, 'delete from sessions where token_hash = ?', me.token_hash);
    return { ok: true };
  }

  if (action === 'base') {
    const [p, c, s] = await db.batch([
      db.prepare(`select i.id, i.name, i.school, i.aliases, i.is_admin, i.is_core, i.active,
        exists (select 1 from sessions s where s.instructor_id = i.id) has_access from instructors i order by i.name collate nocase`),
      db.prepare('select * from companies order by sort'),
      db.prepare("select name, value from secrets where name = 'VAPID_PUBLIC_KEY'"),
    ]);
    return {
      people: p.results.map((x) => ({ ...asInstructor(x), has_access: !!x.has_access })),
      companies: c.results,
      config: { bot_username: await getSetting(db, 'bot_username'), vapid_public_key: s.results[0]?.value || null },
    };
  }

  if (action === 'my-roster') {
    const today = sgDate(0), until = addDays(today, 20);
    const [mine, changes, remarks] = await db.batch([
      db.prepare('select * from assignments where instructor_id = ? and date between ? and ? order by date').bind(me.id, today, until),
      db.prepare('select * from changes where instructor_id = ? order by created_at desc, id desc limit 8').bind(me.id),
      db.prepare('select * from remarks where instructor_id = ? and date between ? and ?').bind(me.id, today, until),
    ]);
    const mineRows = mine.results.map(asAssignment);
    let others = [];
    const dates = [...new Set(mineRows.map((a) => a.date))];
    if (dates.length) {
      const keys = new Set(mineRows.map((a) => `${a.date}|${a.company}`));
      others = (await all(db, `select date, company, instructor_id, slots from assignments where date in (${inList(dates)}) and instructor_id <> ?`, ...dates, me.id))
        .filter((o) => keys.has(`${o.date}|${o.company}`))
        .map((o) => ({ ...o, slots: o.slots ? JSON.parse(o.slots) : null }));
    }
    return {
      mine: mineRows,
      changes: changes.results.map((c) => ({ ...c, before: c.before ? JSON.parse(c.before) : null, after: c.after ? JSON.parse(c.after) : null, last_minute: !!c.last_minute })),
      remarks: remarks.results,
      others,
    };
  }

  if (action === 'day') {
    const d = String(body.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) fail('bad date');
    const [as, notes, remarks] = await db.batch([
      db.prepare('select * from assignments where date = ?').bind(d),
      db.prepare('select * from day_notes where date = ?').bind(d),
      // leave / MC / OIL: everyone's for the core team and admins, otherwise only your own
      db.prepare('select * from remarks where date = ? and (? = 1 or instructor_id = ?)').bind(d, me.is_core || me.is_admin ? 1 : 0, me.id),
    ]);
    return { assignments: as.results.map(asAssignment), notes: notes.results, remarks: remarks.results };
  }

  if (action === 'leave') {
    if (!me.is_core && !me.is_admin) fail('core team only', 403);
    const today = sgDate(0);
    return { remarks: await all(db, 'select date, instructor_id, text from remarks where date between ? and ? order by date, id', today, addDays(today, 13)) };
  }

  if (action === 'contact-get') {
    const c = await first(db, 'select * from contacts where instructor_id = ?', me.id);
    return { contact: c && { ...c, notify_telegram: !!c.notify_telegram, notify_push: !!c.notify_push, nightly_reminder: !!c.nightly_reminder } };
  }

  if (action === 'contact-set') {
    if (!CONTACT_KEYS.includes(body.key)) fail('unknown setting');
    await run(db, 'insert or ignore into contacts(instructor_id) values (?)', me.id);
    await run(db, `update contacts set ${body.key} = ? where instructor_id = ?`, body.value ? 1 : 0, me.id);
    return { ok: true };
  }

  if (action === 'push-subscribe') {
    const s = body.subscription;
    if (!s?.endpoint || !s?.keys?.p256dh || !s?.keys?.auth || !/^https:\/\//.test(s.endpoint)) fail('bad subscription');
    await db.batch([
      db.prepare(`insert into push_subscriptions(id, instructor_id, endpoint, p256dh, auth) values (?, ?, ?, ?, ?)
        on conflict(endpoint) do update set instructor_id = excluded.instructor_id, p256dh = excluded.p256dh, auth = excluded.auth`)
        .bind(crypto.randomUUID(), me.id, s.endpoint, s.keys.p256dh, s.keys.auth),
      db.prepare('insert or ignore into contacts(instructor_id) values (?)').bind(me.id),
    ]);
    return { ok: true };
  }

  if (action === 'telegram-link') {
    const code = randomCode(12);
    await db.batch([
      db.prepare('delete from invite_codes where instructor_id = ? and used_at is null').bind(me.id),
      db.prepare('insert into invite_codes(code, instructor_id, created_by) values (?, ?, ?)').bind(code, me.id, me.id),
    ]);
    const link = await botLink(db, `inv_${code}`);
    if (!link) fail('Telegram alerts are not set up yet');
    return { link };
  }

  if (action === 'test-notify') {
    const ok = await notifyNow(env, me.id, '🔔 Test alert from BMTC Roster. Notifications are working.', { title: 'BMTC Roster', body: 'Test alert: notifications are working.' });
    return { ok };
  }

  // ---------- admin ----------
  if (!me.is_admin) fail('admins only', 403);

  if (action === 'people-extra') {
    const [c, j] = await db.batch([
      db.prepare('select instructor_id, telegram_chat_id, telegram_username from contacts'),
      db.prepare('select instructor_id from pins'),
    ]);
    return { contacts: c.results, joined: j.results.map((r) => r.instructor_id) };
  }

  if (action === 'person-save') {
    const p = body.person || {};
    const name = String(p.name || '').trim();
    if (!name) fail('Name is required');
    const aliases = JSON.stringify([...new Set((Array.isArray(p.aliases) ? p.aliases : []).map((s) => String(s).trim()).filter(Boolean))]);
    const school = String(p.school || '').trim() || null;
    const isAdmin = p.is_admin ? 1 : 0, isCore = p.is_core ? 1 : 0, active = p.active === false ? 0 : 1;
    if (body.id === me.id && (!isAdmin || !active)) fail("You can't remove your own admin access");
    try {
      if (body.id) {
        await run(db, 'update instructors set name = ?, aliases = ?, school = ?, is_admin = ?, is_core = ?, active = ? where id = ?', name, aliases, school, isAdmin, isCore, active, String(body.id));
      } else {
        await run(db, 'insert into instructors(id, name, aliases, school, is_admin, is_core, active) values (?, ?, ?, ?, ?, ?, ?)', crypto.randomUUID(), name, aliases, school, isAdmin, isCore, active);
      }
    } catch (e) {
      if (/UNIQUE/i.test(String(e?.message))) fail('That name already exists');
      throw e;
    }
    return { ok: true };
  }

  if (action === 'unmatched') {
    return { names: await all(db, 'select * from unmatched_names where ignored = 0 order by last_date desc') };
  }

  if (action === 'unmatched-ignore') {
    await run(db, 'update unmatched_names set ignored = 1 where word = ?', String(body.word || ''));
    return { ok: true };
  }

  if (action === 'setup-info') {
    const [s, l] = await db.batch([
      db.prepare('select key, value from settings'),
      db.prepare('select * from sync_log order by id desc limit 12'),
    ]);
    const st = Object.fromEntries(s.results.filter((r) => r.key !== 'team_code').map((r) => [r.key, r.value]));
    return { settings: st, log: l.results.map((x) => ({ ...x, ok: !!x.ok })), service_account: serviceAccountEmail(env), sheet_id: st.sheet_id };
  }

  if (action === 'sheet-save') {
    const v = String(body.sheet_id || '').trim();
    const id = (v.match(/\/d\/([a-zA-Z0-9_-]{20,})/) || [])[1] || v;
    await setSetting(db, 'sheet_id', id || null);
    return { ok: true };
  }

  if (action === 'sheet-info') {
    return { service_account: serviceAccountEmail(env), sheet_id: await getSetting(db, 'sheet_id') };
  }

  if (action === 'invite') {
    const inst = await first(db, 'select id, name from instructors where id = ?', String(body.instructor_id || ''));
    if (!inst) fail('not found', 404);
    const code = randomCode(12);
    await db.batch([
      db.prepare('delete from invite_codes where instructor_id = ? and used_at is null').bind(inst.id),
      db.prepare('insert into invite_codes(code, instructor_id, created_by) values (?, ?, ?)').bind(code, inst.id, me.id),
    ]);
    const link = await botLink(db, `inv_${code}`);
    if (!link) fail('Connect the Telegram bot first (Admin → Settings).');
    return { link, name: inst.name };
  }

  if (action === 'team-link') {
    if (body.off) { await setSetting(db, 'team_code', null); return { link: null }; }
    let code = await getSetting(db, 'team_code');
    if (!code || body.rotate) { code = randomCode(9); await setSetting(db, 'team_code', code); }
    return { link: `${APP_URL(env)}/#join=${code}` };
  }

  if (action === 'team-link-status') {
    const code = await getSetting(db, 'team_code');
    return { link: code ? `${APP_URL(env)}/#join=${code}` : null };
  }

  if (action === 'revoke') {
    const inst = await first(db, 'select id from instructors where id = ?', String(body.instructor_id || ''));
    if (!inst) fail('not found', 404);
    if (inst.id === me.id) fail('You cannot revoke yourself');
    await forgetAccess(db, inst.id, { telegram: true });
    return { ok: true };
  }

  if (action === 'reset-pin') {
    const inst = await first(db, 'select id from instructors where id = ?', String(body.instructor_id || ''));
    if (!inst) fail('not found', 404);
    if (inst.id === me.id) fail('Ask another admin to reset your PIN');
    await forgetAccess(db, inst.id, { telegram: false });
    return { ok: true };
  }

  if (action === 'bot-setup') {
    const meBot = await tg(env, 'getMe', {});
    if (!meBot.ok) fail('Bot token missing or wrong: ' + (meBot.description || ''));
    await setSetting(db, 'bot_username', meBot.result.username);
    const url = `${new URL(req.url).origin}/telegram`;
    const wh = await tg(env, 'setWebhook', { url, secret_token: await getSecret(db, 'TELEGRAM_WEBHOOK_SECRET'), allowed_updates: ['message'], drop_pending_updates: true });
    await tg(env, 'setMyCommands', { commands: [
      { command: 'today', description: 'Your slots today' }, { command: 'tomorrow', description: 'Your slots tomorrow' },
      { command: 'week', description: 'Next 7 days' }, { command: 'login', description: 'Sign-in link for the app' },
      { command: 'mute', description: 'Pause alerts' }, { command: 'unmute', description: 'Resume alerts' },
    ] });
    return { ok: wh.ok, bot_username: meBot.result.username, webhook: wh.description };
  }

  if (action === 'sync-now') {
    try { return await runSync(env, { force: !!body.force }); }
    catch (e) { fail(await recordSyncError(db, e), 500); }
  }

  fail('unknown action');
}
