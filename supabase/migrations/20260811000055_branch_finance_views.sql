-- §8.3's branch comparison, one zoom level down from §9.1 and §9.8.
--
-- MASTERPLAN.md §8.3: "revenue and expenses per branch, students per branch, collection
-- rate per branch, and the shared capacity pool with what is left of it. A branch
-- comparison table where the branches are rows, so the owner can see which one is
-- carrying the others."
--
-- 20260811000049 said why it could not be built then: `salary_payments` had no branch
-- column, "so three of the four sides of a per-branch profit line exist and the fourth
-- does not", and a join through the employee would let somebody who changes branch
-- rewrite which branch paid last year's salaries. 20260811000052 added the snapshot on
-- the same argument. That is the only thing that was missing.
--
-- EVERY VIEW HERE IS A FINER GROUPING OF ONE THAT ALREADY EXISTS, AND THE COARSER ONE IS
-- REDEFINED TO SUM IT. Not tidiness — it is the whole reason this is one migration and
-- not three views written beside the old ones:
--
--   * A branch column that does not add up to the centre headline is the worst possible
--     failure of a comparison table. An owner who totals the branch rows, gets a
--     different profit from the dashboard's, and cannot tell which is lying stops
--     trusting both numbers. Summing downward makes the disagreement unrepresentable
--     rather than merely tested for.
--
--   * `amount_bdt - discount_bdt`, the Dhaka month boundary on `paid_at`, and
--     `category <> 'salary'` each stay in exactly one place. 49 already argued the first
--     ("charged is `amount_bdt - discount_bdt` in exactly one place in this database"),
--     35 the second, and 45 the third, and the third is the dangerous one: a second view
--     summing expenses without the salary filter subtracts payroll twice and reads a
--     profitable month as a loss. check-migrations.mjs enforces that exactly one view
--     reads the expense table, and after this migration that view is
--     `branch_profit_month` — the entry in EXPENSE_READERS is renamed, not added to.
--
-- HEAD OFFICE IS A ROW, NOT A WILDCARD, which is the same rule the app's `elsewhere()`
-- follows: a null `branch_id` groups with other nulls and with nothing else. A
-- single-branch centre therefore has one nameless row here and reads the centre views
-- instead; an institution has a "Head office" row for money that belongs to the desk
-- that is not in any building. Drawing null as "all branches" would double every figure.
--
-- WHO SEES HOW MANY ROWS IS NOT DECIDED HERE, and that is why §8.3 is called what HQ
-- sees. These are security_invoker, so 20260811000053's restrictive branch policies on
-- fee_payments, expenses and salary_payments do the work: HQ gets every branch, a pinned
-- manager gets one row — their own — from the same query. There is no branch filter in
-- any of this SQL and there must not be one, because a filter here would be a second
-- opinion about a boundary the database already holds.
--
-- THE COLLECTION RATE IS STILL NOT A COLUMN, per 49: it is `paid_bdt / charged_bdt`, and
-- a branch that billed nothing this month would make it a division by zero. What to show
-- for that month is the screen's decision and not the arithmetic's.
--
-- TWO GROUPINGS OF THE WORD "MONTH" SURVIVE INTO THIS FILE, under 49's naming rules.
-- `branch_charges_month` is keyed by the month billed for and carries charged/paid/
-- outstanding; `branch_collections_month` and `branch_profit_month` are keyed by the
-- month cash arrived. They are deliberately not one view: a row keyed `period_month`
-- whose columns meant two different months is precisely the lie §9.1 warns about.
--
-- Students per branch and the capacity pool, which §8.3 also asks for, are not views.
-- A student count is `count(*)` on a table the caller can already read, and the pool is
-- one number for the whole organisation (§17: never per-branch quotas) that lives on
-- coaching_centers. Both belong to the screen.
--
-- No new indexes. The four groupings land on the partial branch indexes from 45, 47 and
-- 52 — `expenses_branch_idx`, `fee_invoices_branch_idx`, `fee_payments_branch_idx`,
-- `salary_payments_branch_idx` — which exist for this and were built with a `where
-- branch_id is not null` clause because a single-branch centre has nothing to compare.

