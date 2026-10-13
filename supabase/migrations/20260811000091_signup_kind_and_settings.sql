-- CoachDesk BD — what a signup says it is, how long a trial lasts, and the vocabulary
-- the trial needs. The signup function itself is 20260811000092; this file is the three
-- facts it reads.
--
-- WHY THIS IS TWO MIGRATIONS AND NOT ONE. `alter type ... add value` and a *use* of the
-- value in the same transaction is "unsafe use of new value of enum type" — Postgres
-- will not evaluate a new label through the same transaction that minted it, because the
-- snapshot that decides ordering has not committed. Every constraint in 92 names
-- `signup_trial`, so the label is minted here and used there.
--
-- THE PROBLEM, IN ONE PARAGRAPH. `public.bootstrap_center` (20260811000039) stamped every
-- row it created with `trial_plan = teacher_plus, trial_ends_at = +14 days` and left
-- `plan` at `teacher_free`, including the signups that answered "coaching centre" on the
-- onboarding form. A centre therefore spent a fortnight on a *teacher's* tier — one
-- batch, one teacher, no staff list, no centre-wide reporting, 30 students — and then
-- landed on Teacher Free, which is marketing and not a floor a coaching centre can run
-- on. The form had a mode switch and the database had no memory of it.
--
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The trial lengths, as settings.
--
-- ONE ROW, PINNED. `id boolean primary key default true check (id)` is the standard
-- single-row trick: the key allows exactly one row and the constraint allows exactly one
-- value for it, so a "campaign" or a "region" is a decision somebody makes here rather
-- than a second insert somewhere else.
--
-- THESE ARE NOT PRICES. Prices live in `price_versions` and are migration-only, because
-- §11.10 wants a repricing to be a reviewed diff. A trial length is policy: the founder
-- changes it when the funnel says so, it grants nothing that can be spent elsewhere, and
-- it is capped at a year so a mistyped 3000 cannot hand out a decade.
--
-- VISIBLE TO EVERY SIGNED-IN READER, because the signup screen says what the trial is
-- worth before anybody agrees to it — a promise made on a page and then kept by 92.
-- ---------------------------------------------------------------------------

create table public.platform_settings (
  id boolean primary key default true check (id),

  -- What a teacher's signup is worth: days of the Teacher Pro trial (§4.3).
  teacher_trial_days integer not null check (teacher_trial_days between 0 and 365),

  -- And what a coaching centre's or an institution's is worth, in days granted on the
  -- line from the day they sign up (§11.7). Three by default: long enough to paste a
  -- roster and take a register, short enough to be a demonstration rather than a term.
  center_trial_days integer not null check (center_trial_days between 0 and 365),
  institution_trial_days integer not null check (institution_trial_days between 0 and 365),

  updated_at timestamptz not null default now(),
  -- Who last moved them, so a change has a name on it without an audit trigger: this
  -- table has no `coaching_center_id` and `app.log_audit_entry` refuses a row it cannot
  -- place at a centre.
  updated_by uuid references auth.users (id) on delete set null
);

comment on table public.platform_settings is
  'MASTERPLAN.md §4.3 — the trial lengths, one row, founder-editable. Not prices: those '
  'are versioned in price_versions and migration-only (§11.10). Read by every signed-in '
  'session because the signup screen quotes them, and written only by '
  'public.founder_set_trial_days.';

insert into public.platform_settings
  (id, teacher_trial_days, center_trial_days, institution_trial_days)
values (true, 14, 3, 3);

alter table public.platform_settings enable row level security;

create policy platform_settings_read on public.platform_settings
  for select to authenticated
  using (true);

revoke insert, update, delete, truncate on public.platform_settings
  from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 2. The founder's lever for them.
--
-- `true` for the id and not a parameter: there is one row, and a caller that could name
-- which one it was editing could name one that does not exist. The function is the whole
-- write path and checks `app.is_platform_admin()` inside the database rather than
-- trusting the Server Action that calls it (§11.4), so the anon key cannot set its own
-- trial length.
-- ---------------------------------------------------------------------------

create or replace function public.founder_set_trial_days(
  p_teacher_trial_days integer,
  p_center_trial_days integer,
  p_institution_trial_days integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_platform_admin() then
    raise exception 'founder_set_trial_days requires the platform admin'
      using errcode = '42501';
  end if;

  if p_teacher_trial_days is null or p_teacher_trial_days not between 0 and 365
     or p_center_trial_days is null or p_center_trial_days not between 0 and 365
     or p_institution_trial_days is null or p_institution_trial_days not between 0 and 365
  then
    raise exception 'a trial is a whole number of days between 0 and 365'
      using errcode = '22023';
  end if;

  update public.platform_settings
     set teacher_trial_days = p_teacher_trial_days,
         center_trial_days = p_center_trial_days,
         institution_trial_days = p_institution_trial_days,
         updated_at = pg_catalog.now(),
         updated_by = auth.uid()
   where id;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'teacherTrialDays', p_teacher_trial_days,
    'centerTrialDays', p_center_trial_days,
    'institutionTrialDays', p_institution_trial_days
  );
