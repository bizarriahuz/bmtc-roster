-- BMTC Roster — Cloudflare D1 database. Safe to run again.
-- Dates 'YYYY-MM-DD' (Singapore), timestamps ISO-8601 UTC, booleans 0/1, lists/objects as JSON text.

-- ---------- people ----------
create table if not exists instructors (
  id         text primary key,
  name       text not null,
  school     text,
  aliases    text not null default '[]',
  is_admin   integer not null default 0,
  is_core    integer not null default 0,   -- core team: sees everyone's leave / remarks
  active     integer not null default 1,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create unique index if not exists instructors_name on instructors(name collate nocase);

-- Every instructor gets a contacts row (so the Settings switches work).
create trigger if not exists instructors_contact after insert on instructors
begin insert or ignore into contacts(instructor_id) values (new.id); end;

create table if not exists contacts (
  instructor_id     text primary key references instructors(id) on delete cascade,
  telegram_chat_id  integer unique,
  telegram_username text,
  notify_telegram   integer not null default 1,
  notify_push       integer not null default 1,
  nightly_reminder  integer not null default 1,
  linked_at         text
);

create table if not exists pins (
  instructor_id text primary key references instructors(id) on delete cascade,
  pin_hash      text not null,
  failed        integer not null default 0,
  locked_until  text,
  set_at        text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Signed-in phones. Only a hash of each session token is stored.
create table if not exists sessions (
  token_hash    text primary key,
  instructor_id text not null references instructors(id) on delete cascade,
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen     text
);
create index if not exists sessions_instructor on sessions(instructor_id);

create table if not exists invite_codes (
  code          text primary key,
  instructor_id text not null references instructors(id) on delete cascade,
  created_by    text,
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  used_at       text
);

create table if not exists login_codes (
  code_hash     text primary key,
  instructor_id text not null references instructors(id) on delete cascade,
  expires_at    text not null,
  used_at       text
);

create table if not exists push_subscriptions (
  id            text primary key,
  instructor_id text not null references instructors(id) on delete cascade,
  endpoint      text not null unique,
  p256dh        text not null,
  auth          text not null,
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------- schedule (mirrors the sheet) ----------
create table if not exists companies (
  name   text primary key,
  school text,
  sort   integer not null default 0
);

create table if not exists assignments (
  date          text not null,
  company       text not null,
  instructor_id text not null references instructors(id) on delete cascade,
  slots         text,                       -- null = whole day; else JSON list of AM, MID1, MID2, PM
  lessons       text not null default '{}',
  raw           text,
  info          text,                       -- BMTC events: time / venue
  primary key (date, company, instructor_id)
);
create index if not exists assignments_instructor_date on assignments(instructor_id, date);

create table if not exists day_notes (
  date    text not null,
  company text not null,
  text    text not null,
  lessons text not null default '{}',
  primary key (date, company)
);

create table if not exists remarks (
  id            integer primary key autoincrement,
  date          text not null,
  instructor_id text references instructors(id) on delete set null,
  text          text not null
);
create index if not exists remarks_date on remarks(date);

create table if not exists unmatched_names (
  word       text primary key,
  sample     text,
  last_date  text,
  company    text,
  seen       integer not null default 1,
  ignored    integer not null default 0,
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

create table if not exists sheet_tabs (
  title        text primary key,
  start_date   text,
  end_date     text,
  content_hash text,
  first_seen   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_synced  text
);

create table if not exists changes (
  id            integer primary key autoincrement,
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  instructor_id text not null references instructors(id) on delete cascade,
  date          text not null,
  company       text not null,
  kind          text not null check (kind in ('added','removed','changed')),
  before        text,
  after         text,
  last_minute   integer not null default 0,
  notified      integer not null default 0
);
create index if not exists changes_instructor on changes(instructor_id, created_at);

create table if not exists settings (
  key   text primary key,
  value text
);
insert or ignore into settings(key, value) values
  ('sheet_id', null), ('bot_username', null), ('last_sync_at', null), ('last_sync_status', null), ('initialized', 'false');

-- Internal keys (VAPID, Telegram webhook secret). Never sent to the app.
create table if not exists secrets (
  name  text primary key,
  value text
);

create table if not exists sync_log (
  id      integer primary key autoincrement,
  at      text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ok      integer not null,
  message text,
  changes integer not null default 0
);

-- Alerts waiting to be sent. The every-minute job sends a batch per run.
create table if not exists outbox (
  id            integer primary key autoincrement,
  instructor_id text not null,
  html          text not null,
  push          text,
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