-- ---------------------------------------------------------------------------
-- 1. The finest grain gains a branch.
--
-- Replacing rather than adding: this view had no reader in the app, so nothing depends
-- on its row count, and a second view computing charged would put the waiver arithmetic
-- in two places. `create or replace view` may only append a column, which is why
-- branch_id goes last despite being part of the key.
--
-- The branch is the INVOICE's, not the payment's. The row is one invoice's charge, and
-- 20260811000047 stamps a payment from its invoice anyway — but grouping by the payment's
-- column would split one bill across two rows if a family ever paid at two counters, and
-- then the charged side would be counted twice.
-- ---------------------------------------------------------------------------

create or replace view fee_charges_category_month with (security_invoker = true) as
select
  i.coaching_center_id,
  i.period_month,
  i.revenue_category,
  sum(i.amount_bdt - i.discount_bdt)::numeric(12, 2) as charged_bdt,
  coalesce(sum(p.paid_bdt), 0)::numeric(12, 2) as paid_bdt,
  (sum(i.amount_bdt - i.discount_bdt) - coalesce(sum(p.paid_bdt), 0))::numeric(12, 2)
    as outstanding_bdt,
  i.branch_id
from fee_invoices i
left join (
  select invoice_id, coaching_center_id, sum(amount_bdt) as paid_bdt
  from fee_payments
  group by invoice_id, coaching_center_id
) p
  on p.invoice_id = i.id
 and p.coaching_center_id = i.coaching_center_id
where i.voided_at is null
group by 1, 2, 3, 7;

comment on view fee_charges_category_month is
  'MASTERPLAN.md §9.1 and §9.7 together: per centre, per month billed for, per revenue '
  'category, per branch — charged (net of waivers), paid against those bills whenever it '
  'arrived, and the gap. Grouped by period_month, NOT by when the money came in: for '
  'cash through the door in a month use fee_collections_month. The branch is the '
  'invoice''s snapshot, and a null one is head office rather than every branch. '
  'Cancelled bills are in no line. security_invoker.';

-- ---------------------------------------------------------------------------
-- 2. §8.3's charged, paid and outstanding, branches as rows.
--
-- Summed from the view above for the same reason `fee_charges_month` is, and that view
-- is left alone: it groups by centre and month only, so the extra key above changes
-- nothing it reports.
-- ---------------------------------------------------------------------------

create view branch_charges_month with (security_invoker = true) as
select
  coaching_center_id,
  branch_id,
  period_month,
  sum(charged_bdt)::numeric(12, 2) as charged_bdt,
  sum(paid_bdt)::numeric(12, 2) as paid_bdt,
  sum(outstanding_bdt)::numeric(12, 2) as outstanding_bdt
from fee_charges_category_month
group by 1, 2, 3;

grant select on branch_charges_month to authenticated;

comment on view branch_charges_month is
  'MASTERPLAN.md §8.3''s charged and paid columns: §9.1''s three numbers per branch per '
  'month billed for. Summed from fee_charges_category_month so a branch row and the '
  'centre headline can never disagree. The collection rate is paid_bdt / charged_bdt and '
  'is deliberately not a column — a branch that billed nothing would divide by zero, and '
  'what to show then is the screen''s decision. security_invoker, so a pinned manager '
  'gets their own branch and head office gets every branch, from the same query.';

-- ---------------------------------------------------------------------------
-- 3. Cash through the door, branches as rows.
--
-- The Dhaka month boundary lives here now and 20260811000035's view sums this one, so
-- the expression exists once. 35's header is the argument for it: `paid_at` is a
-- timestamptz, a fee taken at 1am Dhaka on the 1st is 19:00 UTC on the last day of the
-- previous month, and truncating the string files it under a month the owner has already
-- closed and reported.
--
-- The branch is the PAYMENT's here, not the invoice's, and the difference is real even
-- though 47 stamps one from the other: this view answers which cash box the money went
-- into.
-- ---------------------------------------------------------------------------

