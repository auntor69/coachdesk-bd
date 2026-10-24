-- CoachDesk BD — Performance, Consistency, Foreign Key Indexes, and Clock-Gate Midnight Fix.
-- Migration: 20260811000100_performance_consistency_and_clock_gate.sql

-- ---------------------------------------------------------------------------
-- 1. Clock-Gate Midnight Wrap & Pre-Start Validation
--
-- Fixes the edge-case where a late-night class (e.g. 22:50 to 23:50) wraps around
-- midnight when adding grace interval (23:50 + 30m = 00:20), causing `dhaka_now <= win_end + grace`
-- to evaluate false in Postgres time comparisons during the daytime (e.g. 20:55 <= 00:20 is false).
-- Also ensures 'forgot' signatures cannot be filed before the class has started (win_start is not null
-- and dhaka_now < win_start).
-- ---------------------------------------------------------------------------

create or replace function app.guard_attendance_unlock()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  server_role  boolean := current_user in ('service_role', 'postgres', 'supabase_admin');
  dhaka_today  date := (now() at time zone 'Asia/Dhaka')::date;
  dhaka_now    time := (now() at time zone 'Asia/Dhaka')::time;
  win_start    time;
  win_end      time;
  grace        interval := make_interval(mins => app.attendance_grace_minutes());
begin
  if not server_role then
    if auth.uid() is null then
      raise exception
        'a signature has to carry somebody''s name, and this session has none'
        using errcode = '42501';
    end if;

    new.claimed_by := auth.uid();
    new.claimed_at := now();
  end if;

  if new.session_date > dhaka_today then
    raise exception using
      message = format(
        'a signature cannot be given for %s, which has not arrived yet in Dhaka; '
        'a class that has not happened has nothing to unlock',
        new.session_date
      ),
      errcode = '23514';
  end if;

  if new.session_date < dhaka_today then
    raise exception using
      message = format(
        'the clock gate is about today''s class, and %s is not today in Dhaka; '
        'an earlier register is a correction and not a lock to be lifted',
        new.session_date
      ),
      errcode = '23514';
  end if;

  if not app.clock_enforced(new.coaching_center_id) then
    raise exception using
      message = format(
        'this centre''s plan has no clock gate, so there is nothing to sign for; '
        'the register is open — take it'
      ),
      errcode = '23514';
  end if;

  select w.starts_at, w.ends_at
    into win_start, win_end
    from app.class_window(new.batch_id, new.session_date) w;

  if not server_role then
    new.starts_at := win_start;
    new.ends_at := win_end;
  end if;

  if new.reason = 'early' then
    if win_start is not null and dhaka_now >= win_start then
      raise exception using
        message = format(
          'this class has already started, so there is nothing early about this '
          'register and no early signature to give; take it'
        ),
        errcode = '23514';
    end if;
    return new;
  end if;

  -- 'forgot': the class has to be over, by the same grace the register itself is
  -- measured with. Both tests matter — a window with no end cannot be late, and a
  -- class still running has a register to take.
  -- Pre-start validation: cannot give 'forgot' before class starts.
  -- Midnight wrap: when (win_end + grace) < win_start, class runs or is in grace
  -- if dhaka_now >= win_start or dhaka_now <= (win_end + grace).
  if win_end is null
     or (win_start is not null and dhaka_now < win_start)
     or (case when win_end + grace < win_start
              then dhaka_now >= win_start or dhaka_now <= win_end + grace
              else dhaka_now <= win_end + grace end)
  then
    raise exception using
      message = format(
        'this class has not finished yet, so a register filed now is not late; '
        'take it while the room is full'
      ),
      errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function app.guard_attendance_unlock() is
  'Keeps a signature honest: anonymous sessions cannot give one, a signature is for '
  'today (a day rule, every plan), its reason has to match the clock (with midnight '
  'wrap and pre-start validation), and its signer and moment are stamped by the '
  'database. On a plan without the clock gate (app.clock_enforced) there is nothing '
  'to sign for and it is refused by name.';

