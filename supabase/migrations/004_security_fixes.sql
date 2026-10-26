-- Security check fixes (2026-10-26)
-- 1) "joined" view now runs with the caller's permissions; only admins can see who joined (2 columns, no PIN hashes)
drop view if exists public.joined;
grant select (instructor_id, set_at) on public.pins to authenticated;
create policy "admins see who joined" on public.pins for select to authenticated using (public.is_admin());
create view public.joined with (security_invoker = true) as select instructor_id, set_at from public.pins;
grant select on public.joined to authenticated;
revoke select on public.joined from anon;

-- 2) helper functions callable only when signed in
revoke execute on function public.is_admin(), public.is_member(), public.my_instructor_id() from anon, public;
grant execute on function public.is_admin(), public.is_member(), public.my_instructor_id() to authenticated;
