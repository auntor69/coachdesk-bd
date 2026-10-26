-- CoachDesk BD — Dashboard fee summary and reminder summary views.
-- Migration: 20260811000101_dashboard_fee_and_reminder_summaries.sql
--
-- Replaces unbounded in-memory pageAll walks over fee_invoice_balances and fee_reminders
-- on the owner's and teacher's dashboard with fast, security_invoker SQL aggregates.
--
-- 1. fee_outstanding_summary & dashboard_fee_summary:
--    Aggregates outstanding balance (numeric) and overdue invoice count.
--    Accessible to staff-admins and teachers with can_view_fees = true (underlying RLS
--    on fee_invoices, students, and fee_payments naturally restricts teachers to their
--    own taught batches).
--
-- 2. dashboard_reminder_summary:
--    Aggregates count of reminders due today across unpaid reachable invoices.
--    Restricted at the database level to authorized staff-admins via app.is_staff_admin().
--    Preserves exact reminder-schedule.ts business logic:
--      - Boolean(guardian_phone): null and empty string excluded.
--      - Null due dates: coalesce to today in Dhaka.
--      - Reminder stages: soon (due-3), due (due..due+6), late (due+7..due+20), owing (fortnightly).
--      - Cooldown: 3 days between touches to the same family.
--      - Latest reminder: indexed lateral scan on fee_reminders(coaching_center_id, invoice_id, created_at desc).
-- ---------------------------------------------------------------------------

-- Compound index supporting index-only lateral lookups of the latest reminder per invoice.
create index if not exists fee_reminders_center_invoice_created_idx
  on public.fee_reminders (coaching_center_id, invoice_id, created_at desc);

-- Augment fee_outstanding_summary with overdue_count in the same single aggregation pass
create or replace view public.fee_outstanding_summary with (security_invoker = true) as
with bounds as (
  select (pg_catalog.now() at time zone 'Asia/Dhaka')::date as today
)
select
  fb.coaching_center_id,
  coalesce(sum(fb.remaining_bdt), 0) as outstanding_bdt,
  count(*)::integer as invoice_count,
  count(*) filter (where fb.due_date < b.today)::integer as overdue_count
from bounds b
cross join public.fee_invoice_balances fb
where fb.voided_at is null
  and fb.remaining_bdt > 0
group by fb.coaching_center_id;

comment on view public.fee_outstanding_summary is
  'Direct SQL aggregation of outstanding fee balances and overdue counts per tenant to eliminate unbounded client-side pageAll memory bloat.';

grant select on public.fee_outstanding_summary to authenticated;

-- Dedicated dashboard view mirroring the aggregation
create or replace view public.dashboard_fee_summary with (security_invoker = true) as
with bounds as (
  select (pg_catalog.now() at time zone 'Asia/Dhaka')::date as today
)
select
  fb.coaching_center_id,
  coalesce(sum(fb.remaining_bdt), 0) as outstanding_bdt,
  count(*)::integer as invoice_count,
  count(*) filter (where fb.due_date < b.today)::integer as overdue_count
from bounds b
cross join public.fee_invoice_balances fb
where fb.voided_at is null
  and fb.remaining_bdt > 0
group by fb.coaching_center_id;

comment on view public.dashboard_fee_summary is
  'Aggregates outstanding balance and overdue invoice count for the dashboard. '
  'security_invoker = true enforces RLS on fee_invoices, students, and fee_payments.';

revoke all on public.dashboard_fee_summary from anon, authenticated, public;
grant select on public.dashboard_fee_summary to authenticated;

-- ---------------------------------------------------------------------------
-- Staff-admins only: reminders due today
-- ---------------------------------------------------------------------------

create or replace view public.dashboard_reminder_summary with (security_invoker = true) as
with bounds as (
  select (pg_catalog.now() at time zone 'Asia/Dhaka')::date as today
),
unpaid as (
  select
    fb.coaching_center_id,
    coalesce(fb.due_date, b.today) as effective_due_date,
    (b.today - coalesce(fb.due_date, b.today))::integer as days_late,
    (fb.guardian_phone is not null and fb.guardian_phone <> '') as reachable,
    lr.last_reminded_on
  from bounds b
  cross join public.fee_invoice_balances fb
  left join lateral (
    select (r.created_at at time zone 'Asia/Dhaka')::date as last_reminded_on
    from public.fee_reminders r
    where r.invoice_id = fb.id
      and r.coaching_center_id = fb.coaching_center_id
    order by r.created_at desc
    limit 1
  ) lr on true
  where fb.voided_at is null
    and fb.remaining_bdt > 0
    and app.is_staff_admin(fb.coaching_center_id)
),
stages as (
  select
    u.coaching_center_id,
    u.reachable,
    case
      when u.days_late < -3 then null
      when u.days_late < 0  then u.effective_due_date - 3
      when u.days_late < 7  then u.effective_due_date
      else u.effective_due_date + 7 + (((u.days_late - 7) / 14) * 14)
    end as stage_since,
    u.last_reminded_on,
    b.today
  from bounds b
  cross join unpaid u
)
select
  s.coaching_center_id,
  count(*) filter (
    where s.stage_since is not null
      and s.reachable
      and (
        s.last_reminded_on is null
        or (
          s.last_reminded_on < s.stage_since
          and (s.today - s.last_reminded_on) >= 3
        )
      )
  )::integer as reminders_due_today
from bounds b
cross join stages s
group by s.coaching_center_id;

comment on view public.dashboard_reminder_summary is
  'Aggregates fee reminders due today for staff-admins on the dashboard. '
  'security_invoker = true and app.is_staff_admin() enforce staff-admin gate at database level.';

revoke all on public.dashboard_reminder_summary from anon, authenticated, public;
grant select on public.dashboard_reminder_summary to authenticated;
