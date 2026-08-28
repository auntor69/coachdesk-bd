-- ---------------------------------------------------------------------------
-- What came in this month, added up by Postgres instead of by the browser.
--
-- The dashboard's first card and the fee board both show "collected this month",
-- and both got there by reading one row per payment and summing a column in
-- JavaScript. A 250-student centre taking four subjects raises a thousand
-- invoices a month and is paid against them in instalments, so that read crosses
-- PostgREST's silent thousand-row ceiling at the size this product charges
-- 1,999 Tk for — and a ceiling nobody notices turns the number on an owner's home
-- screen into less money than they actually took.
--
-- The commit before this one made both reads page, which fixed the lie and left
-- the wrong shape: a thousand rows dragged over the wire to produce one number,
-- three round trips deep, on the screen that has to paint fastest. src/lib/
-- supabase/page.ts says so in its own header — page rows when the rows themselves
-- are needed, do not page a query to add up one column. This is the other half of
-- that sentence.
--
-- THE MONTH BOUNDARY IS DHAKA'S, AND THAT IS THE REASON THIS IS SQL. `paid_at` is
-- a timestamptz and PostgREST hands it back in UTC, so a fee taken at 1am Dhaka
-- on the 1st is 19:00 UTC on the last day of the previous month. Slicing ten
-- characters off the string — the obvious way — files that payment under a month
-- the owner has already closed, reported to a partner and screenshotted. Both
-- screens got this right by building a `+06:00` bound into the query string, in
-- two places, and a third screen would have had to remember. Here it is one
-- expression that every reader inherits.
--
-- BY PAYMENT DATE, NOT BY THE MONTH BILLED. "What came in" and "what was owed for
-- August" are different questions and the second one already has a view. A family
-- paying July's dues in August belongs to August here, because the owner asking
-- this is reconciling a cash box.
--
-- REFUNDS NET THEMSELVES OUT. A refund in this schema is a negative row in
-- fee_payments — money is never edited or deleted, only countered, which is why
-- amount_bdt is checked `<> 0` rather than `> 0`. So a plain sum is the arithmetic
-- the two screens were already doing, not a new policy about refunds.
--
-- WHY security_invoker AND NO STAFF-ADMIN GATE, unlike student_progress_week.
-- That view earned its `app.is_staff_admin` because its aggregate would mean
-- something different to a teacher — their batches' share of a child's week,
-- wearing the whole picture's name. This one is filtered by the caller's own RLS
-- on fee_payments, which is exactly what filtered the two reads it replaces: a
-- staff admin gets the centre, a teacher with can_view_fees gets the families they
-- teach, a guardian account gets their own. Adding a gate here would change what a
-- fee-visible teacher sees on a board they can already open, which is a product
-- decision and not this migration's to make.
--
-- WHAT IT DOES NOT REPLACE. The month-close screen still reads payment rows and
-- still pages them: it lists every payment with its method and receipt number, so
-- there the rows are the point and the total is a by-product.
-- ---------------------------------------------------------------------------

create view fee_collections_month with (security_invoker = true) as
select
  p.coaching_center_id,
  -- Ordinary date arithmetic once the timestamp is in Dhaka wall-clock time.
  -- `at time zone` on a timestamptz returns a plain timestamp, so the truncation
  -- and the cast happen in the calendar the centre lives in.
  (date_trunc('month', p.paid_at at time zone 'Asia/Dhaka'))::date as period_month,
  -- Bounded scale so the string PostgREST sends is always two decimal places, and
  -- the callers' Number() cannot be handed 1.0000000000000002 of anything.
  sum(p.amount_bdt)::numeric(12, 2) as collected_bdt
from fee_payments p
group by 1, 2;

comment on view fee_collections_month is
  'One row per centre per Dhaka calendar month: everything taken in that month by '
  'payment date, summed in SQL. Refunds are negative rows and net themselves out. '
  'A month with no payments has no row, which callers read as zero. '
  'security_invoker, so the caller''s own fee_payments policies decide which '
  'payments reach the total — no extra role gate here, deliberately.';

grant select on fee_collections_month to authenticated;
