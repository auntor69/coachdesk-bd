-- The three numbers, and the one that is made of them.
--
-- MASTERPLAN.md §9.1:
--
--   | Charged     | what we billed        | fee_invoices.amount_bdt − discount_bdt |
--   | Collected   | what actually arrived | sum of fee_payments.amount_bdt         |
--   | Outstanding | the gap               | charged − collected, per invoice        |
--
--   "Reports must label which one they are showing. 'Revenue' that silently means
--   charged tells an owner they had a good month while the cash never came, and that is
--   the single most expensive lie a finance screen can tell."
--
-- And §9.8:
--
--   "Revenue collected (§9.1, the collected column) − Expenses (§9.6) − Payroll (§9.5,
--   salary payments actually made) = Profit. Payroll is inside this, not beside it. A
--   profit figure that excludes salaries is the number that convinces an owner to expand
--   into a loss."
--
-- THERE ARE TWO HONEST MEANINGS OF "COLLECTED" AND THIS FILE SHIPS BOTH, under names that
-- cannot be mistaken for each other. A March bill paid in April is charged in March and
-- the cash arrives in April, so:
--
--   * fee_charges_month says what a month's bills came to and how much of them has
--     arrived — grouped by `period_month`, the month the teaching happened in. This is
--     the one §9.1's table describes, and its third column is the only correct way to
--     compute outstanding, because a gap between two figures grouped by different months
--     is not a gap.
--
--   * fee_collections_month, which 20260811000035 already built, says what came through
--     the door in a month whatever it was for — grouped by `paid_at`. That is the figure
--     §9.8 subtracts from.
--
-- So the column here is `paid_bdt` and not `collected_bdt`, matching
-- `fee_invoice_balances.paid_bdt`, which is the same quantity one invoice at a time. Two
-- columns called `collected` meaning two things is precisely the lie §9.1 warns about,
-- and the cheapest defence against it is not having the name twice.
--
-- THE PROFIT LINE IS CASH ON TWO SIDES AND ACCRUAL ON THE THIRD, deliberately, and that
-- is the one thing in this file somebody will read as a mistake. The reasons are already
-- written into the two migrations it reads from:
--
--   * Expenses are dated by `spent_on`, per 20260811000045 — "Rent does not lag: it is
--     paid in the first days of the month it covers", which keeps that side in step with
--     the collected column.
--
--   * Payroll is dated by `for_month`, per 20260811000044 — "December's salary handed
--     over in January is December's cost, and §9.8's profit line has to put it in the
--     month it belongs to or every January reads as a disaster." That lag is not a
--     centre being late, it is how the country pays staff, and reading it as cash would
--     put a systematic error into every month rather than fixing one.
--
-- The cost of the mixture is that a month's profit is final for its collections the day
-- the month ends, but only complete for its payroll once that month's salaries have
-- actually been handed over — so an owner opening December's profit in December is
-- reading a figure that has not finished. A month with no payroll row reads as a month
-- with no staff, and nothing in the schema can tell those apart. Worth stating: it is the
-- one place where a screen showing this view should say when the payroll side was last
-- written to.
--
-- THE SALARY EXPENSE CATEGORY IS EXCLUDED, AND THIS IS THE ONE HOME FOR THAT RULE.
-- 20260811000045 shipped `salary` in the expense list on purpose — a centre that has not
-- set up terms per person still knows it paid the staff, and refusing the category would
-- send that money to `miscellaneous` where it is invisible instead of merely awkward —
-- and its header says what has to follow: "when §16's step 16 builds the profit line it
-- must be one view, defining the expense side as sum(amount_bdt) where category <>
-- 'salary' and the payroll side from salary_payments, and nothing else in the product may
-- sum expenses to get a profit." A centre that pays through payroll and also logs the
-- same money as a salary expense would otherwise be subtracted twice, and the profit line
-- would quietly read worse than the business is.
--
-- WHO MAY READ THE PROFIT LINE: STAFF ADMINS, AND NOT THE FOUNDER. The gate is derived
-- rather than chosen. Collections can be read by an owner, a manager, a teacher with
-- §6.5's `can_view_fees`, and a family; expenses and payroll only by an owner, a manager
-- or a platform admin. The intersection is owner-and-manager, and that is the gate —
-- because the general rule for a figure composed of parts with different audiences is
-- that anyone outside the intersection receives a number that is WRONG rather than
-- partial. A fee-visible teacher without the gate would see their students' payments,
-- zero expenses, zero payroll, and a profit equal to the fees they happened to collect.
--
-- The founder is the case that makes the rule concrete, and it is the reason
-- `app.is_platform_admin()` is absent here where 20260811000045 and 20260811000044 both
-- have it. A platform admin can read `expenses` and `salary_payments` and CANNOT read
-- `fee_payments` — 20260811000002 gives that table a staff-admin policy and a family
-- self-read policy and nothing else. So a founder reading this view without the gate
-- would get zero collected against real costs: a large loss, on a centre having a good
-- month, on the screen used to answer a support call. If §10's support work ever needs a
-- profit figure, it needs the collections side opened first, which is a decision about
-- what the founder may see of a centre's takings and not something to slip in through a
-- view's WHERE clause.
--
-- 20260811000011 is the precedent for a view checking a role itself, and its reasoning is
-- the same one: "security_invoker means the caller's own RLS decides which rows reach the
-- aggregate, and for an aggregate that is a sharper edge than it is for a per-row view."
-- The two charge views need no such gate — they read only invoices and payments, so a
-- narrower caller gets fewer rows rather than wrong ones, and a caller who can read
-- neither gets nothing at all.
--
-- WHAT IS NOT HERE.
--
-- The dashboards. §9.10's Center and Institution HQ screens are §16's step 17. This is
-- the arithmetic they read, in the one place it is allowed to live.
--
-- §8.3's branch comparison, and the reason is a finding rather than a deferral: it cannot
-- be built yet. 20260811000047 gave both money tables a `branch_id` snapshot and
-- 20260811000045 gave expenses one, but `salary_payments` has no branch column at all —
-- so three of the four sides of a per-branch profit line exist and the fourth does not. It
-- cannot be a join through the employee either, for exactly the reason 47 exists: an
-- employee who moves branch would rewrite which branch paid last year's salaries. Step 17
-- needs a snapshot column on salary_payments first, on the same argument and in its own
-- migration.
--
-- Income with no student behind it — hall rent, book sales — which 20260811000048
-- documented as having no home in the schema. It is outside the collected column, so it is
-- outside this profit line, and a centre with a lot of it will read low here.
--
-- No new indexes. The three groupings land on indexes that already exist:
-- `fee_invoices_center_revenue_idx` from 20260811000048, `expenses_center_spent_idx` from
-- 45, `salary_payments_center_month_idx` from 44, and `fee_payments_invoice_idx` from the
-- first migration. And these are plain views, recomputed per read, because a materialized
-- one would need a refresh policy and a stale profit figure is worse than a slow one.

