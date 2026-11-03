// Local end-to-end test against a local D1 (wrangler getPlatformProxy). Run: node test/local.mjs
import { getPlatformProxy } from 'wrangler';
import { runSync } from '../src/sync.js';
import { queueReminders } from '../src/reminder.js';
import { handleApi } from '../src/api.js';
import { ensureSecrets, drainOutbox, sgDate, addDays } from '../src/common.js';
import { hashPin } from '../src/pins.js';
import bcrypt from 'bcryptjs';

const { env: penv, dispose } = await getPlatformProxy();
const env = { ...penv, APP_URL: 'https://bmtc-roster.pages.dev' };
const db = env.DB;
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; };
const sql = (s, ...a) => db.prepare(s).bind(...a).all().then((r) => r.results);

// fresh tables
for (const t of ['outbox','sessions','pins','changes','assignments','day_notes','remarks','companies','sheet_tabs','unmatched_names','push_subscriptions','invite_codes','login_codes','contacts','instructors','sync_log','secrets'])
  await db.prepare(`delete from ${t}`).run();
await db.prepare("update settings set value = 'false' where key = 'initialized'").run();
await ensureSecrets(db);
await db.batch([
  db.prepare("insert into instructors(id,name,is_admin,aliases) values ('h','Haziq',1,'[]'),('w','Wesley',0,'[\"Wes\"]'),('z','Zuhair',1,'[]'),('k','Keith',0,'[\"Keith Pereira\"]')"),
]);
ok((await sql('select count(*) n from contacts'))[0].n === 4, 'contacts trigger creates a row per instructor');

// ---- a week grid in the sheet's layout ----
const serial = (iso) => Math.round((Date.parse(iso + 'T00:00:00Z') - Date.UTC(1899, 11, 30)) / 86400000);
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function week(startIso, cells) {
  const days = [0,1,2].map((i) => addDays(startIso, i));
  const hdr = ['Coy', 'S/No'], dates = ['', ''];
  for (const d of days) { hdr.push('Date/Day','AM','MID 1','MID 2','PM'); dates.push(serial(d), '', '', '', ''); }
  const grid = [hdr, dates];
  for (const [coy, perDay] of Object.entries(cells)) {
    const row = [coy, '1'];
    perDay.forEach((c) => row.push(c?.[0] || '', c?.[1] || '', '', '', c?.[2] || ''));
    grid.push(row);
  }
  grid.push(['Staff remarks', '', 'Wesley MC']);
  const s = new Date(startIso + 'T00:00:00Z'), e = new Date(addDays(startIso, 6) + 'T00:00:00Z');
  const title = `${s.getUTCDate()} ${MON[s.getUTCMonth()]} - ${e.getUTCDate()} ${MON[e.getUTCMonth()]} ${String(e.getUTCFullYear()).slice(2)}`;
  return [title, grid];
}
const today = sgDate(0);
const [t1, g1] = week(today, { Alpha: [['Haziq AM', 'IPPT'], ['Wesley', 'Run'], null], Bravo: [['Keith Pereira PM', '', 'Circuit'], ['Kelvin AM'], ['NO PT']] });

let r = await runSync(env, { grids: { [t1]: g1 } });
ok(r.ok && r.parsedTabs === 1, 'baseline sync parses the tab: ' + r.message);
ok((await sql('select count(*) n from assignments'))[0].n === 3, 'assignments stored');
ok((await sql('select count(*) n from outbox'))[0].n === 0, 'baseline sync sends no alerts');
const a = (await sql("select * from assignments where instructor_id='h'"))[0];
ok(a.slots === '["AM"]' && JSON.parse(a.lessons).AM === 'IPPT', 'slots and lessons kept as JSON');
ok((await sql('select * from unmatched_names'))[0]?.word === 'kelvin', 'unknown name "Kelvin" listed for admins');
ok((await sql('select count(*) n from remarks'))[0].n === 1 && (await sql('select count(*) n from day_notes'))[0].n >= 1, 'remarks and notes stored');

r = await runSync(env, { grids: { [t1]: g1 } });
ok(r.skipped === 1, 'unchanged tab is skipped');

const [, g1b] = week(today, { Alpha: [['Haziq PM', '', 'Swim'], ['Wesley', 'Run'], null], Bravo: [['Keith Pereira PM', '', 'Circuit'], ['Wesley AM'], ['NO PT']] });
r = await runSync(env, { grids: { [t1]: g1b } });
ok(r.changes === 2, 'change detected: ' + r.message);
const ob = await sql('select * from outbox order by id');
ok(ob.length === 2 && ob.some((o) => o.instructor_id === 'h' && /Last-minute/.test(o.html)), 'alerts queued, today flagged last-minute');
const ch = await sql("select * from changes where instructor_id='h'");
ok(ch.length === 1 && ch[0].kind === 'changed' && JSON.parse(ch[0].after).slots[0] === 'PM', 'change history stored');

const [t2, g2] = week(addDays(today, 7), { Alpha: [['Zuhair AM', 'IPPT'], null, null] });
r = await runSync(env, { grids: { [t1]: g1b, [t2]: g2 } });
ok(r.newWeeks === 1 && (await sql("select * from outbox where instructor_id='z'"))[0]?.html.includes('New week published'), 'new future week -> one summary per person');

