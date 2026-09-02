-- §3.7's last unbuilt row: "urgent — persistent banner, HQ told which branches are growing".
--
-- The pool is one number for the organisation and §17 forbids ever dividing it into
-- per-branch quotas. But an owner five per cent from full has one decision to make —
-- whether to buy more places — and the fact that decides it is which building is filling
-- up. §3.6 puts the same shape on the page it uses to explain the pool: a purchased total
-- with a per-branch breakdown underneath it. Reporting the breakdown is not a quota; the
-- difference is that nothing here refuses anything.
--
-- WHY THIS COUNTS THE STILL-ACTIVE RATHER THAN EVERY ADMISSION EVER TAKEN. A branch that
-- admitted fifty in August and lost forty of them has not grown, and a view counting
-- admissions would report it as the fastest-growing branch in the group. What consumes a
-- place is a student who is on the register now, so that is what a row counts: active
-- students, filed under the month they were admitted.
--
-- The invariant that buys is worth more than the phrasing costs — every row of this view
-- added together is exactly the organisation's active head count, which is the pool figure
-- the same screen already prints beside it. A column that does not add up to the total
-- above it is the failure 20260811000055's header spends a paragraph on.
--
-- The cost is that the past is not fixed: a student admitted in March who leaves in
-- October takes their row out of March, so March's figure read in November is smaller than
-- it was in April. That is correct for the question — "where did the places we are using
-- now go" — and wrong for "how many families walked in in March", which nothing asks and
-- which the roster answers anyway. The comment on the view says so, because the person who
-- reads this as an intake report will otherwise file a bug.
--
-- HEAD OFFICE IS A ROW, NOT A WILDCARD, the same rule as every other branch grouping in
-- this schema: a null `branch_id` groups with other nulls and with nothing else.
--
-- security_invoker, so 20260811000053's restrictive branch policies decide how many rows a
-- reader gets. A pinned manager sees their own building's history and no other, from the
-- same query the head office runs — which is also why the screen that draws this refuses a
-- pinned manager outright rather than showing them a comparison of one.

-- ---------------------------------------------------------------------------
-- 1. Where the places went, branches as rows.
-- ---------------------------------------------------------------------------

create view branch_admissions_month with (security_invoker = true) as
select
  s.coaching_center_id,
  s.branch_id,
  (date_trunc('month', s.admitted_on))::date as period_month,
  count(*)::integer as admitted
from students s
where s.status = 'active'
group by 1, 2, 3;

-- Granted to `authenticated` by name, and anon's default grant left where Supabase put it.
--
-- Not an oversight and not a hole. `security_invoker` means this view is read through the
-- caller's own policies, so a request with no session matches nothing in `students` and gets
-- an empty list — the same protection the twelve views before this one rely on. Revoking the
-- privilege on top of that would turn the empty list into a 401, which sounds stricter and
-- costs something real: `scripts/check-embeds.mjs` asks every view the app reads with the
-- anon key precisely because a 400 there means PostgREST cannot parse a select the app
-- ships, and a view it is refused outright can no longer be checked at all. The RLS suite
-- asserts the empty answer instead.
grant select on branch_admissions_month to authenticated;

comment on view branch_admissions_month is
  'MASTERPLAN.md §3.7''s "HQ told which branches are growing": how many of the student '
  'places in use now were taken by each branch, by the month the student was admitted. '
  'NOT AN INTAKE REPORT — only students whose status is still active are counted, so every '
  'row added together is the organisation''s active head count and a branch that admitted '
  'fifty and lost forty is not reported as growing. A consequence worth knowing: a student '
  'who leaves is removed from the month they were admitted in, so a past month''s figure '
  'falls over time. A null branch_id is head office, not every branch. This is reporting '
  'and never a quota — §17 keeps the pool at the organisation. security_invoker.';

-- ---------------------------------------------------------------------------
-- 2. The index the group-by wants.
--
-- `students_center_idx` from 20260811000001 is `(coaching_center_id) where status =
-- 'active'` — the right rows, none of the columns, so the group-by goes back to the heap
-- for a branch and a date per student. Widening it in place would mean dropping an index
-- the roster counts on; a second partial index on the same predicate is a page or two per
-- thousand students and lets this be an index-only scan.
-- ---------------------------------------------------------------------------

create index if not exists students_center_admitted_idx
  on public.students (coaching_center_id, branch_id, admitted_on)
  where status = 'active';