-- ---------------------------------------------------------------------------
-- 1. Charged, paid and outstanding, split by what the money was for.
--
-- The finest grain, so §9.7's question and §9.1's headline are the same arithmetic read
-- at two zoom levels rather than two definitions that can drift. The view below is this
-- one summed.
--
-- Cancelled bills are excluded rather than shown as zero: a cancelled bill was never
-- charged, which is the whole difference between `voided_at` and a delete. Refunds need no
-- handling of their own — they are negative `fee_payments` rows, so summing nets them off
-- and the family correctly appears to owe money again.
-- ---------------------------------------------------------------------------

create view fee_charges_category_month with (security_invoker = true) as
select
  i.coaching_center_id,
  i.period_month,
  i.revenue_category,
  -- Charged is what the family was actually asked for, so the waiver comes off it. A
  -- discount is not revenue that failed to arrive; it is revenue never billed.
  sum(i.amount_bdt - i.discount_bdt)::numeric(12, 2) as charged_bdt,
  coalesce(sum(p.paid_bdt), 0)::numeric(12, 2) as paid_bdt,
  (sum(i.amount_bdt - i.discount_bdt) - coalesce(sum(p.paid_bdt), 0))::numeric(12, 2)
    as outstanding_bdt
from fee_invoices i
-- Grouped per invoice first, so the join is one row to one row and the sums above cannot
-- be multiplied by the number of instalments a family paid in. The tenant column travels
-- with the join, per 20260811000005: joining on id alone would be a sideways reference.
left join (
  select invoice_id, coaching_center_id, sum(amount_bdt) as paid_bdt
  from fee_payments
  group by invoice_id, coaching_center_id
) p
  on p.invoice_id = i.id
 and p.coaching_center_id = i.coaching_center_id
