-- BMTC Roster schema. The Google Sheet is the master; the sync function writes schedule tables
-- with the service role. Members only read. Invite-only: a login needs a linked instructor row.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------- people ----------
create table public.instructors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  school text,
  aliases text[] not null default '{}',
  is_admin boolean not null default false,
  active boolean not null default true,
  user_id uuid unique references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index instructors_name_lower on public.instructors (lower(name));

-- Contact / notification details: only the person themselves and admins can see them
create table public.contacts (
  instructor_id uuid primary key references public.instructors(id) on delete cascade,
  telegram_chat_id bigint unique,
  telegram_username text,
  notify_telegram boolean not null default true,
  notify_push boolean not null default true,
  nightly_reminder boolean not null default true,
  linked_at timestamptz
);

create table public.invite_codes (
  code text primary key,
  instructor_id uuid not null references public.instructors(id) on delete cascade,
  created_by uuid references public.instructors(id) on delete set null,
  created_at timestamptz not null default now(),
  used_at timestamptz
);

create table public.login_codes (
  code_hash text primary key,
  instructor_id uuid not null references public.instructors(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  instructor_id uuid not null references public.instructors(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

-- ---------- schedule (mirrors the sheet) ----------
create table public.companies (
  name text primary key,
  school text,
  sort int not null default 0
);

create table public.assignments (
  date date not null,
  company text not null,
  instructor_id uuid not null references public.instructors(id) on delete cascade,
  slots text[],               -- null = whole day; else subset of AM, MID1, MID2, PM
  lessons jsonb not null default '{}',
  raw text,
  primary key (date, company, instructor_id)
);
create index assignments_instructor_date on public.assignments (instructor_id, date);

create table public.day_notes (
  date date not null,
  company text not null,
  text text not null,
  lessons jsonb not null default '{}',
  primary key (date, company)
);

create table public.remarks (
  id bigint generated always as identity primary key,
  date date not null,
  instructor_id uuid references public.instructors(id) on delete set null,
  text text not null
);
create index remarks_date on public.remarks (date);

create table public.unmatched_names (
  word text primary key,         -- lower-case word that didn't match anyone
  sample text,                   -- an example cell it appeared in
  last_date date,
  company text,
  seen int not null default 1,
  ignored boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.sheet_tabs (
  title text primary key,
  start_date date,
  end_date date,
  content_hash text,
  first_seen timestamptz not null default now(),
  last_synced timestamptz
);

create table public.changes (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  instructor_id uuid not null references public.instructors(id) on delete cascade,
  date date not null,
  company text not null,
  kind text not null check (kind in ('added','removed','changed')),
  before jsonb,
  after jsonb,
  last_minute boolean not null default false,
  notified boolean not null default false
);
create index changes_instructor on public.changes (instructor_id, created_at desc);

create table public.swap_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  requester_id uuid not null references public.instructors(id) on delete cascade,
  target_id uuid not null references public.instructors(id) on delete cascade,
  date date not null,
  company text not null,
  note text,
  status text not null default 'pending'
    check (status in ('pending','accepted','declined','approved','rejected','cancelled')),
  decided_by uuid references public.instructors(id) on delete set null,
  decided_at timestamptz
);

create table public.settings (
  key text primary key,
  value text
);
insert into public.settings (key, value) values
  ('sheet_id', null), ('bot_username', null), ('last_sync_at', null),
  ('last_sync_status', null), ('initialized', 'false');

create table public.sync_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  ok boolean not null,
  message text,
  changes int not null default 0
);

-- ---------- helpers ----------
create or replace function public.my_instructor_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.instructors where user_id = auth.uid() and active
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.instructors where user_id = auth.uid() and active), false)
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.instructors where user_id = auth.uid() and active)
$$;

-- Atomic replacement of a set of dates with freshly parsed data (called by the sync function)
create or replace function public.replace_days(p_dates date[], p_assignments jsonb, p_notes jsonb, p_remarks jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.assignments where date = any(p_dates);
  delete from public.day_notes where date = any(p_dates);
  delete from public.remarks where date = any(p_dates);
  insert into public.assignments (date, company, instructor_id, slots, lessons, raw)
    select (a->>'date')::date, a->>'company', (a->>'instructor_id')::uuid,
           case when a->'slots' is null or jsonb_typeof(a->'slots') = 'null' then null
                else array(select jsonb_array_elements_text(a->'slots')) end,
           coalesce(a->'lessons', '{}'::jsonb), a->>'raw'
    from jsonb_array_elements(p_assignments) a
  on conflict do nothing;
  insert into public.day_notes (date, company, text, lessons)
    select (n->>'date')::date, n->>'company', n->>'text', coalesce(n->'lessons','{}'::jsonb)
    from jsonb_array_elements(p_notes) n
  on conflict (date, company) do update set text = excluded.text;
  insert into public.remarks (date, instructor_id, text)
    select (r->>'date')::date, nullif(r->>'instructor_id','')::uuid, r->>'text'
    from jsonb_array_elements(p_remarks) r;
end $$;
revoke execute on function public.replace_days(date[], jsonb, jsonb, jsonb) from public, anon, authenticated;

-- ---------- RLS ----------
alter table public.instructors enable row level security;
alter table public.contacts enable row level security;
alter table public.invite_codes enable row level security;
alter table public.login_codes enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.companies enable row level security;
alter table public.assignments enable row level security;
alter table public.day_notes enable row level security;
alter table public.remarks enable row level security;
alter table public.unmatched_names enable row level security;
alter table public.sheet_tabs enable row level security;
alter table public.changes enable row level security;
alter table public.swap_requests enable row level security;
alter table public.settings enable row level security;
alter table public.sync_log enable row level security;

-- members read the roster and schedule
create policy "members read instructors" on public.instructors for select to authenticated using (public.is_member());
create policy "admins insert instructors" on public.instructors for insert to authenticated with check (public.is_admin());
create policy "admins update instructors" on public.instructors for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins delete instructors" on public.instructors for delete to authenticated using (public.is_admin());

create policy "self or admin read contact" on public.contacts for select to authenticated
  using (instructor_id = public.my_instructor_id() or public.is_admin());
create policy "self update contact prefs" on public.contacts for update to authenticated
  using (instructor_id = public.my_instructor_id()) with check (instructor_id = public.my_instructor_id());

create policy "admins manage invites" on public.invite_codes for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "self read push" on public.push_subscriptions for select to authenticated using (instructor_id = public.my_instructor_id());
create policy "self delete push" on public.push_subscriptions for delete to authenticated using (instructor_id = public.my_instructor_id());

create policy "members read companies" on public.companies for select to authenticated using (public.is_member());
create policy "members read assignments" on public.assignments for select to authenticated using (public.is_member());
create policy "members read notes" on public.day_notes for select to authenticated using (public.is_member());
create policy "members read remarks" on public.remarks for select to authenticated using (public.is_member());
create policy "members read tabs" on public.sheet_tabs for select to authenticated using (public.is_member());

create policy "admins read unmatched" on public.unmatched_names for select to authenticated using (public.is_admin());
create policy "admins update unmatched" on public.unmatched_names for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "self or admin read changes" on public.changes for select to authenticated
  using (instructor_id = public.my_instructor_id() or public.is_admin());

create policy "involved read swaps" on public.swap_requests for select to authenticated
  using (requester_id = public.my_instructor_id() or target_id = public.my_instructor_id() or public.is_admin());

create policy "members read settings" on public.settings for select to authenticated using (public.is_member());
create policy "admins update settings" on public.settings for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins read sync log" on public.sync_log for select to authenticated using (public.is_admin());
