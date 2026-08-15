-- CoachDesk BD — who is allowed to call an RPC.
--
-- 20260811000009 ends with this, and 20260811000003 says the same thing about
-- bootstrap_center:
--
--   revoke all on function ... from public;
--   grant execute on function ... to authenticated;
--
-- On a bare Postgres that shuts the door. On Supabase it does not. The project
-- ships default privileges of its own:
--
--   alter default privileges for role postgres in schema public
--     grant all on functions to postgres, anon, authenticated, service_role;
--
-- so at the moment a function is created, `anon` is handed EXECUTE explicitly.
-- PUBLIC is a different grantee; revoking PUBLIC leaves that grant standing. The
-- net effect is that every RPC in this schema is callable, with no session at
-- all, at POST /rest/v1/rpc/<name> — the opposite of what those two migrations
-- believed they had arranged. Confirmed by reading pg_proc.proacl on the live
-- project, which is also why scripts/lib/pg-harness.mjs now sets the same
-- default privileges: the local suite was passing this because it was testing a
-- database Supabase does not ship.
--
-- Nothing is handed over today. bootstrap_center raises 28000 the moment
-- auth.uid() is null, and import_students is security invoker, so its insert
-- dies on students_staff_admin_write. Both of those hold, and both are checked.
-- But "the body checks" is one edit away from not being true, and a request with
-- no session has no business reaching a function that writes rows. The grant is
-- the fence; the checks inside the body are what stands behind it.
--
-- service_role keeps EXECUTE: that key is server-only, never shipped to a
-- browser, and bypasses RLS by design.

revoke execute on function public.bootstrap_center(text, text, text, boolean)
  from anon, public;

revoke execute on function public.import_students(uuid, jsonb, uuid[])
  from anon, public;

-- The two trigger functions, for the same reason and with less at stake: a
-- trigger fires as part of the statement that provoked it and does not consult
-- EXECUTE, so nothing needs this grant. PostgREST will not expose a function
-- returning `trigger` either. Revoked anyway, because a function nobody should
-- ever call by name should not be callable by name.
revoke execute on function public.set_updated_at() from anon, public;
revoke execute on function public.enforce_marks_within_total() from anon, public;