await db.prepare('delete from outbox').run();
await db.prepare("insert or replace into assignments(date,company,instructor_id,slots,lessons) values (?, 'Alpha', 'w', '[\"MID2\"]', '{\"MID2\":\"Gym\"}')").bind(addDays(today, 1)).run();
let q = await queueReminders(env, 'evening');
ok(q.people === 1 && (await sql('select html from outbox'))[0].html.includes('Tomorrow'), 'evening reminder for tomorrow');
await db.prepare("update contacts set nightly_reminder = 0 where instructor_id = 'w'").run();
await db.prepare('delete from outbox').run();
q = await queueReminders(env, 'evening');
ok(q.people === 0, 'reminder respects opt-out');
await db.prepare("update contacts set nightly_reminder = 1 where instructor_id = 'w'").run();
q = await queueReminders(env, 'midday');
ok(q.people === 2, 'midday reminder only for afternoon slots (Haziq PM, Keith PM)');
const sent = await drainOutbox(env);
ok(sent === 2 && (await sql('select count(*) n from outbox'))[0].n === 0, 'outbox drained (no channels set up yet)');

// ---- API ----
const call = async (action, body = {}, token) => {
  const res = await handleApi(new Request('https://api.test/api', { method: 'POST', headers: token ? { Authorization: 'Bearer ' + token } : {}, body: JSON.stringify({ action, ...body }) }), env);
  return { status: res.status, ...(await res.json()) };
};
await db.prepare("insert into settings(key,value) values ('team_code','TEAM123') on conflict(key) do update set value='TEAM123'").run();
let j = await call('join-names', { code: 'TEAM123' });
ok(j.names?.length === 4, 'join list shows everyone not yet joined');
ok((await call('join-names', { code: 'nope' })).status === 403, 'wrong team code refused');
j = await call('join', { code: 'TEAM123', instructor_id: 'w', pin: '1234' });
ok(!!j.session, 'join gives a session');
const wTok = j.session;
ok((await call('join', { code: 'TEAM123', instructor_id: 'w', pin: '9999' })).status === 409, 'name cannot be joined twice');
ok((await call('me', {}, wTok)).me?.name === 'Wesley', 'session works');
ok((await call('pin-login', { name: 'wes', pin: '1234' })).session, 'PIN sign-in by alias');
for (let i = 0; i < 5; i++) await call('pin-login', { name: 'Wesley', pin: '0000' });
ok((await call('pin-login', { name: 'Wesley', pin: '1234' })).status === 429, 'locked after 5 wrong PINs');
await db.prepare("update pins set locked_until = null, failed = 0").run();

// PIN carried over from Supabase (bcrypt) still works, then is upgraded
await db.prepare('insert into pins(instructor_id, pin_hash) values (?, ?)').bind('h', bcrypt.hashSync('2468', 8)).run();
const hl = await call('pin-login', { name: 'haziq', pin: '2468' });
ok(!!hl.session, 'old bcrypt PIN accepted');
ok((await sql("select pin_hash from pins where instructor_id='h'"))[0].pin_hash.startsWith('pbkdf2$'), 'old PIN upgraded');
const hTok = hl.session;

