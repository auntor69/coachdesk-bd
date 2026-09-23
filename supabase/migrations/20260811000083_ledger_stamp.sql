-- CoachDesk BD — the stamp that makes the chain walkable (MASTERPLAN §11.12,
-- §11.13). A defect repair, found while step 24 wired the burn to a caller.
--
-- WHAT WAS WRONG. `billing_ledger` is a chain: every row records the balance on
-- both sides of itself, and §11.13's second reconciliation question walks the
-- rows and checks that each one opens where the one before it closed. The walk
-- needs an order, and the order it uses is `created_at` — which 81 had just
-- changed from `now()` (frozen per transaction, so two entries written by one
-- call shared a stamp) to `clock_timestamp()` (read per statement).
--
-- That fix was right and it was not enough, because `clock_timestamp()` is only
-- as fine-grained as the platform's clock. PostgreSQL gives microseconds; the
-- WASM build the test suite runs on gives milliseconds, and measured here, two
-- consecutive statements land in the same millisecond more often than not. On a
-- tie the walk falls back to `id`, which is `gen_random_uuid()` — a coin toss —
-- and one toss in two puts two entries in the wrong order and reports a break
-- that is not there. It is a false alarm on the founder's daily screen and a
-- suite that is red one run in eight, and both of them are worse than they
-- sound: a reconciliation that cries wolf is a reconciliation nobody reads.
--
-- THE FIX IS TO MAKE THE STAMP AN ORDER RATHER THAN A CLOCK READING. The ledger
-- already takes a per-centre advisory lock before it writes anything (section 4
-- of 78, and the same lock `settle_billing` closes over), so within one centre
-- the audit of inserts is total and the maximum stamp is stable under the lock.
-- Every entry now takes `greatest(clock_timestamp(), max(created_at) + 1µs)`:
-- the wall clock while it is ahead, and a hair past the newest row when two
-- statements share a tick. Two inserts in one millisecond are one microsecond
-- apart, which is all an ordering key needs to be.
--
-- WHY A TIMESTAMP AND NOT A SEQUENCE COLUMN, given an identity column is the
-- obvious shape. Because the order is already published: the centre's history
-- screen (§11.12) and this walk both sort by `created_at`, the column carries a
-- `desc` index for exactly that, and a second ordering key would have to be kept
-- in step with the first. One key, made honest.
--
-- CROSS-CENTRE TIES ARE HARMLESS AND STAY POSSIBLE. The lock is per centre, so
-- two centres writing at the same instant can still share a stamp — and neither
-- the walk nor the history screen ever compares across centres, which is the
-- same reason `coaching_center_id` leads the index. The only cost is a stamp
-- nudged a microsecond forward of the wall clock, which at two entries a day for
-- fifty centres is invisible and is bounded by the lock's own serialisation.
--
-- EXISTING ROWS ARE LEFT ALONE. Their stamps are what they were written with,
-- which is what the founder's history says today; re-stamping them would be
-- rewriting an audit to make a query easier. A tie among rows written before
-- this migration is a tie among rows written before it.
-- ---------------------------------------------------------------------------

create or replace function app.ledger_open_balance()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  running bigint;
begin
  -- The two balance columns are the ledger's own arithmetic and not a claim any caller
  -- may make. Refused rather than overwritten: a caller that supplied a figure believed
  -- something, and silently replacing it leaves that belief unexamined somewhere in the
  -- code that wrote it.
  if new.balance_before is not null or new.balance_after is not null then
    raise exception
      'balance_before and balance_after are computed from the ledger and cannot be '
      'supplied by %', current_user
      using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('billing_ledger.balance'),
    pg_catalog.hashtext(new.coaching_center_id::text)
  );

  -- THE STAMP, TAKEN UNDER THAT LOCK. `greatest` ignores a null, so the very first
  -- entry in the table — where the maximum is null — is stamped with the clock and
  -- nothing else. The column's own default stays `clock_timestamp()` (81); this
  -- assignment is what makes it an order, and taking it here rather than in a default
  -- is what lets it read the table.
  new.created_at := greatest(
    pg_catalog.clock_timestamp(),
    (select pg_catalog.max(l.created_at) + interval '1 microsecond'
       from public.billing_ledger l)
  );

  -- `coalesce` and `greatest` are unqualified, unlike every real function call: they are
  -- SQL syntax the parser resolves, not entries in pg_catalog, so `pg_catalog.coalesce`
  -- is an error rather than a precaution. The empty search_path does not reach them.
  select coalesce(pg_catalog.sum(l.amount_poisha), 0)
    into running
    from public.billing_ledger l
   where l.coaching_center_id = new.coaching_center_id;

  new.balance_before := running;
  new.balance_after := running + new.amount_poisha;

  return new;
end;
$$;

comment on function app.ledger_open_balance() is
  'BEFORE INSERT on public.billing_ledger: fills balance_before and balance_after from '
  'sum(amount_poisha) for the centre, under a per-centre advisory lock held to commit, '
  'and stamps created_at strictly ahead of every row already in the table, so the chain '
  'has one order and two entries written in the same clock tick can still be walked. '
  'Refuses an insert that tries to supply either balance.';

revoke all on function app.ledger_open_balance() from public, anon, authenticated;