create view branch_collections_month with (security_invoker = true) as
select
  p.coaching_center_id,
  p.branch_id,
  (date_trunc('month', p.paid_at at time zone 'Asia/Dhaka'))::date as period_month,
  sum(p.amount_bdt)::numeric(12, 2) as collected_bdt
from fee_payments p
group by 1, 2, 3;

grant select on branch_collections_month to authenticated;

comment on view branch_collections_month is
  'MASTERPLAN.md §8.3''s revenue column: everything taken in a Dhaka calendar month by '
  'payment date, per branch. Refunds are negative rows and net themselves out. '
  'fee_collections_month is this summed, so the Dhaka month boundary is defined once. '
  'A null branch is head office. security_invoker, and no role gate — same audience as '
  'fee_collections_month, per 20260811000035.';

-- ---------------------------------------------------------------------------
-- 4. The centre's cash box is its branches added up.
--
-- Same three columns, same types, same gate — this is a regrouping and not a change of
-- meaning, and every existing reader is unaffected.
-- ---------------------------------------------------------------------------

create or replace view fee_collections_month with (security_invoker = true) as
select
  coaching_center_id,
  period_month,
  sum(collected_bdt)::numeric(12, 2) as collected_bdt
from branch_collections_month
group by 1, 2;

comment on view fee_collections_month is
  'One row per centre per Dhaka calendar month: everything taken in that month by '
  'payment date, summed in SQL. Refunds are negative rows and net themselves out. '
  'A month with no payments has no row, which callers read as zero. Summed from '
  'branch_collections_month (20260811000055) so the month boundary is defined once. '
  'security_invoker, so the caller''s own fee_payments policies decide which '
  'payments reach the total — no extra role gate here, deliberately.';

-- ---------------------------------------------------------------------------
-- 5. Profit, branches as rows.
--
-- §9.8's arithmetic at §8.3's grain, and the one view in this database allowed to sum
-- the expense table. 49's header carries the reasoning for its three dates, its
-- exclusion of the salary category, and its gate; all of it applies unchanged, so what
-- follows is only what the branch key adds.
--
-- THE SPINE IS A UNION OVER (CENTRE, BRANCH, MONTH) AND THE BRANCH BEING IN THE KEY IS
-- THE POINT. A branch that opened last month has rent and no collections; a branch
-- winding down has salaries and an empty cash box; head office has neither and pays the
-- accountant. Joining any two sides would drop whichever branch-months are missing from
-- the side that led, and those are the rows an owner asking which branch carries the
-- others most needs to see. `union` and not `union all` because one branch-month is one
-- branch-month, and it treats two nulls as the same head office.
--
-- A branch-month with no row on a side reads as zero on that side, which is right for
-- collections and expenses and is 49's known soft spot on payroll: a branch whose
-- salaries have not been entered is indistinguishable from a branch with no staff, and
-- at this grain that is easier to hit, because entering payroll centrally leaves every
-- branch but head office looking free. §9.10's screen has to say which months have a
-- payroll row rather than leaving an owner to notice.
-- ---------------------------------------------------------------------------