const mr = await call('my-roster', {}, wTok);
ok(Array.isArray(mr.mine) && mr.mine.some((x) => x.slots?.[0] === 'MID2'), 'my roster returns parsed slots');
ok(mr.changes.length >= 1 && mr.changes[0].after, 'my roster includes recent changes');
const dv = await call('day', { date: today }, wTok);
ok(dv.assignments.length >= 2 && dv.remarks.length === 1, 'day view');
ok((await call('people-extra', {}, wTok)).status === 403, 'non-admin blocked from admin actions');
const base = await call('base', {}, hTok);
ok(base.people.length === 4 && base.people.find((p) => p.id === 'w').has_access && base.config.vapid_public_key, 'base: people, access flag, push key');
ok((await call('contact-set', { key: 'notify_push', value: false }, wTok)).ok && (await call('contact-get', {}, wTok)).contact.notify_push === false, 'settings switch saved');
ok((await call('contact-set', { key: 'is_admin', value: true }, wTok)).status === 400, 'cannot set other fields');
ok((await call('person-save', { person: { name: 'Danial', aliases: ['Dan'], school: 'Sch 2' } }, hTok)).ok, 'admin adds a person');
ok((await call('person-save', { person: { name: 'danial' } }, hTok)).error === 'That name already exists', 'duplicate name refused');
ok((await call('person-save', { id: 'h', person: { name: 'Haziq', is_admin: false } }, hTok)).status === 400, "can't remove own admin");
ok((await call('unmatched', {}, hTok)).names.length === 1, 'unmatched list');
ok((await call('unmatched-ignore', { word: 'kelvin' }, hTok)).ok && (await call('unmatched', {}, hTok)).names.length === 0, 'ignore name');
const si = await call('setup-info', {}, hTok);
ok(si.settings.initialized === 'true' && !('team_code' in si.settings) && si.log.length >= 1, 'setup info (team code not exposed)');
ok((await call('sheet-save', { sheet_id: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit' }, hTok)).ok
  && (await sql("select value from settings where key='sheet_id'"))[0].value === '1AbCdEfGhIjKlMnOpQrStUvWxYz012345', 'sheet link saved as ID');
ok((await call('team-link-status', {}, hTok)).link.endsWith('#join=TEAM123'), 'team link status');
ok((await call('reset-pin', { instructor_id: 'w' }, hTok)).ok && (await call('me', {}, wTok)).status === 401, 'reset PIN signs the person out');
ok((await call('revoke', { instructor_id: 'h' }, hTok)).status === 400, 'cannot revoke yourself');
ok((await call('push-subscribe', { subscription: { endpoint: 'https://push.example/x', keys: { p256dh: 'a', auth: 'b' } } }, hTok)).ok, 'push subscribe');
const tn = await call('test-notify', {}, hTok);
ok(tn.ok === false, 'test alert with no working channel reports false');
ok((await call('sign-out', {}, hTok)).ok && (await call('me', {}, hTok)).status === 401, 'sign out');

// login link from Telegram /login
const { sha256 } = await import('../src/common.js');
await db.prepare('insert into login_codes(code_hash, instructor_id, expires_at) values (?, ?, ?)').bind(await sha256('x'.repeat(30)), 'z', new Date(Date.now() + 60000).toISOString()).run();
const ex = await call('exchange-login', { code: 'x'.repeat(30) });
ok(!!ex.session, 'Telegram sign-in link works');
ok((await call('exchange-login', { code: 'x'.repeat(30) })).status === 400, 'sign-in link is one use');

// ---- reserves, leave remarks, BMTC events, core team ----
await db.prepare('delete from outbox').run();
await db.prepare("update instructors set is_core = 1 where id = 'k'").run();
const tom = addDays(today, 1);
function week3(startIso, rows, remarkRow) {
  const [t, g] = week(startIso, rows); g.pop(); g.push(['Staff remarks', '', ...remarkRow]); return [t, g];
}
const [t3, g3] = week3(addDays(today, 14), { Alpha: [['Haziq AM', 'IPPT'], null, null] }, ['']);
await runSync(env, { grids: { [t3]: g3 } }); // new week (summary); the syncs below are diffs
await db.prepare('delete from outbox').run();
const base3 = { Alpha: [['Haziq AM', 'IPPT'], null, null], Reserves: [['Keith AM'], null, null], BMTC: [['Zuhair', 'Range brief'], null, null] };
let [, g3b] = week3(addDays(today, 14), base3, ['Wesley OIL']);
r = await runSync(env, { grids: { [t3]: g3b } });
let obx = await sql('select * from outbox');
ok(obx.some((o) => o.instructor_id === 'k' && /reserve standby/.test(o.html)), 'reserve standby alert');
ok(obx.some((o) => o.instructor_id === 'w' && /Leave \/ off update/.test(o.html) && /OIL/.test(o.html)), 'OIL remark alerts the named person only');
ok(!obx.some((o) => o.instructor_id === 'h'), 'nobody else alerted');
await db.prepare('delete from outbox').run();
[, g3b] = week3(addDays(today, 14), { ...base3, Alpha: [['Haziq/Keith AM', 'IPPT'], null, null], Reserves: [[''], null, null] }, ['Wesley OIL']);
r = await runSync(env, { grids: { [t3]: g3b } });
obx = await sql('select * from outbox');
ok(obx.length === 1 && obx[0].instructor_id === 'k' && /You have been activated/.test(obx[0].html) && /ACTIVATED from reserve/.test(obx[0].html), 'reserve activation alert: ' + r.message);
const kTok = (await call('join', { code: 'TEAM123', instructor_id: 'k', pin: '1357' })).session;
const kr = await call('my-roster', {}, kTok);
ok(kr.changes.some((c) => c.after?.activated), 'activated change visible in history');
const wTok2 = (await call('join', { code: 'TEAM123', instructor_id: 'w', pin: '1234' })).session;
const d14 = addDays(today, 14);
ok((await call('day', { date: d14 }, kTok)).remarks.length === 1, "core team sees everyone's remarks");
await db.prepare("insert into remarks(date, instructor_id, text) values (?, 'h', 'Haziq LEAVE')").bind(d14).run();
ok((await call('day', { date: d14 }, wTok2)).remarks.length === 1, 'non-core person sees only own remark');
ok((await call('leave', {}, wTok2)).status === 403 && (await call('leave', {}, kTok)).remarks.length >= 2, 'leave page core-only');
ok((await sql("select * from assignments where company='BMTC'"))[0]?.instructor_id === 'z', 'BMTC event stored for Zuhair');
await db.prepare("insert into remarks(date, instructor_id, text) values (?, 'h', 'Haziq LEAVE')").bind(tom).run();
await db.prepare('delete from outbox').run();
await queueReminders(env, 'evening');
ok((await sql("select html from outbox where instructor_id='h'"))[0]?.html.includes('not on PT'), 'evening reminder includes leave');

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
await dispose();
process.exit(fails ? 1 : 0);
