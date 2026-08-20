-- CoachDesk BD — teacher fee visibility
--
-- `teacher_permissions.can_view_fees` has existed since the init migration. It is
-- stored, defaulted false, shown as a checkbox on the owner's teacher form, and
-- named in three comments — including the one over the fee policies in
-- 20260811000002, which claims "the app checks it before querying". Nothing
-- checked it and no policy mentioned it. Ticking the box granted a teacher
-- exactly nothing: /fees wanted `manager`, and even if it had let them in, RLS
-- would have handed back an empty board.
--
-- This is the database half. The app half is `canReadFees` in lib/auth/session.
--
-- ---------------------------------------------------------------------------
-- Scoped to the teacher's own students, not the whole centre
-- ---------------------------------------------------------------------------
--
-- The obvious reading of "see fees" is the whole board, and that is wrong here
-- for a reason that is structural rather than a matter of taste.
--
-- The board reads `fee_invoice_balances`, which inner-joins `students` and runs
-- with security_invoker — so a teacher's own policy on `students`
-- (`students_teacher_read`, via app.my_taught_student_ids) decides which rows
-- survive the join. A centre-wide fee policy would therefore produce a board that
-- silently drops every family the teacher does not teach, while the total at the
-- top still called itself the centre's outstanding. A fee figure that is a subset
-- pretending to be a whole is the one defect this screen cannot have: an owner
-- reconciles it against a bKash statement, and a number that is quietly short is
-- worse than no number.
--
-- Widening `students` instead was the other way to make it whole, and it is the
-- wrong trade. `can_manage_students` is a separate checkbox an owner may well
-- have left off; handing over every child's guardian mobile number at the centre
-- through a box labelled "see fees" is not the grant they think they are making.
--
-- So the fee policies match the student policy exactly, and the board says whose
-- fees it is showing. A batch teacher chasing their own batch's arrears is the
-- delegation that actually happens here anyway — they are the one who knows those
-- parents.
--
-- ---------------------------------------------------------------------------
-- Absent means no, which is the opposite of can_send_sms
-- ---------------------------------------------------------------------------
--
-- The SMS gate opens unless it finds an explicit false, because bootstrap_center
-- gives the owner's own teacher row no permissions row at all and reading that
-- absence as "may do nothing" would lock an owner out of their own marks sheet.
-- Fees invert it: the column defaults to false, the whole point is that an owner
-- opts in, and an owner does not need this policy anyway — they are staff-admin.
-- So `exists` over a row with the column true, and no row means no.

create or replace function app.can_view_fees(center uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.teacher_permissions tp
    join public.teachers t
      on t.id = tp.teacher_id
     and t.coaching_center_id = tp.coaching_center_id
    where t.user_id = auth.uid()
      and t.active
      and t.coaching_center_id = center
      and tp.can_view_fees
  )
  -- Belt as well as braces, because this one is money. `teachers.active` is the
  -- off switch the staff screen uses, but an owner can also revoke the
  -- center_members row, and either action has to be enough on its own.
  and app.is_member(center);
$$;

grant execute on function app.can_view_fees(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Read, and only read
-- ---------------------------------------------------------------------------
--
-- `for select` with no `with check`: recording a payment stays owner-and-manager
-- work, as feeAdmin() in the fee actions already says. A teacher who could enter
-- payments could write a fee off, and that is the owner's money.
--
-- fee_reminders is deliberately left alone. Who has been chased, and how often,
-- is the owner's record of their own dunning; a teacher reading this board does
-- not need it and the board hides that column for them rather than showing every
-- family as never-contacted.

create policy fee_invoices_teacher_read on fee_invoices
  for select to authenticated
  using (
    app.can_view_fees(coaching_center_id)
    and student_id in (select app.my_taught_student_ids())
  );

create policy fee_payments_teacher_read on fee_payments
  for select to authenticated
  using (
    app.can_view_fees(coaching_center_id)
    and invoice_id in (
      select i.id
      from fee_invoices i
      where i.student_id in (select app.my_taught_student_ids())
    )
  );

comment on function app.can_view_fees(uuid) is
  'True when the caller is an active teacher at `center` whose teacher_permissions '
  'row has can_view_fees. No row means no — unlike can_send_sms, which opens '
  'unless it finds an explicit false.';