drop trigger if exists attendance_unlocks_guard on public.attendance_unlocks;

create trigger attendance_unlocks_guard
  before insert on public.attendance_unlocks
  for each row execute function app.guard_attendance_unlock();

-- ---------------------------------------------------------------------------
-- 2. Covering & Hot Path Indexes
-- ---------------------------------------------------------------------------

-- center_members active role lookup (app.is_member, app.has_role, getSession)
create index if not exists center_members_user_center_role_active_idx
  on public.center_members (user_id, coaching_center_id, role)
  where active;

-- profiles covering index for getSession()
create index if not exists profiles_lookup_covering_idx
  on public.profiles (id)
  include (full_name, phone, locale, is_platform_admin);

-- ---------------------------------------------------------------------------
-- 3. Composite Foreign Key Indexes (Reversed Key Ordering Fix)
--
-- 12 branch foreign keys declared as (branch_id, coaching_center_id) REFERENCES
-- branches(id, coaching_center_id) require leading branch_id to satisfy foreign key
-- locking and cascading lookups without sequential scans.
-- ---------------------------------------------------------------------------

create index if not exists batches_branch_center_fk_idx
  on public.batches (branch_id, coaching_center_id)
  where branch_id is not null;

create index if not exists capacity_requests_branch_center_fk_idx
  on public.capacity_requests (branch_id, coaching_center_id)
  where branch_id is not null;

create index if not exists center_members_branch_center_fk_idx
  on public.center_members (branch_id, coaching_center_id)
  where branch_id is not null;

create index if not exists employees_branch_center_fk_idx
  on public.employees (branch_id, coaching_center_id)
  where branch_id is not null;

create index if not exists expenses_branch_center_fk_idx
  on public.expenses (branch_id, coaching_center_id)
  where branch_id is not null;

create index if not exists fee_invoices_branch_center_fk_idx
  on public.fee_invoices (branch_id, coaching_center_id)
  where branch_id is not null;

create index if not exists fee_payments_branch_center_fk_idx
  on public.fee_payments (branch_id, coaching_center_id)
  where branch_id is not null;

create index if not exists notices_branch_center_fk_idx
  on public.notices (branch_id, coaching_center_id)
  where branch_id is not null;

create index if not exists payment_intents_branch_center_fk_idx
  on public.payment_intents (branch_id, coaching_center_id)
  where branch_id is not null;

create index if not exists salary_payments_branch_center_fk_idx
  on public.salary_payments (branch_id, coaching_center_id)
  where branch_id is not null;

create index if not exists students_branch_center_fk_idx
  on public.students (branch_id, coaching_center_id)
  where branch_id is not null;

create index if not exists teachers_branch_center_fk_idx
  on public.teachers (branch_id, coaching_center_id)
  where branch_id is not null;

-- High frequency relational foreign key indexes
create index if not exists recharge_claims_promotion_id_idx
  on public.recharge_claims (promotion_id)
  where promotion_id is not null;

create index if not exists recharge_claims_granted_promotion_id_idx
  on public.recharge_claims (granted_promotion_id)
  where granted_promotion_id is not null;

create index if not exists recharge_claims_price_version_id_idx
  on public.recharge_claims (price_version_id);

create index if not exists sms_templates_center_idx
  on public.sms_templates (coaching_center_id)
  where coaching_center_id is not null;

create index if not exists payment_intents_settled_by_idx
  on public.payment_intents (settled_by)
  where settled_by is not null;

create index if not exists payment_intents_requested_by_idx
  on public.payment_intents (requested_by);

create index if not exists fee_payments_invoice_center_fk_idx
  on public.fee_payments (invoice_id, coaching_center_id);

create index if not exists fee_reminders_invoice_center_fk_idx
  on public.fee_reminders (invoice_id, coaching_center_id);

create index if not exists attendance_sessions_batch_center_fk_idx
  on public.attendance_sessions (batch_id, coaching_center_id);

create index if not exists attendance_unlocks_batch_center_fk_idx
  on public.attendance_unlocks (batch_id, coaching_center_id);