where i.voided_at is null
group by 1, 2, 3;

grant select on fee_charges_category_month to authenticated;

comment on view fee_charges_category_month is
  'MASTERPLAN.md §9.1 and §9.7 together: per centre, per month billed for, per revenue '
  'category — charged (net of waivers), paid against those bills whenever it arrived, '
  'and the gap. Grouped by period_month, NOT by when the money came in: for cash '
  'through the door in a month use fee_collections_month. Cancelled bills are in no '
  'line. security_invoker.';

-- ---------------------------------------------------------------------------
-- 2. The same three numbers, without the split.
--
-- §9.1's headline. Selected FROM the view above rather than repeating its query, which is
-- the whole reason this is a second view instead of a second aggregate: charged is
-- `amount_bdt - discount_bdt` in exactly one place in this database, and a screen showing
-- the category breakdown beside the total can never show a breakdown that does not add up
-- to it.
--
-- Summing a sum is safe here because the inner view's groups partition the invoices — one
-- invoice belongs to one centre, one period and one category — so no row is counted twice
-- and re-summing is the same arithmetic on fewer rows. The casts are repeated rather than
-- inherited, because summing numeric(12, 2) yields plain numeric and the column type is
-- part of what the view promises.
--
-- The collection rate §8.3 asks for is not a column here. It is `paid_bdt / charged_bdt`,
-- and a centre with no bills in a month would make it a division by zero — so it belongs
-- to the screen that can decide what to show for a month that charged nothing, which is
-- not the same decision as what the arithmetic is.
-- ---------------------------------------------------------------------------

create view fee_charges_month with (security_invoker = true) as
select
  coaching_center_id,
  period_month,
  sum(charged_bdt)::numeric(12, 2) as charged_bdt,
  sum(paid_bdt)::numeric(12, 2) as paid_bdt,
  sum(outstanding_bdt)::numeric(12, 2) as outstanding_bdt
from fee_charges_category_month
group by 1, 2;

grant select on fee_charges_month to authenticated;

comment on view fee_charges_month is
  'MASTERPLAN.md §9.1''s three columns per centre per month billed for: charged, paid '
  'against those bills, outstanding. Summed from fee_charges_category_month so the '
  'category breakdown and the total can never disagree. Grouped by period_month — for '
  'cash received in a month use fee_collections_month. security_invoker.';

