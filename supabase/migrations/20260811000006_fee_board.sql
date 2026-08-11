-- ---------------------------------------------------------------------------
-- The fee board's balance view.
--
-- The board answers one question — how much money is outstanding right now —
-- and until this migration it answered it in JavaScript: fetch every invoice,
-- fetch every payment, subtract in a loop. Two things were wrong with that.
--
-- First, money. amount_bdt is numeric(10, 2), which Postgres computes exactly.
-- JavaScript has no exact decimal, so a fee of 1500.10 becomes 1500.0999... the
-- moment it is added to anything. Whole taka survive it and real coaching fees
-- are whole taka, so nothing was visibly broken — which is precisely the kind of
-- bug that waits. The subtraction and the summing belong in numeric.
--
-- Second, it fetched every payment row in the centre to add up a handful per
-- invoice. Fine at one centre, silly at fifty.
--
-- SECURITY, and the reason this migration is longer than the view it creates:
--
-- A Postgres view runs with the privileges of its OWNER, not its caller. The
-- owner here is the migration role, which bypasses RLS. So a plain view over
-- fee_invoices would hand every caller every centre's invoices — student names
-- and guardian phone numbers included — with all 63 policies still perfectly
-- intact underneath it. Verified on this exact schema before writing this:
-- querying the students table as owner B returned their 1 student; querying a
-- naive view over that same table returned 2, including the other centre's
-- child's name.
--
-- security_invoker = true (PostgreSQL 15+) makes the view execute as the caller,
-- so the RLS on fee_invoices, fee_payments and students all apply normally. It
-- is one clause and the difference between a view and a data breach, which is
-- why check-migrations.mjs now refuses any view in public that lacks it.
--
-- The join to students is deliberate rather than left to a PostgREST embed:
-- embedding through a view with an aggregate in it is not something PostgREST
-- can always resolve, and a fee board that silently renders no names is worse
-- than one that never offered them. Joining here also means the caller passes
-- through three sets of policies instead of one.
-- ---------------------------------------------------------------------------

create view fee_invoice_balances with (security_invoker = true) as
select
  i.id,
  i.coaching_center_id,
  i.student_id,
  i.enrollment_id,
  i.period_month,
  i.due_date,
  i.amount_bdt,
  i.discount_bdt,
  -- What the family actually owes, after any discount the centre granted.
  (i.amount_bdt - i.discount_bdt) as net_bdt,
  coalesce(p.paid_bdt, 0) as paid_bdt,
  (i.amount_bdt - i.discount_bdt) - coalesce(p.paid_bdt, 0) as remaining_bdt,
  i.note,
  i.voided_at,
  s.name as student_name,
  s.student_code,
  s.guardian_phone,
  s.sms_opt_out
from fee_invoices i
-- The tenant column travels with this join for the same reason 20260811000005
-- put it in every foreign key: a join on id alone would be a sideways reference.
join students s
  on s.id = i.student_id
 and s.coaching_center_id = i.coaching_center_id
left join (
  -- Refunds are stored as negative payments (fee_payments allows any non-zero
  -- amount), so summing is all that is needed to net them off. A refund is not
  -- a deletion: the original payment stays on the record, and the board shows
  -- the family owing money again.
  select invoice_id, coaching_center_id, sum(amount_bdt) as paid_bdt
  from fee_payments
  group by invoice_id, coaching_center_id
) p
  on p.invoice_id = i.id
 and p.coaching_center_id = i.coaching_center_id;

comment on view fee_invoice_balances is
  'Invoices with paid and remaining computed in numeric. security_invoker, so '
  'the caller''s RLS on fee_invoices, fee_payments and students all apply.';

-- Reads are governed entirely by the underlying policies now that the view
-- executes as the caller: staff admins see their centre, families see their own
-- bills, and anon sees nothing.
grant select on fee_invoice_balances to authenticated;
