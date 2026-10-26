-- PIN sign-in (applied 2026-10-26). PINs are bcrypt-hashed; 5 wrong tries lock for 15 minutes.
create table public.pins (
  instructor_id uuid primary key references public.instructors(id) on delete cascade,
  pin_hash text not null,
  failed int not null default 0,
  locked_until timestamptz,
  set_at timestamptz not null default now()
);
alter table public.pins enable row level security;
revoke all on public.pins from anon, authenticated;

create or replace function public.set_pin(p_instructor uuid, p_pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_pin !~ '^[0-9]{4,6}$' then raise exception 'PIN must be 4 to 6 digits'; end if;
  insert into public.pins (instructor_id, pin_hash) values (p_instructor, crypt(p_pin, gen_salt('bf', 8)))
  on conflict (instructor_id) do update set pin_hash = excluded.pin_hash, failed = 0, locked_until = null, set_at = now();
end $$;

create or replace function public.check_pin(p_instructor uuid, p_pin text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare r public.pins;
begin
  select * into r from public.pins where instructor_id = p_instructor for update;
  if not found then return 'nopin'; end if;
  if r.locked_until is not null and r.locked_until > now() then return 'locked'; end if;
  if r.pin_hash = crypt(p_pin, r.pin_hash) then
    update public.pins set failed = 0, locked_until = null where instructor_id = p_instructor;
    return 'ok';
  end if;
  update public.pins set failed = r.failed + 1,
    locked_until = case when r.failed + 1 >= 5 then now() + interval '15 minutes' else null end
  where instructor_id = p_instructor;
  return 'wrong';
end $$;

revoke execute on function public.set_pin(uuid, text) from public, anon, authenticated;
revoke execute on function public.check_pin(uuid, text) from public, anon, authenticated;

create or replace view public.joined as select instructor_id, set_at from public.pins;
grant select on public.joined to authenticated;
alter view public.joined set (security_invoker = false);
revoke select on public.joined from anon;

-- 003: every instructor gets a contacts row (so Settings switches work); three daily reminders
insert into public.contacts (instructor_id) select id from public.instructors on conflict do nothing;
create or replace function public.ensure_contact() returns trigger language plpgsql security definer set search_path = public as $$
begin insert into public.contacts (instructor_id) values (new.id) on conflict do nothing; return new; end $$;
create trigger instructors_contact after insert on public.instructors for each row execute function public.ensure_contact();
revoke execute on function public.ensure_contact() from public, anon, authenticated;
-- cron (UTC): bmtc-reminder-morning '30 22 * * *' (06:30 SGT), bmtc-reminder-midday '0 4 * * *' (12:00),
-- bmtc-reminder '0 11 * * *' (19:00), each POSTing /functions/v1/bmtc/reminder?kind=... with x-cron-secret
