// Turns export.json (from export.sql) into import.sql for D1.
// Usage: node migrate/to-d1.mjs export.json > import.sql
//        npx wrangler d1 execute bmtc-roster --remote --file=import.sql
import { readFileSync } from 'node:fs';

let d = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (Array.isArray(d)) d = d[0];
if (d.export) d = d.export;
if (typeof d === 'string') d = JSON.parse(d);

const q = (v) => (v === null || v === undefined ? 'null' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const b = (v) => (v ? 1 : 0);
const ts = (v) => (v ? new Date(v).toISOString() : null);
const ins = (table, cols, rows) => rows.map((r) => `insert into ${table}(${cols.join(',')}) values (${r.map(q).join(',')});`);

const out = [
  'delete from outbox; delete from sessions; delete from changes; delete from push_subscriptions; delete from pins;',
  'delete from contacts; delete from assignments; delete from day_notes; delete from remarks; delete from sheet_tabs;',
  'delete from unmatched_names; delete from instructors; delete from secrets;',
  ...ins('instructors', ['id', 'name', 'school', 'aliases', 'is_admin', 'active', 'created_at'],
    d.instructors.map((i) => [i.id, i.name, i.school, JSON.stringify(i.aliases || []), b(i.is_admin), b(i.active), ts(i.created_at)])),
  // the insert trigger made empty contacts rows; replace them with the real ones
  ...ins('contacts', ['instructor_id', 'telegram_chat_id', 'telegram_username', 'notify_telegram', 'notify_push', 'nightly_reminder', 'linked_at'],
    d.contacts.map((c) => [c.instructor_id, c.telegram_chat_id, c.telegram_username, b(c.notify_telegram), b(c.notify_push), b(c.nightly_reminder), ts(c.linked_at)]))
    .map((s) => s.replace('insert into contacts', 'insert or replace into contacts')),
  ...ins('pins', ['instructor_id', 'pin_hash', 'set_at'], d.pins.map((p) => [p.instructor_id, p.pin_hash, ts(p.set_at)])),
  ...ins('push_subscriptions', ['id', 'instructor_id', 'endpoint', 'p256dh', 'auth', 'created_at'],
    d.push.map((p) => [p.id, p.instructor_id, p.endpoint, p.p256dh, p.auth, ts(p.created_at)])),
  ...d.settings.map((s) => `insert into settings(key, value) values (${q(s.key)}, ${q(s.value)}) on conflict(key) do update set value = excluded.value;`),
  "insert into settings(key, value) values ('initialized', 'false') on conflict(key) do update set value = 'false';",
  ...ins('secrets', ['name', 'value'], d.secrets.map((s) => [s.name, s.value])),
  ...ins('unmatched_names', ['word', 'sample', 'last_date', 'company', 'seen', 'ignored', 'updated_at'],
    d.unmatched.map((u) => [u.word, u.sample, u.last_date, u.company, u.seen, b(u.ignored), ts(u.updated_at)])),
];
process.stdout.write(out.join('\n') + '\n');
console.error(`instructors ${d.instructors.length}, joined ${d.pins.length}, phones ${d.push.length}, telegram ${d.contacts.filter((c) => c.telegram_chat_id).length}`);