create index if not exists batch_schedules_batch_center_fk_idx
  on public.batch_schedules (batch_id, coaching_center_id);

create index if not exists enrollments_batch_center_fk_idx
  on public.enrollments (batch_id, coaching_center_id);

create index if not exists exams_batch_center_fk_idx
  on public.exams (batch_id, coaching_center_id);

create index if not exists notices_batch_center_fk_idx
  on public.notices (batch_id, coaching_center_id)
  where batch_id is not null;

create index if not exists attendance_records_session_center_fk_idx
  on public.attendance_records (session_id, coaching_center_id);

create index if not exists absence_notices_session_center_fk_idx
  on public.absence_notices (session_id, coaching_center_id);

create index if not exists exam_results_exam_center_fk_idx
  on public.exam_results (exam_id, coaching_center_id);

create index if not exists result_notices_exam_center_fk_idx
  on public.result_notices (exam_id, coaching_center_id);

-- ---------------------------------------------------------------------------
-- 4. Prune Redundant Prefix & Duplicate Indexes
-- ---------------------------------------------------------------------------

-- Duplicate daily_charge index on billing_ledger
drop index if exists public.billing_ledger_charge_idx;

-- center_members_center_idx (coaching_center_id WHERE active) is covered by
-- center_members_coaching_center_id_user_id_role_key and center_members_user_center_role_active_idx
drop index if exists public.center_members_center_idx;

-- batches_center_idx (coaching_center_id WHERE active) is covered by
-- batches_center_branch_idx (coaching_center_id, branch_id WHERE active)
drop index if exists public.batches_center_idx;

-- employees_center_idx (coaching_center_id WHERE active) is covered by
-- employees_center_branch_idx (coaching_center_id, branch_id WHERE active)
drop index if exists public.employees_center_idx;

-- teachers_center_idx (coaching_center_id WHERE active) is covered by
-- teachers_center_branch_idx (coaching_center_id, branch_id WHERE active)
drop index if exists public.teachers_center_idx;

-- students_center_idx (coaching_center_id WHERE status = 'active') is covered by
-- students_center_admitted_idx (coaching_center_id, branch_id, admitted_on WHERE status = 'active')
drop index if exists public.students_center_idx;

-- attendance_sessions_center_month_idx (coaching_center_id) is covered by
-- attendance_sessions_center_date_idx (coaching_center_id, session_date)
drop index if exists public.attendance_sessions_center_month_idx;

-- batch_schedules_batch_idx (batch_id) is covered by
-- batch_schedules_batch_id_day_of_week_start_time_key (batch_id, day_of_week, start_time)
drop index if exists public.batch_schedules_batch_idx;

-- enrollments_student_idx (student_id) is covered by
-- enrollments_student_id_batch_id_key (student_id, batch_id)
drop index if exists public.enrollments_student_idx;

-- enrollments_center_billing_idx (coaching_center_id WHERE status = 'active') is covered by
-- enrollments_center_student_idx (coaching_center_id, student_id)
drop index if exists public.enrollments_center_billing_idx;

-- fee_payments_invoice_idx (invoice_id) is covered by
-- fee_payments_invoice_center_fk_idx (invoice_id, coaching_center_id)
drop index if exists public.fee_payments_invoice_idx;

-- center_members_user_idx (user_id WHERE active) is covered by
-- center_members_user_center_role_active_idx (user_id, coaching_center_id, role WHERE active)
drop index if exists public.center_members_user_idx;

-- ---------------------------------------------------------------------------
-- 5. Drop Dead Legacy Migration Table
-- ---------------------------------------------------------------------------

drop table if exists public.schema_migrations cascade;

-- ---------------------------------------------------------------------------
-- 6. Promotions Security Policy
--
-- Governs public.promotions so that authenticated users can inspect active
-- promotions (vouchers) for recharges, while keeping inactive promotions hidden.
-- ---------------------------------------------------------------------------