-- ---------------------------------------------------------------------------
-- 3. Profit.
--
-- §9.8's arithmetic, in the one view 20260811000045's header demanded, with the reasoning
-- for its three dates and its gate in this file's header.
--
-- THE MONTH SPINE IS A UNION AND NOT A JOIN, because none of the three sides is the
-- complete list of months. A centre that took no money in Ramadan still paid rent that
-- month; a centre in its first week has expenses and no collections; a centre paying
-- salaries a month late has a payroll row for a month whose cash box is already closed.
-- Joining any two of them directly would silently drop the months missing from whichever
-- side led, and the months a profit line is most worth reading are exactly the lopsided
-- ones. `union` rather than `union all` because the same month appearing on two sides is
-- one month.
--
-- The price is that fee_collections_month is scanned twice, once for the spine and once
-- for its figure. The alternative is a three-way FULL OUTER JOIN with the month and centre
-- coalesced across all three sides, which is the same result written in a way that is
-- wrong if one coalesce is forgotten — and under RLS each side here is one centre's rows,
-- so the second scan costs nothing worth that risk.
--
-- A MONTH WITH NO ROW ON A SIDE READS AS ZERO ON THAT SIDE, which is right for collections
-- and expenses and is the known soft spot on payroll: a centre that has not entered
-- December's salaries yet is indistinguishable from a centre that has no staff, and
-- December's profit reads high until they do. §9.10's dashboard has to say which months
-- have a payroll row rather than leaving an owner to notice.
--
-- Cancelled bills and refunds need no clause of their own on this side either: this reads
-- collections, a refund is a negative payment, and a cancelled bill has nothing on it to
-- collect. `category <> 'salary'` drops no row for a null category, because that column is
-- NOT NULL with a default.
-- ---------------------------------------------------------------------------

create view center_profit_month with (security_invoker = true) as
with expense_month as (
  select
    e.coaching_center_id,
    -- `spent_on` is a plain date in Dhaka terms already, per 20260811000045, so no time
    -- zone appears here where fee_collections_month needed one for its timestamptz.
    (date_trunc('month', e.spent_on))::date as period_month,
    sum(e.amount_bdt)::numeric(12, 2) as expenses_bdt
  from expenses e
  where e.category <> 'salary'
  group by 1, 2
),
payroll_month as (
  select
    s.coaching_center_id,
    -- Already the first of a month: `salary_payments_month_is_first` makes it so, which is
    -- why this is grouped rather than truncated.
    s.for_month as period_month,
    sum(s.amount_bdt)::numeric(12, 2) as payroll_bdt
  from salary_payments s
  group by 1, 2
),
months as (
  select coaching_center_id, period_month from fee_collections_month
  union
  select coaching_center_id, period_month from expense_month
  union
  select coaching_center_id, period_month from payroll_month
)
select
  m.coaching_center_id,
  m.period_month,
  coalesce(c.collected_bdt, 0)::numeric(12, 2) as collected_bdt,
  coalesce(x.expenses_bdt, 0)::numeric(12, 2) as expenses_bdt,
  coalesce(pr.payroll_bdt, 0)::numeric(12, 2) as payroll_bdt,
  (coalesce(c.collected_bdt, 0)
     - coalesce(x.expenses_bdt, 0)
     - coalesce(pr.payroll_bdt, 0))::numeric(12, 2) as profit_bdt
from months m
left join fee_collections_month c
  on c.coaching_center_id = m.coaching_center_id
 and c.period_month = m.period_month
left join expense_month x
  on x.coaching_center_id = m.coaching_center_id
 and x.period_month = m.period_month
left join payroll_month pr
  on pr.coaching_center_id = m.coaching_center_id
 and pr.period_month = m.period_month
-- The intersection of who may read all three parts. Not `or app.is_platform_admin()`: a
-- founder can read expenses and payroll and cannot read fee_payments, so they would be
-- handed a fabricated loss. The header says what opening it would take.
where app.is_staff_admin(m.coaching_center_id);

grant select on center_profit_month to authenticated;

comment on view center_profit_month is
  'MASTERPLAN.md §9.8: collected − expenses − payroll = profit, per centre per month, '
  'and the only place in the product allowed to sum expenses toward a profit figure. '
  'Collections are cash (payment date, Dhaka) and expenses are cash (spent_on); payroll '
  'is accrual (for_month), per §9.5 — so a month''s payroll side completes only once '
  'those salaries have been paid, and a month with no payroll row reads as a month with '
  'no staff. The salary expense category is excluded so payroll is not subtracted twice. '
  'Owners and managers only: a figure made of parts with different audiences is gated on '
  'the intersection, because anyone outside it gets a wrong number rather than a partial '
  'one. security_invoker.';