create view branch_profit_month with (security_invoker = true) as
with expense_month as (
  select
    e.coaching_center_id,
    e.branch_id,
    (date_trunc('month', e.spent_on))::date as period_month,
    sum(e.amount_bdt)::numeric(12, 2) as expenses_bdt
  from expenses e
  where e.category <> 'salary'
  group by 1, 2, 3
),
payroll_month as (
  select
    s.coaching_center_id,
    s.branch_id,
    s.for_month as period_month,
    sum(s.amount_bdt)::numeric(12, 2) as payroll_bdt
  from salary_payments s
  group by 1, 2, 3
),
months as (
  select coaching_center_id, branch_id, period_month from branch_collections_month
  union
  select coaching_center_id, branch_id, period_month from expense_month
  union
  select coaching_center_id, branch_id, period_month from payroll_month
)
select
  m.coaching_center_id,
  m.branch_id,
  m.period_month,
  coalesce(c.collected_bdt, 0)::numeric(12, 2) as collected_bdt,
  coalesce(x.expenses_bdt, 0)::numeric(12, 2) as expenses_bdt,
  coalesce(pr.payroll_bdt, 0)::numeric(12, 2) as payroll_bdt,
  (coalesce(c.collected_bdt, 0)
     - coalesce(x.expenses_bdt, 0)
     - coalesce(pr.payroll_bdt, 0))::numeric(12, 2) as profit_bdt
from months m
-- `is not distinct from` on every branch join, because head office is a null and a plain
-- `=` would drop its row from all three sides and leave a month of nothing but zeroes.
left join branch_collections_month c
  on c.coaching_center_id = m.coaching_center_id
 and c.branch_id is not distinct from m.branch_id
 and c.period_month = m.period_month
left join expense_month x
  on x.coaching_center_id = m.coaching_center_id
 and x.branch_id is not distinct from m.branch_id
 and x.period_month = m.period_month
left join payroll_month pr
  on pr.coaching_center_id = m.coaching_center_id
 and pr.branch_id is not distinct from m.branch_id
 and pr.period_month = m.period_month
-- The intersection of who may read all three parts, per 49: not the founder, who can read
-- expenses and payroll and not fee_payments and would be handed a fabricated loss.
where app.is_staff_admin(m.coaching_center_id);

grant select on branch_profit_month to authenticated;

comment on view branch_profit_month is
  'MASTERPLAN.md §8.3 and §9.8: collected − expenses − payroll = profit, per branch per '
  'month, and the only place in the product allowed to sum expenses toward a profit '
  'figure — center_profit_month is this summed. Collections are cash (payment date, '
  'Dhaka) and expenses are cash (spent_on); payroll is accrual (for_month), per §9.5, so '
  'a month with no payroll row reads as a branch with no staff. The salary expense '
  'category is excluded so payroll is not subtracted twice. A null branch is head '
  'office. Owners and managers only: a figure made of parts with different audiences is '
  'gated on the intersection. security_invoker, so a pinned manager sees one row.';

-- ---------------------------------------------------------------------------
-- 6. The centre's profit is its branches added up.
--
-- Same six columns, same types, same gate — inherited from the view above rather than
-- restated, which is what makes the comparison table provably total to the dashboard's
-- figure.
-- ---------------------------------------------------------------------------

create or replace view center_profit_month with (security_invoker = true) as
select
  coaching_center_id,
  period_month,
  sum(collected_bdt)::numeric(12, 2) as collected_bdt,
  sum(expenses_bdt)::numeric(12, 2) as expenses_bdt,
  sum(payroll_bdt)::numeric(12, 2) as payroll_bdt,
  sum(profit_bdt)::numeric(12, 2) as profit_bdt
from branch_profit_month
group by 1, 2;

comment on view center_profit_month is
  'MASTERPLAN.md §9.8: collected − expenses − payroll = profit, per centre per month, '
  'summed from branch_profit_month (20260811000055) so the branch breakdown and the '
  'centre total can never disagree. Collections are cash (payment date, Dhaka) and '
  'expenses are cash (spent_on); payroll is accrual (for_month), per §9.5 — so a '
  'month''s payroll side completes only once those salaries have been paid, and a month '
  'with no payroll row reads as a month with no staff. The salary expense category is '
  'excluded so payroll is not subtracted twice. Owners and managers only: a figure made '
  'of parts with different audiences is gated on the intersection, because anyone '
  'outside it gets a wrong number rather than a partial one. security_invoker.';