end;
$$;

comment on function public.founder_set_trial_days(integer, integer, integer) is
  'MASTERPLAN.md §4.3 — sets the three trial lengths, platform admin only, asking the '
  'question inside the database. One row, so no centre or row is named by the caller.';

revoke all on function public.founder_set_trial_days(integer, integer, integer)
  from public, anon;
grant execute on function public.founder_set_trial_days(integer, integer, integer)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. What a row says it is.
--
-- `account_kind` and not the old `teacher_mode`, because the boolean was a question with
-- two answers and the product has three customers. It is the line §2.1 draws between the
-- teacher tiers and the centre tiers — one person against an organisation — asked once,
-- at signup, and written down.
--
-- IT IS NOT THE PLAN and is deliberately never read as one. A teacher is a teacher on
-- Teacher Free or Teacher Pro; a centre is a centre on any tier. The plan answers "what
-- may they do", this answers "who are they", and the two meet in exactly one place: the
-- trial 92 chooses from it. A teacher is trialled on a tier, a centre on days.
--
-- WHAT READS IT. `bootstrap_center` stamps it; the founder panel lists, filters and
-- sorts by it, because a customer list where a solo teacher and a coaching centre look
-- alike is a list the founder cannot telephone from; and the money form asks it whether
-- it is selling months or balance. Nothing gates a feature on it — features come from
-- the plan, and a screen that gated on this would be a second plan model.
--
-- BACKFILLED BY THE ONLY EVIDENCE HISTORY LEFT: an owner who also holds a `teachers` row
-- signed up in teacher mode, which is the shape `bootstrap_center` wrote for a solo
-- teacher; an owner who does not is a centre. It is a guess, and it is written down as
-- one — nothing depends on it being right for a row that predates the column, and a
-- founder can correct one by hand.
-- ---------------------------------------------------------------------------

alter table public.coaching_centers
  add column account_kind text not null default 'teacher'
    check (account_kind in ('teacher', 'center', 'institution'));

update public.coaching_centers c
   set account_kind = 'center'
 where not exists (
   select 1 from public.teachers t
   where t.coaching_center_id = c.id
     and t.user_id = c.created_by
 );

comment on column public.coaching_centers.account_kind is
  'What the signup said it was: teacher, center or institution. Not a plan — a plan '
  'answers what may be done, this answers who the customer is. Chosen at signup, read by '
  'the trial it grants (20260811000092) and by the founder panel''s list and money form.';

-- `guard_center_billing` covers it, because it decides which trial a signup is given and
-- therefore how many days a customer gets for nothing. The browser's UPDATE whitelist in
-- 20260811000004 never held this name, so this is the belt to that braces — the same pair
-- as `plan` and `balance_poisha`.
create or replace function app.guard_center_billing()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.plan is distinct from old.plan
     or new.status is distinct from old.status
     or new.sms_credit_balance is distinct from old.sms_credit_balance
     or new.student_capacity is distinct from old.student_capacity
     or new.trial_plan is distinct from old.trial_plan
     or new.trial_ends_at is distinct from old.trial_ends_at
     or new.paid_through is distinct from old.paid_through
     or new.balance_poisha is distinct from old.balance_poisha
     or new.charged_through is distinct from old.charged_through
     or new.account_kind is distinct from old.account_kind
  then
    if current_user not in ('service_role', 'postgres', 'supabase_admin') then
      raise exception
        'plan, status, credits, capacity, trial, coverage, balance and account kind are set by the server after payment, not by %',
        current_user
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function app.guard_center_billing() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The vocabulary for a day given at signup.
--
-- `founder_grant_days` would have carried it and would have been a lie in the one place
-- the customer reads. The history screen draws a grant as days somebody gave them, with
-- the reason the founder typed beside it; a three-day trial is not a favour a person
-- decided to do, it is the product's own offer, written by the database at the moment the
-- account was made. A customer reconciling their first month should be able to see the
-- difference, and the founder should not be told they granted something they never
-- touched.
--
-- It carries no money, exactly as a grant does — §11.7: days, not fake money — and its
-- `charge_date` is the last day it reaches, which is what moves `charged_through`. 92
-- pins the sign, teaches the trigger to move the line on it, and lets the reconciliation
-- treat it as an explanation of a date past today.
-- ---------------------------------------------------------------------------

alter type public.billing_entry_kind add value if not exists 'signup_trial';

comment on type public.billing_entry_kind is
  'MASTERPLAN.md §11.7 and §4.3. What a billing_ledger row is. The sign of amount_poisha '
  'is pinned by billing_ledger_amount_sign, so the kind alone says whether money went on '
  'or off the balance — and both of the day-granting kinds carry none, because days are '
  'not fake money.';
