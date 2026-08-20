-- CoachDesk BD — teacher exam permission
--
-- `teacher_permissions.can_manage_exams` is the second of the five checkboxes on
-- the owner's teacher form that did nothing. It has been stored, defaulted true
-- and rendered since the init migration; `exams_teacher_write` and
-- `exam_results_teacher_write` never mentioned it. Unticking "Exams & marks" left
-- the teacher able to create exams and enter marks exactly as before.
--
-- This is the database half. The app half is `canManageExams` in lib/auth/session,
-- which hides the buttons, and the two exam actions, which refuse in words rather
-- than writing nothing — a blocked UPDATE is zero rows and no error, so an action
-- that relied on the policy alone would tell a teacher their marks were saved.
--
-- ---------------------------------------------------------------------------
-- Absent means allowed, and the owner's explicit choice always wins
-- ---------------------------------------------------------------------------
--
-- The opposite default to can_view_fees, for a reason that is in the data rather
-- than in taste: this column defaults to true, and `bootstrap_center` gives the
-- owner's own teacher row no permissions row at all. Reading that absence as "may
-- do nothing" would lock an owner out of their own marks sheet on the day they
-- signed up. So the helper denies only on an explicit false — the same reading the
-- SMS gate has used since it was written.
--
-- The two helpers therefore disagree about a person holding two teacher rows at
-- one centre, which `teachers` permits (no unique key on (centre, user)):
-- can_view_fees allows if any row grants, can_manage_exams denies if any row
-- refuses. That is one rule, not two — the owner's explicit tick or untick beats
-- the default either way — and it is the safe direction in both cases.
--
-- ---------------------------------------------------------------------------
-- Reading is not managing
-- ---------------------------------------------------------------------------
--
-- The permission gates writes only, which is why the single `for all` policy had
-- to become four. `for all` covers SELECT, so gating it would have taken a
-- teacher's own batch's exams and marks off their screen entirely — and a teacher
-- who may not enter marks still needs to see the marks that were entered, because
-- they are the one standing in front of the class that got them.

create or replace function app.can_manage_exams(center uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from public.teacher_permissions tp
    join public.teachers t
      on t.id = tp.teacher_id
     and t.coaching_center_id = tp.coaching_center_id
    where t.user_id = auth.uid()
      and t.coaching_center_id = center
      and not tp.can_manage_exams
  );
$$;

grant execute on function app.can_manage_exams(uuid) to authenticated, service_role;

comment on function app.can_manage_exams(uuid) is
  'False when a teacher_permissions row for the caller at `center` has '
  'can_manage_exams off. No row means allowed — unlike can_view_fees, which needs '
  'an explicit grant. Says nothing about which batches; pair it with '
  'app.teaches_batch.';

-- ---------------------------------------------------------------------------
-- exams
-- ---------------------------------------------------------------------------
--
-- `t.active` is deliberately not in the helper above, unlike can_view_fees. Every
-- policy below already requires app.teaches_batch, which resolves through
-- app.my_teacher_ids and only counts active rows — so a deactivated teacher is
-- stopped by the half of the condition that was always there, and repeating it
-- would imply the helper is a boundary on its own. It is not: on its own it
-- answers true for an owner, a student, and a stranger.

drop policy exams_teacher_write on exams;

create policy exams_teacher_read on exams
  for select to authenticated
  using (app.teaches_batch(batch_id));

create policy exams_teacher_insert on exams
  for insert to authenticated
  with check (
    app.teaches_batch(batch_id)
    and app.can_manage_exams(coaching_center_id)
  );

-- UPDATE needs both halves twice. `using` decides which rows may be reached and
-- `with check` what they may become; without the second, a teacher could move an
-- exam onto a batch that is not theirs and keep editing it from there.
create policy exams_teacher_update on exams
  for update to authenticated
  using (
    app.teaches_batch(batch_id)
    and app.can_manage_exams(coaching_center_id)
  )
  with check (
    app.teaches_batch(batch_id)
    and app.can_manage_exams(coaching_center_id)
  );

create policy exams_teacher_delete on exams
  for delete to authenticated
  using (
    app.teaches_batch(batch_id)
    and app.can_manage_exams(coaching_center_id)
  );

-- ---------------------------------------------------------------------------
-- exam_results
-- ---------------------------------------------------------------------------
--
-- Same four, through the exam. The subquery is what it was — a teacher may touch
-- marks for an exam on a batch they teach — with the permission ANDed on.

drop policy exam_results_teacher_write on exam_results;

create policy exam_results_teacher_read on exam_results
  for select to authenticated
  using (
    exam_id in (select x.id from exams x where app.teaches_batch(x.batch_id))
  );

create policy exam_results_teacher_insert on exam_results
  for insert to authenticated
  with check (
    exam_id in (select x.id from exams x where app.teaches_batch(x.batch_id))
    and app.can_manage_exams(coaching_center_id)
  );

create policy exam_results_teacher_update on exam_results
  for update to authenticated
  using (
    exam_id in (select x.id from exams x where app.teaches_batch(x.batch_id))
    and app.can_manage_exams(coaching_center_id)
  )
  with check (
    exam_id in (select x.id from exams x where app.teaches_batch(x.batch_id))
    and app.can_manage_exams(coaching_center_id)
  );

-- The one the marks sheet depends on most. Clearing a mark is a DELETE, and a
-- DELETE with no matching policy removes zero rows and raises nothing — which is
-- why saveMarks checks the permission itself before it gets here.
create policy exam_results_teacher_delete on exam_results
  for delete to authenticated
  using (
    exam_id in (select x.id from exams x where app.teaches_batch(x.batch_id))
    and app.can_manage_exams(coaching_center_id)
  );
