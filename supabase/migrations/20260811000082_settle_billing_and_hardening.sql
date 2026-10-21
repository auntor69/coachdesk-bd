-- CoachDesk BD — settlement run attempt sequencing, free-tier upgrade starting
-- line, and schema guard hardening (DB-01, BILL-01, SEC-02).

-- ---------------------------------------------------------------------------
-- 1. public.settle_billing — increment attempt on every settlement_runs insert
--    and prevent non-admin session callers from spoofing ran_by.
-- ---------------------------------------------------------------------------

create or replace function public.settle_billing(
  p_center uuid,
  p_ran_by text default 'session'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_today date := (pg_catalog.now() at time zone 'Asia/Dhaka')::date;
  v_plan public.plan_type;
  v_charged_through date;
  card public.price_versions%rowtype;
  v_students integer;
  v_teachers integer;
  v_branches integer;
  band record;
  v_up_to integer;
  v_band_size integer;
  v_in_band integer;
  v_remaining integer;
  v_band_floor integer := 0;
  v_band_sum bigint := 0;
  v_monthly bigint;
  v_daily bigint;
  v_balance bigint;
  v_charged bigint := 0;
  v_days integer := 0;
  v_day date;
  v_today_so_far bigint;
  v_diff bigint;
  v_attempt integer;
  v_outcome text := 'settled';
begin
  if p_ran_by not in ('session', 'system', 'founder') then
    raise exception 'settle_billing: ran_by must say who asked'
      using errcode = '22023';
  end if;

  if auth.uid() is not null then
    if not exists (
      select 1 from public.center_members m
      where m.coaching_center_id = p_center
        and m.user_id = auth.uid()
        and m.active
    ) then
      raise exception 'settle_billing requires an active membership at the centre'
        using errcode = '42501';
    end if;

    if p_ran_by <> 'session' and not (p_ran_by = 'founder' and app.is_platform_admin()) then
      p_ran_by := 'session';
    end if;
  elsif current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'settle_billing requires a member or the platform'
      using errcode = '42501';
  end if;

  select c.plan, c.charged_through
    into v_plan, v_charged_through
  from public.coaching_centers c
  where c.id = p_center;

  if not found then
    raise exception 'settle_billing: no such centre' using errcode = '23503';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('billing_ledger.balance'),
    pg_catalog.hashtext(p_center::text)
  );

  select * into card
  from public.price_versions v
  where v.effective_from <= v_today
  order by v.effective_from desc
  limit 1;

  if not found then
    select coalesce(max(r.attempt), 0) into v_attempt
    from app.settlement_runs r
    where r.coaching_center_id = p_center
      and r.charge_date = v_today;

    insert into app.settlement_runs (
      coaching_center_id, charge_date, status, attempt, error_detail, ran_by
    ) values (
      p_center, v_today, 'error', v_attempt + 1,
      'no price version in force', p_ran_by
    );
    return jsonb_build_object('ok', false, 'status', 'error',
                              'error', 'no price version in force');
  end if;

  begin
    v_students := app.active_students(p_center);
    v_teachers := app.active_teachers(p_center);
    select greatest(1, pg_catalog.count(*))::integer
      into v_branches
    from public.branches b
    where b.coaching_center_id = p_center
      and b.active;
  exception when others then
    select coalesce(max(r.attempt), 0) into v_attempt
    from app.settlement_runs r
    where r.coaching_center_id = p_center
      and r.charge_date = v_today;

    insert into app.settlement_runs (
      coaching_center_id, charge_date, status, attempt, error_detail, ran_by
    ) values (
      p_center, v_today, 'usage_unavailable', v_attempt + 1,
      left(sqlerrm || ' [' || sqlstate || ']', 300), p_ran_by
    );
    return jsonb_build_object('ok', false, 'status', 'usage_unavailable',
                              'error', left(sqlerrm, 200));
  end;

  if v_plan = 'teacher_free'::public.plan_type then
    v_daily := 0;
  elsif v_plan = 'teacher_plus'::public.plan_type then
    v_daily := card.teacher_plus_monthly_poisha / 30;
  else
    v_remaining := v_students;
    for band in
      select v.value as b
      from pg_catalog.jsonb_array_elements(card.student_bands) v
    loop
      exit when v_remaining <= 0;
      v_up_to := (band.b->>'upTo')::integer;
      v_band_size := case when v_up_to is null then v_remaining
                          else v_up_to - v_band_floor end;
      v_in_band := least(v_remaining, v_band_size);
      v_band_sum := v_band_sum + v_in_band * (band.b->>'poishaEach')::bigint;
      v_remaining := v_remaining - v_in_band;
      v_band_floor := coalesce(v_up_to, v_band_floor);
    end loop;

    v_monthly := greatest(
      case when v_plan = 'institution'::public.plan_type
             then card.institution_monthly_floor_poisha
             else card.center_monthly_floor_poisha end,
      v_band_sum
    );

    v_monthly := v_monthly
      + greatest(0, v_teachers - card.free_teacher_seats) * card.teacher_seat_poisha;

    if v_plan = 'institution'::public.plan_type then
      v_monthly := v_monthly
        + greatest(0, v_branches - card.included_branches) * card.branch_poisha;
    end if;

    v_daily := v_monthly / 30;
  end if;

  if v_daily <= 0 or v_charged_through > v_today then
    return jsonb_build_object('ok', true, 'status', 'nothing_due',
                              'dailyPoisha', v_daily, 'chargedPoisha', 0,
                              'days', 0);
  end if;

  select coalesce(pg_catalog.sum(l.amount_poisha), 0)
    into v_balance
  from public.billing_ledger l
  where l.coaching_center_id = p_center;

  v_day := v_charged_through + 1;
  while v_day < v_today loop
    exit when v_balance < v_daily;

    insert into public.billing_ledger (
      coaching_center_id, kind, amount_poisha, charge_date,
      usage_students, usage_teachers, usage_branches,
      description, price_version_id, top_up
    ) values (
      p_center, 'daily_charge', -v_daily, v_day,
      v_students, v_teachers, v_branches,
      'One day''s use.', card.id, false
    );

    select coalesce(max(r.attempt), 0) into v_attempt
    from app.settlement_runs r
    where r.coaching_center_id = p_center
      and r.charge_date = v_day;

    insert into app.settlement_runs (
      coaching_center_id, charge_date, status, attempt, price_version_id,
      usage_students, usage_teachers, usage_branches, amount_poisha, ran_by
    ) values (
      p_center, v_day, 'settled', v_attempt + 1, card.id,
      v_students, v_teachers, v_branches, -v_daily, p_ran_by
    );

    v_balance := v_balance - v_daily;
    v_charged := v_charged + v_daily;
    v_days := v_days + 1;
    v_day := v_day + 1;
  end loop;

  if exists (
    select 1 from public.billing_ledger l
    where l.coaching_center_id = p_center
      and l.charge_date = v_today
      and l.kind = 'daily_charge'
      and not l.top_up
  ) then
    select coalesce(-pg_catalog.sum(l.amount_poisha), 0)
      into v_today_so_far
    from public.billing_ledger l
    where l.coaching_center_id = p_center
      and l.charge_date = v_today
      and l.kind = 'daily_charge';

    v_diff := v_daily - v_today_so_far;
    if v_diff > 0 then
      select coalesce(max(r.attempt), 0) into v_attempt
      from app.settlement_runs r
      where r.coaching_center_id = p_center
        and r.charge_date = v_today;

      if v_balance >= v_diff then
        insert into public.billing_ledger (
          coaching_center_id, kind, amount_poisha, charge_date,
          usage_students, usage_teachers, usage_branches,
          description, price_version_id, top_up
        ) values (
          p_center, 'daily_charge', -v_diff, v_today,
          v_students, v_teachers, v_branches,
          'Same day, larger roster.', card.id, true
        );

        insert into app.settlement_runs (
          coaching_center_id, charge_date, status, attempt, price_version_id,
          usage_students, usage_teachers, usage_branches, amount_poisha, ran_by
        ) values (
          p_center, v_today, 'settled', v_attempt + 1, card.id,
          v_students, v_teachers, v_branches, -v_diff, p_ran_by
        );

        v_balance := v_balance - v_diff;
        v_charged := v_charged + v_diff;
        v_days := v_days + 1;
      else
        insert into app.settlement_runs (
          coaching_center_id, charge_date, status, attempt, price_version_id,
          usage_students, usage_teachers, usage_branches, amount_poisha, ran_by
        ) values (
          p_center, v_today, 'insufficient_balance', v_attempt + 1, card.id,
          v_students, v_teachers, v_branches, 0, p_ran_by
        );
        v_outcome := 'insufficient_balance';
      end if;
    end if;

    update public.coaching_centers
       set charged_through = v_today
     where id = p_center
       and charged_through < v_today;
  elsif v_charged_through < v_today then
    select coalesce(max(r.attempt), 0) into v_attempt
    from app.settlement_runs r
    where r.coaching_center_id = p_center
      and r.charge_date = v_today;

    if v_balance >= v_daily then
      insert into public.billing_ledger (
        coaching_center_id, kind, amount_poisha, charge_date,
        usage_students, usage_teachers, usage_branches,
        description, price_version_id, top_up
      ) values (
        p_center, 'daily_charge', -v_daily, v_today,
        v_students, v_teachers, v_branches,
        'One day''s use.', card.id, false
      );

      insert into app.settlement_runs (
        coaching_center_id, charge_date, status, attempt, price_version_id,
        usage_students, usage_teachers, usage_branches, amount_poisha, ran_by
      ) values (
        p_center, v_today, 'settled', v_attempt + 1, card.id,
        v_students, v_teachers, v_branches, -v_daily, p_ran_by
      );

      v_balance := v_balance - v_daily;
      v_charged := v_charged + v_daily;
      v_days := v_days + 1;
    else
      insert into app.settlement_runs (
        coaching_center_id, charge_date, status, attempt, price_version_id,
        usage_students, usage_teachers, usage_branches, amount_poisha, ran_by
      ) values (
        p_center, v_today, 'insufficient_balance', v_attempt + 1, card.id,
        v_students, v_teachers, v_branches, 0, p_ran_by
      );
      v_outcome := 'insufficient_balance';
    end if;
  end if;

  return jsonb_build_object(
    'ok', true, 'status', v_outcome,
    'dailyPoisha', v_daily, 'chargedPoisha', v_charged,
    'days', v_days, 'balanceAfter', v_balance
  );
