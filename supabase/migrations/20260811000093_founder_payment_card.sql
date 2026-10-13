-- CoachDesk BD — the founder's recorded payment names the card it was priced against,
-- because its `recharge` never did and the database was refusing every one of them.
--
-- WHAT WAS WRONG. `public.founder_record_payment` (20260811000092) inserted its `recharge`
-- entry without `price_version_id`, and `billing_ledger_price_version_purpose`
-- (20260811000080) says a recharge must carry one — required on a charge and on a recharge,
-- null on every other kind. So every call raised 23514 after the receipt row and before the
-- balance moved: the panel drew, the RPC was listed in the API spec, and the money never
-- reached the customer. A transactional probe against the live database is what found it;
-- the verification that read the spec could not, because a function can be reachable and
-- still refuse every call it takes.
--
-- THE CONSTRAINT IS RIGHT AND THE WRITER LEARNS IT. §11.10: a recharge names the card the
-- quote was priced against, which is why `recharge_claims.price_version_id` is not null —
-- a claim outlives the card it was quoted from, and the approval writes the entry that says
-- so. A founder-recorded payment has no claim, but it has the same card: the one in force on
-- the Dhaka day the money was recorded, which is also the card the teacher branch already
-- reads to price a subscription. Both branches read it once, before they split, so there is
-- one answer to "which card is this money under" and no branch can forget it. No exemption
-- is added to the constraint, deliberately: two ways to write a recharge that disagree about
-- whether they name a card is the drift 20260811000080 exists to prevent.
--
-- OTHERWISE UNCHANGED, deliberately so — the amount rules, the teacher/centre split, the
-- replay read-back and the grants are 092's, restated whole because a function is replaced
-- whole. That is the cost `bootstrap_center` already records: a guard that lives only in an
-- older file is a guard the next rewrite drops.
--
-- ONE ORDER MOVED, and it is the safe direction. The card is now read before the branch, so
-- a database with no published card answers "no price version is in force" for a centre's
-- payment as well as a teacher's — the same 23503 the teacher branch already raised, rather
-- than a 23514 from the constraint. Nothing else about a call changes.
-- ---------------------------------------------------------------------------