drop policy if exists promotions_admin_select on public.promotions;
drop policy if exists promotions_authenticated_select on public.promotions;
create policy promotions_authenticated_select on public.promotions
  for select to authenticated
  using (active = true);

-- ---------------------------------------------------------------------------
-- 7. Direct SQL Outstanding Aggregation View
--
-- Direct SQL aggregation for dashboard outstanding fee calculation, eliminating
-- unbounded client-side pageAll historical invoice scans and event-loop memory bloat.
-- ---------------------------------------------------------------------------

create or replace view public.fee_outstanding_summary with (security_invoker = true) as
select
  coaching_center_id,
  coalesce(sum(remaining_bdt), 0) as outstanding_bdt,
  count(*)::int as invoice_count
from public.fee_invoice_balances
where voided_at is null
  and remaining_bdt > 0
group by coaching_center_id;

comment on view public.fee_outstanding_summary is
  'Direct SQL aggregation of outstanding fee balances per tenant to eliminate unbounded client-side pageAll memory bloat.';

grant select on public.fee_outstanding_summary to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Consistency Fix: guard_trial_roster per-student tier guard
--
-- Re-applies the corrected app.guard_trial_roster() function from migration 098.
-- Fixes the edge-case where the live database had the unpatched function containing
-- `app.plan_ceiling(target, 'students')`, which raised `no ceiling called students`
-- on student admissions for 'center' and 'institution' plans.
-- ---------------------------------------------------------------------------

create or replace function app.guard_trial_roster()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target  public.plan_type;
  allowed integer;
  in_use  integer;
  balance bigint;
begin
  /* Only an active student occupies a place, so a leaver gives theirs back — which is how a
     centre stays under the bound without deleting a child's marks and attendance. */
  if new.status <> 'active' then
    return new;
  end if;

  /* Already on the roster at this centre, so nothing new is being claimed: a rename, a phone
     correction or a class level never reaches the count, and a row moved to another
     organisation is checked against that organisation's bound. Copied from
     app.guard_student_capacity, which asks the same question one row over. */
  if tg_op = 'UPDATE'
     and old.status = 'active'
     and old.coaching_center_id = new.coaching_center_id
  then
    return new;
  end if;

  if current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  target := app.ceiling_plan(new.coaching_center_id);

  if target is null then
    raise exception 'student % names no coaching centre', new.name
      using errcode = '23503';
  end if;

  /*
   * WHICH TIERS THIS RULE IS FOR: the two per-student tiers ('center', 'institution').
   * The teacher tiers carry their own student ceiling and are guarded by app.guard_student_capacity.
   */
  if target not in ('center', 'institution') then
    return new;
  end if;

  select s.trial_roster_ceiling into allowed
  from public.platform_settings s
  where s.id;

  if allowed is null then
    raise exception 'no trial policy is in force' using errcode = '23503';
  end if;

  /* Zero is the founder's own decision to carry as many rows as a trial asks for. */
  if allowed = 0 then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('students.trial_roster'),
    pg_catalog.hashtext(new.coaching_center_id::text)
  );

  in_use := app.active_students(new.coaching_center_id);

  if in_use < allowed then
    return new;
  end if;

  /* Past it, and the organisation has to be a paying one. ANY MONEY LIFTS THE BOUND. */
  select c.balance_poisha into balance
  from public.coaching_centers c
  where c.id = new.coaching_center_id;

  if balance is null or balance <= 0 then
    raise exception
      'a trial holds % active students, and this organisation has % with nothing on the balance',
      allowed, in_use
      using errcode = 'CD006',
            detail  = 'limit=students',
            hint    = 'Add money to the balance to run the whole roster.';
  end if;

  return new;
end;
$$;

comment on function app.guard_trial_roster() is
  'BEFORE INSERT (or a status switched back to active) on public.students: an organisation '
  'that has never funded its balance holds platform_settings.trial_roster_ceiling active '
  'students, and any money lifts the bound. The teacher tiers keep app.guard_student_capacity '
  'and CD001. MASTERPLAN.md §3.3, §4.3, §11.7. CD006, named in src/lib/capacity.ts.';