end;
$$;

comment on function public.settle_billing(uuid, text) is
  'MASTERPLAN.md §11.7 — the burn. Charges every unsettled whole past day and '
  'today at the current size, whole days only, under the ledger balance lock, '
  'with the head counts and the price card recorded on every row. Idempotent '
  'per day: the base charge is unique per (centre, date) and the top-up '
  'inserts only the difference. Accepts no amount from anybody.';

revoke all on function public.settle_billing(uuid, text) from public, anon;
grant execute on function public.settle_billing(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Free-to-paid upgrade starting line (BILL-01).
--
-- A centre on teacher_free burns nothing and settle_billing writes nothing for
-- it, so its charged_through remains at the day it was created. When it later
-- moves to a paid tier without an explicit charged_through override, the days
-- it spent on teacher_free were free by contract (§11.6) and must not be billed
-- retroactively as missed paid days. Advancing charged_through to at least
-- yesterday (Dhaka) means the paid tier begins billing from today.
-- ---------------------------------------------------------------------------

create or replace function app.advance_charged_through_on_upgrade()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_yesterday date := ((pg_catalog.now() at time zone 'Asia/Dhaka')::date - 1);
begin
  if old.plan = 'teacher_free'::public.plan_type
     and new.plan <> 'teacher_free'::public.plan_type
     and new.charged_through is not distinct from old.charged_through
  then
    new.charged_through := greatest(new.charged_through, v_yesterday);
  end if;

  return new;
end;
$$;

comment on function app.advance_charged_through_on_upgrade() is
  'BEFORE UPDATE OF plan ON public.coaching_centers: advances charged_through '
  'to at least yesterday (Dhaka) when a centre upgrades out of teacher_free '
  'without an explicit charged_through override, so historical free-tier days '
  'are never retroactively charged.';

drop trigger if exists coaching_centers_upgrade_charged_through on public.coaching_centers;

create trigger coaching_centers_upgrade_charged_through
  before update of plan on public.coaching_centers
  for each row execute function app.advance_charged_through_on_upgrade();

revoke all on function app.advance_charged_through_on_upgrade() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Explicit SELECT grant on public.fee_waiver_month (SEC-02).
-- ---------------------------------------------------------------------------

grant select on public.fee_waiver_month to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Freeze branch_id in app.guard_invoice_void() (SEC-02).
-- ---------------------------------------------------------------------------

create or replace function app.guard_invoice_void()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  server_role boolean := current_user in ('service_role', 'postgres', 'supabase_admin');
  on_it numeric;
  waiver_changed boolean;
begin
  if tg_op = 'DELETE' then
    if not server_role then
      raise exception
        'a fee invoice is a bill that was issued and cannot be deleted by %; '
        'cancel it instead, which keeps it off every total and out of every chase',
        current_user
        using errcode = '42501';
    end if;
    return old;
  end if;

  if not server_role
     and (new.id is distinct from old.id
          or new.coaching_center_id is distinct from old.coaching_center_id
          or new.branch_id is distinct from old.branch_id
          or new.student_id is distinct from old.student_id
          or new.enrollment_id is distinct from old.enrollment_id
          or new.period_month is distinct from old.period_month
          or new.amount_bdt is distinct from old.amount_bdt
          or new.revenue_category is distinct from old.revenue_category
          or new.due_date is distinct from old.due_date
          or new.note is distinct from old.note
          or new.created_at is distinct from old.created_at
          or new.idempotency_key is distinct from old.idempotency_key
          or new.instalment_plan_id is distinct from old.instalment_plan_id
          or new.instalment_no is distinct from old.instalment_no
          or new.instalment_of is distinct from old.instalment_of)
  then
    raise exception
      'a fee invoice says what was billed and cannot be rewritten by %; '
      'cancel it and raise the right one', current_user
      using errcode = '42501';
  end if;

  waiver_changed := new.discount_bdt is distinct from old.discount_bdt
    or new.discount_percent is distinct from old.discount_percent
    or new.scholarship_id is distinct from old.scholarship_id;

  if new.voided_at is not null and old.voided_at is null then
    if not server_role then
      new.voided_at := pg_catalog.now();
      new.voided_by := auth.uid();
    end if;

    select coalesce(pg_catalog.sum(p.amount_bdt), 0) into on_it
    from public.fee_payments p
    where p.invoice_id = new.id;

    if on_it <> 0 then
      raise exception
        'invoice % has %৳ received against it and cannot be cancelled; '
        'refund it as a negative payment first', new.id, on_it
        using errcode = '42501';
    end if;
  end if;

  if new.voided_at is null then
    new.voided_by := null;
    new.void_reason := null;
  end if;

  if waiver_changed
     and not server_role
     and coalesce(new.voided_at, old.voided_at) is not null
  then
    raise exception
      'invoice % is cancelled, so waiving a fee on it changes no total anybody sees; '
      'restore it first', new.id
      using errcode = '42501';
  end if;

  if waiver_changed and not server_role then
    new.discounted_at := pg_catalog.now();
    new.discounted_by := auth.uid();
  end if;

  if new.discount_bdt = 0 then
    new.discount_reason := null;
    new.discount_percent := null;
    new.scholarship_id := null;
    new.discounted_by := null;
    new.discounted_at := null;
  end if;

  return new;
end;
$$;

comment on function app.guard_invoice_void() is
  'Belt and braces over the column grant on fee_invoices. Refuses a DELETE, refuses any '
  'rewrite of what was billed - including its branch snapshot, what it was billed for, '
  'the uuid that made it idempotent, and which part of which instalment agreement it is - '
  'refuses cancelling a bill that holds money, refuses waiving a fee on a cancelled bill '
  'or relabelling one, and stamps who cancelled or discounted it and when rather than '
  'taking any of it from the client.';

drop trigger if exists fee_invoices_guard_void on public.fee_invoices;

create trigger fee_invoices_guard_void
  before update or delete on public.fee_invoices
  for each row execute function app.guard_invoice_void();

revoke all on function app.guard_invoice_void() from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- 5. Pin empty search_path on public.set_updated_at() and
--    public.enforce_marks_within_total() (SEC-02).
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from anon, public;

create or replace function public.enforce_marks_within_total()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  max_marks numeric(6, 2);
begin
  if new.obtained_marks is null then
    return new;
  end if;

  select e.total_marks into max_marks
  from public.exams e
  where e.id = new.exam_id;

  if new.obtained_marks > max_marks then
    raise exception 'obtained_marks (%) exceeds exam total_marks (%)',
      new.obtained_marks, max_marks;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_marks_within_total() from anon, public;