create or replace function public.founder_record_payment(
  p_center uuid,
  p_amount_poisha bigint,
  p_months integer,
  p_reason text,
  p_method public.payment_method default 'bkash',
  p_reference text default null,
  p_idempotency_key uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_plan public.plan_type;
  v_amount numeric(10, 2);
  v_note text;
  v_card public.price_versions%rowtype;
  v_payment uuid;
  v_balance bigint;
begin
  if not app.is_platform_admin() then
    raise exception 'founder_record_payment requires the platform admin'
      using errcode = '42501';
  end if;

  if p_reason is null or pg_catalog.btrim(p_reason) = '' then
    raise exception 'a payment needs a written reason' using errcode = '22023';
  end if;

  select c.account_kind, c.plan
    into v_kind, v_plan
  from public.coaching_centers c
  where c.id = p_center;

  if not found then
    raise exception 'founder_record_payment: no such centre' using errcode = '23503';
  end if;

  -- The card in force, read for both branches: the teacher's amount is priced from it, and
  -- the `recharge` entry both branches write must name it (20260811000080). Read here so a
  -- branch cannot forget it, and so a database with no card fails before a receipt exists.
  select * into v_card
  from public.price_versions v
  where v.effective_from <= (pg_catalog.now() at time zone 'Asia/Dhaka')::date
  order by v.effective_from desc
  limit 1;

  if not found then
    raise exception 'no price version is in force' using errcode = '23503';
  end if;

  -- A teacher — by kind, or by the plan they are already on. Either is enough: a teacher
  -- whose subscription lapsed is still a teacher, and a row that has been put on Teacher
  -- Pro by an older path must not be sold a balance it would never spend.
  if v_kind = 'teacher' or v_plan = 'teacher_plus' then
    if p_months is null or p_months <= 0 then
      raise exception 'a teacher buys whole months, and % is not one', p_months
        using errcode = '22023';
    end if;

    v_amount := (v_card.teacher_plus_monthly_poisha * p_months)::numeric / 100;
    v_note := pg_catalog.btrim(p_reason) || ' — Teacher Pro, ' || p_months || ' '
              || case when p_months = 1 then 'month' else 'months' end;

    update public.coaching_centers
       set plan = 'teacher_plus',
           trial_plan = null,
           trial_ends_at = null
     where id = p_center;
  else
    -- A centre's money. Typed by the founder and positive: a negative amount is what
    -- `creditCenterPayment` exists for, with its own form and its own words.
    if p_amount_poisha is null or p_amount_poisha <= 0 then
      raise exception 'a recorded payment is a positive amount' using errcode = '22023';
    end if;

    v_amount := p_amount_poisha::numeric / 100;
    v_note := pg_catalog.btrim(p_reason);
  end if;

  begin
    insert into public.payments (
      coaching_center_id, amount_bdt, method, reference, note, recorded_by, idempotency_key
    ) values (
      p_center, v_amount, p_method, nullif(pg_catalog.btrim(coalesce(p_reference, '')), ''),
      v_note, auth.uid(), p_idempotency_key
    )
    returning id into v_payment;
  exception when unique_violation then
    -- The replay. `payments_center_idempotency_key` refused the second row, and the money
    -- is already on the balance — reading the original back is what makes the retry safe
    -- instead of a second credit.
    if p_idempotency_key is null then
      raise;
    end if;

    select p.id into v_payment
    from public.payments p
    where p.coaching_center_id = p_center
      and p.idempotency_key = p_idempotency_key
    order by p.created_at
    limit 1;

    select coalesce(pg_catalog.sum(l.amount_poisha), 0)
      into v_balance
    from public.billing_ledger l
    where l.coaching_center_id = p_center;

    return pg_catalog.jsonb_build_object(
      'ok', true, 'already', true, 'paymentId', v_payment,
      'amountPoisha', (v_amount * 100)::bigint, 'balanceAfter', v_balance
    );
  end;

  -- `price_version_id` is 080's rule and the reason this migration exists: the money this
  -- row credits is spent at the rates of the card that was in force when it arrived.
  insert into public.billing_ledger (
    coaching_center_id, kind, amount_poisha, price_version_id, description, payment_id,
    created_by, metadata
  ) values (
    p_center,
    'recharge',
    (v_amount * 100)::bigint,
    v_card.id,
    v_note,
    v_payment,
    auth.uid(),
    pg_catalog.jsonb_build_object('months', coalesce(p_months, 0), 'kind', v_kind)
  );

  select c.balance_poisha into v_balance
  from public.coaching_centers c where c.id = p_center;

  return pg_catalog.jsonb_build_object(
    'ok', true, 'already', false, 'paymentId', v_payment,
    'amountPoisha', (v_amount * 100)::bigint, 'balanceAfter', v_balance
  );
end;
$$;

comment on function public.founder_record_payment(uuid, bigint, integer, text, public.payment_method, text, uuid) is
  'MASTERPLAN.md §11.5/§11.9 — money the founder has received, recorded once and credited '
  'to the balance, because the balance is the only thing that buys days. For a teacher the '
  'amount is priced from price_versions and the plan moves to Teacher Pro in the same '
  'transaction; for a centre the founder types what arrived. Either way the recharge names '
  'the card in force, which 20260811000080 requires of the kind. Platform admin only, asked '
  'inside the database.';

revoke all on function public.founder_record_payment(
  uuid, bigint, integer, text, public.payment_method, text, uuid
) from public, anon;
grant execute on function public.founder_record_payment(
  uuid, bigint, integer, text, public.payment_method, text, uuid
) to authenticated, service_role;
