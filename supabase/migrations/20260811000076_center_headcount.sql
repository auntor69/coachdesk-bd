-- ---------------------------------------------------------------------------
-- The organisation's headcount, readable by a manager who is pinned to one branch.
--
-- THE BUG THIS EXISTS TO FIX. MASTERPLAN.md §3.6: a student place is a licence and
-- licences pool across the organisation, so `session.ceiling` is one number for the
-- whole institution. Four screens pair that ceiling with a count taken through the
-- reader's own client — and since 20260811000053, `students_branch_scope` narrows that
-- count to the reader's branch. For head office the two halves agree. For a manager
-- pinned to Mirpur they do not: 40 of their own students against a 300-place ceiling
-- reads as 260 places left when the organisation has 5, so they spend an afternoon
-- admitting students the database refuses one at a time with CD001.
--
-- `capacityPressure` in src/lib/plans.ts states the precondition it needs in those
-- words — "ORGANISATION-WIDE, ALWAYS … never a branch's own" — and had no way to get it.
-- This is that way.
--
-- WHY A WRAPPER RATHER THAN EXPOSING app.active_students. PostgREST serves functions in
-- the schemas it is configured with, and `app` is not one of them: everything a browser
-- calls lives in `public`. The counting function stays where it is, unchanged, because
-- three triggers depend on its exact behaviour — volatile so row 200 of a 500-row import
-- sees rows 1..199.
--
-- SECURITY DEFINER THAT TAKES A CENTRE ID, which scripts/check-scoping.mjs names as the
-- one hazard its parser cannot catch: "A definer function that accepts a centre id and
-- trusts it is the actual hazard … the call site would look perfectly correct." So it
-- does not trust it. The first thing it does is ask whether the caller is a staff admin
-- there or a teacher holding can_manage_students — the two gates the four call sites
-- already stand behind — and anybody else gets 42501 whether or not they guessed a real
-- uuid. It returns one integer about the caller's own organisation and reveals nothing
-- about any row.
--
-- NOT A NEW FENCE. app.guard_student_capacity() is still the only thing that decides
-- whether a student may be admitted, and it has counted past RLS under an advisory lock
-- since 20260811000036. This changes what a screen can say, not what it can do.
-- ---------------------------------------------------------------------------

create or replace function public.center_student_count(p_center_id uuid)
returns integer
language plpgsql
-- Volatile like the function it delegates to. A stable wrapper would let the planner
-- reuse one answer across a statement, which is the behaviour 20260811000036 went out
-- of its way not to have.
volatile
security definer
set search_path = ''
as $$
begin
  if not (
    app.is_staff_admin(p_center_id) or app.can_manage_students(p_center_id)
  ) then
    raise exception 'not allowed to read the student count of %', p_center_id
      using errcode = '42501';
  end if;

  return app.active_students(p_center_id);
end;
$$;

comment on function public.center_student_count(uuid) is
  'Active students in the whole organisation, past the branch scope, for a caller '
  'who is a staff admin there or a teacher with can_manage_students. The pooled '
  'half of every places-left figure — MASTERPLAN.md 3.6. Not enforcement: '
  'app.guard_student_capacity() is.';

-- Two revokes because there are two grants: Postgres gives EXECUTE to PUBLIC, and
-- Supabase's default privileges in this schema give it to anon as well, which would
-- put a headcount on the anonymous /rest/v1/rpc endpoint. check-migrations.mjs fails
-- the build if either is left.
revoke all on function public.center_student_count(uuid) from public;
revoke all on function public.center_student_count(uuid) from anon;

grant execute on function public.center_student_count(uuid) to authenticated, service_role;
