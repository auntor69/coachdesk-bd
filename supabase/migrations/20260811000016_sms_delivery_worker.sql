-- CoachDesk BD — the queue that actually drains.
--
-- Everything upstream of this file has been right for a while: `sendResultSms`
-- writes a dispatch row, debits credits by compare-and-swap, writes the ledger,
-- and queues one `sms_logs` row per parent. And then nothing. Every message this
-- product has ever "sent" is still sitting at status 'queued', which the settings
-- screen says out loud, because the alternative — telling a teacher পাঠানো হয়েছে
-- while nothing left the building — is the worst bug this product could have.
--
-- This is the other end. A worker claims a batch, hands each message to the
-- gateway, and records what happened. The five functions here are the whole of
-- the queue discipline, and they are in SQL rather than in the worker for the
-- usual reason: every one of them is a decision about money or about a promise
-- made to a parent, and a decision like that should not be a JavaScript `if` that
-- runs after two awaits and might not run at all.
--
-- WHAT THE WORKER MAY NOT DO, and therefore what is enforced here:
--
--   * send the same message twice. Claiming moves rows to 'sending' in one
--     statement with `for update skip locked`, so two overlapping cron ticks
--     cannot both take the same row — the second finds nothing.
--   * charge for a message that never went. A message that has run out of
--     attempts, or that must not be sent at all, gives its credits back and says
--     so in the ledger. In the same transaction that gives up on it.
--   * send to a parent who has been taken off the list since the message was
--     queued. The opt-out switch on the settings screen promises the student's
--     own switch "wins over everything"; a message already in the queue is not an
--     exception the owner would expect.
--   * retry for ever, or retry instantly. Three attempts, with a widening gap, so
--     a gateway that is down for a minute does not burn a centre's whole queue.
--
-- All five are granted to `service_role` and to nobody else. A browser session
-- that could call `finish_sms` could mark a message delivered that never went, or
-- refund itself credits one row at a time; a browser session that could call
-- `claim_sms_batch` could take a centre's queue and drop it on the floor. These
-- are the server's, like every other row in this product that moves money.

-- ---------------------------------------------------------------------------
-- 1. What a row needs to remember between attempts.
-- ---------------------------------------------------------------------------

alter table public.sms_logs
  -- How many times the gateway has been asked about this message. Incremented by
  -- the claim rather than by the result, so a worker that dies mid-send still
  -- counts as having tried — otherwise a message that crashes the worker every
  -- time is retried until the end of the world.
  add column if not exists attempts smallint not null default 0,
  -- When the current attempt started. This is what makes a strand detectable: a
  -- serverless function that hits its wall-clock limit leaves a row in 'sending'
  -- with nobody coming back for it, and without a timestamp that row is
  -- indistinguishable from one being sent right now.
  add column if not exists claimed_at timestamptz,
  -- Not before this. A failed attempt sets it forward, so the next tick leaves
  -- the row alone instead of spending attempt two nine hundred milliseconds after
  -- attempt one — which is three attempts against a gateway that was rebooting.
  add column if not exists retry_after timestamptz;

-- The claim's index. The old one covered `status = 'queued'` alone; the claim now
-- also orders by queued_at and filters on retry_after, and a queue scan that
-- sorts is a queue scan that gets slower every month the centre stays.
drop index if exists sms_logs_pending_idx;

create index if not exists sms_logs_claimable_idx
  on public.sms_logs (queued_at)
  where status = 'queued';

-- Finding strands. Small and partial, because 'sending' is where rows spend
-- milliseconds and the index is only ever read to prove it is empty.
create index if not exists sms_logs_sending_idx
  on public.sms_logs (claimed_at)
  where status = 'sending';

-- ---------------------------------------------------------------------------
-- 2. Giving the credits back.
--
-- In `app` rather than `public`, so PostgREST cannot see it: this is the half of
-- a decision, not a decision, and a caller who could refund without failing the
-- message could refund the same message all night.
--
-- The centre is credited and the ledger row is written in one statement pair
-- inside the caller's transaction, so a refund that happens without a ledger
-- entry — the one thing that would make the balance unexplainable — is not a
-- state this can reach.
--
-- SECURITY INVOKER, like everything else here. The billing guard trigger on
-- coaching_centers checks `current_user` against a list that includes
-- service_role, and a DEFINER function would make that check read the function
-- owner instead, which is the same as switching it off.
-- ---------------------------------------------------------------------------

create or replace function app.refund_sms(p_log_id uuid, p_reason text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_center uuid;
  v_cost   integer;
  v_after  integer;
begin
  select coaching_center_id, credit_cost
    into v_center, v_cost
    from public.sms_logs
   where id = p_log_id;

  -- No row, or a message that cost nothing. Nothing to give back, and a ledger
  -- entry with delta 0 would fail the table's own check constraint.
  if v_center is null or coalesce(v_cost, 0) = 0 then
    return;
  end if;

  update public.coaching_centers
     set sms_credit_balance = sms_credit_balance + v_cost
   where id = v_center
  returning sms_credit_balance into v_after;

  insert into public.sms_credit_ledger
    (coaching_center_id, delta, reason, balance_after)
  values
    -- The log id is in the reason, not just the kind, because the question an
    -- owner asks about a refund is "which message" — and unlike a dispatch, a
    -- single failed row has no other name.
    (v_center, v_cost, p_reason || ':' || p_log_id::text, coalesce(v_after, 0));
end;
$$;

comment on function app.refund_sms(uuid, text) is
  'Credits one sms_logs row''s cost back to its centre and records it in the '
  'ledger. Internal: callers must also be settling the message itself.';

-- ---------------------------------------------------------------------------
-- 3. Cancelling what must not be sent.
--
-- Run before every claim rather than at queue time, because the interesting case
-- is the gap: a message is approved and paid for at 9:02, a guardian rings at
-- 9:04 asking to be taken off the list, the owner flips the switch, and the
-- worker's next tick is at 9:05. The settings screen promises that switch wins
-- over everything. A queue is not an exception an owner would think to ask about.
--
-- 'cancelled' has been in the sms_status enum since the first migration with
-- nothing ever writing it. This is what it was for.
-- ---------------------------------------------------------------------------

create or replace function public.cancel_opted_out_sms()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id    uuid;
  v_count integer := 0;
begin
  for v_id in
    select l.id
      from public.sms_logs l
     where l.status = 'queued'
       and (
         -- The student's own switch, then the guardian's, which is the same order
         -- of authority planResultSms uses when it decides whom to queue at all.
         --
         -- A null id — the student or guardian row was deleted after the message
         -- was queued — matches neither, so the message stands. That is the
         -- honest answer: with the row gone there is no opt-out to read, and
         -- refusing to send because a record is missing would silently drop
         -- messages a centre had paid for.
         exists (
           select 1 from public.students s
            where s.id = l.student_id and s.sms_opt_out
         )
         or exists (
           select 1 from public.guardians g
            where g.id = l.guardian_id and g.sms_opt_out
         )
       )
     for update skip locked
  loop
    update public.sms_logs
       set status = 'cancelled',
           error = 'opted out after queueing',
           claimed_at = null,
           retry_after = null
     where id = v_id;

    -- Paid for, not sent, so not charged. The owner turning the switch off is not
    -- a mistake they should be billed for.
    perform app.refund_sms(v_id, 'refund:opted_out');
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

comment on function public.cancel_opted_out_sms() is
  'Cancels and refunds queued messages whose student or guardian has opted out '
  'since the message was queued. Returns how many. Server-only.';

-- ---------------------------------------------------------------------------
-- 4. Settling one message.
--
-- The only place a message leaves 'sending', and the only place a message is
-- given up on. Both halves of the failure path — the status and the refund — are
-- one call, so there is no ordering for a worker to get wrong and no crash that
-- can land between them.
--
-- MAX_ATTEMPTS lives here and nowhere else, the same rule the risk view follows:
-- a copy of the number in TypeScript would drift, and the copy that drifted would
-- be the one deciding whether a parent hears anything.
-- ---------------------------------------------------------------------------

create or replace function public.finish_sms(
  p_id    uuid,
  p_ok    boolean,
  p_ref   text default null,
  p_error text default null
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  -- Three. A gateway either takes a message or has something wrong with it, and
  -- the third refusal is information rather than bad luck. Higher would mean a
  -- badly-formed number sitting in the queue for an hour of cron ticks.
  c_max_attempts constant smallint := 3;
  v_attempts smallint;
  v_status   public.sms_status;
begin
  select attempts, status into v_attempts, v_status
    from public.sms_logs
   where id = p_id
     for update;

  -- Already settled, or never claimed. Returning rather than raising because the
  -- caller is a worker that may be retrying its own bookkeeping, and a duplicate
  -- finish must be a no-op instead of a 500 that strands the rest of the batch.
  if v_status is null or v_status <> 'sending' then
    return coalesce(v_status::text, 'missing');
  end if;

  if p_ok then
    update public.sms_logs
       set status = 'sent',
           sent_at = now(),
           provider_ref = p_ref,
           -- Cleared, so a row that failed twice and then went through does not
           -- keep the old complaint next to a successful send.
           error = null,
           claimed_at = null,
           retry_after = null
     where id = p_id;
    return 'sent';
  end if;

  if v_attempts < c_max_attempts then
    update public.sms_logs
       set status = 'queued',
           error = p_error,
           claimed_at = null,
           -- Widening gap: five minutes after the first failure, ten after the
           -- second. Nothing clever, just enough that three attempts cannot all
           -- land inside one gateway restart.
           retry_after = now() + (v_attempts * interval '5 minutes')
     where id = p_id;
    return 'queued';
  end if;

  update public.sms_logs
     set status = 'failed',
         error = p_error,
         claimed_at = null,
         retry_after = null
   where id = p_id;

  -- Out of attempts, so nothing will ever be delivered for this row. A centre
  -- that loses credits to a gateway we chose will not trust the counter again.
  perform app.refund_sms(p_id, 'refund:failed');
  return 'failed';
end;
$$;

comment on function public.finish_sms(uuid, boolean, text, text) is
  'Records the outcome of one send attempt: sent, re-queued with a backoff, or '
  'failed and refunded once out of attempts. Returns the new status. '
  'Server-only.';

-- ---------------------------------------------------------------------------
-- 5. Rows nobody is coming back for.
--
-- A serverless function has a wall clock. When it runs out mid-send the row stays
-- in 'sending' for ever, which is worse than a failure: it is invisible on the
-- settings screen — not queued, not sent, not failed — and it holds credits the
-- centre has paid.
--
-- Delegates to finish_sms rather than deciding for itself, so a strand is settled
-- by exactly the code path a refusal is, refund and all. Delivery is therefore
-- at-least-once: a message whose worker died after the gateway accepted it will
-- be sent again. That is the deliberate side to be on. The centre is not charged
-- twice — credits were debited at queue time, and this path spends none — so the
-- choice is between a parent occasionally seeing a result twice and a parent
-- sometimes never hearing it at all, and the second is the failure this product
-- cannot have.
-- ---------------------------------------------------------------------------

create or replace function public.reap_stranded_sms()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  -- Ten minutes. Comfortably longer than any single send can take — the worker
  -- claims a batch it can finish inside a serverless timeout, which is seconds —
  -- and short enough that a strand is cleared on the next tick rather than the
  -- next day.
  c_strand_after constant interval := interval '10 minutes';
  v_id    uuid;
  v_count integer := 0;
begin
  for v_id in
    select id
      from public.sms_logs
     where status = 'sending'
       and claimed_at < now() - c_strand_after
     for update skip locked
  loop
    -- Deliberately not marked 'failed' directly: below MAX_ATTEMPTS this returns
    -- the row to the queue, which is the whole point.
    perform public.finish_sms(v_id, false, null, 'worker stopped mid-send');
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

comment on function public.reap_stranded_sms() is
  'Returns messages left in ''sending'' by a worker that died to the queue, or '
  'fails and refunds them if out of attempts. Returns how many. Server-only.';

-- ---------------------------------------------------------------------------
-- 6. Taking work.
--
-- `for update skip locked` is the whole reason this is a function and not a
-- PostgREST call: it is what makes two workers running at the same instant
-- divide the queue instead of duplicating it, and there is no way to say it in a
-- URL. Everything else here — the ordering, the cap, the attempt increment — is
-- in the same statement because a claim that is not atomic is not a claim.
--
-- No centre filter, and that is not an oversight. This is the one query in the
-- product that is deliberately cross-tenant: it drains a queue whose rows each
-- carry the centre they belong to, and it never joins two centres' rows together
-- or lets one centre's message be sent under another's sender ID. Runs as
-- service_role, which is not a tenant.
-- ---------------------------------------------------------------------------

create or replace function public.claim_sms_batch(p_limit integer default 20)
returns table (
  id       uuid,
  to_phone text,
  body     text,
  attempts smallint
)
language sql
security invoker
set search_path = ''
as $$
  update public.sms_logs l
     set status = 'sending',
         claimed_at = now(),
         attempts = l.attempts + 1
   where l.id in (
     select c.id
       from public.sms_logs c
      where c.status = 'queued'
        -- A row waiting out a backoff is not claimable yet. `is null` covers
        -- every row that has never failed, which is nearly all of them.
        and (c.retry_after is null or c.retry_after <= now())
      -- Oldest first, so a centre that queued forty messages this morning is
      -- served before one that queued two this minute. Fairness between centres
      -- is not attempted: with one cron draining everything, arrival order is the
      -- only ordering nobody can argue with.
      --
      -- This decides WHICH rows are taken, not the order `returning` hands them
      -- back in — an UPDATE emits rows in whatever order it touched them. Do not
      -- build anything on the returned sequence; the worker does not.
      order by c.queued_at
      -- Clamped rather than trusted. The caller is our own worker, but the cap
      -- exists to keep a batch inside a serverless function's wall clock, and a
      -- limit that can be passed as 5000 is not a cap.
      limit greatest(1, least(coalesce(p_limit, 20), 100))
      for update skip locked
   )
  returning l.id, l.to_phone, l.body, l.attempts;
$$;

comment on function public.claim_sms_batch(integer) is
  'Atomically claims up to p_limit queued messages (capped at 100), moving them '
  'to ''sending'' so concurrent workers cannot double-send. Server-only.';

-- ---------------------------------------------------------------------------
-- 7. Who may call these.
--
-- PostgREST exposes every function in `public` at POST /rest/v1/rpc/<name>, and
-- these are the three most dangerous functions in the schema: `finish_sms` marks
-- a message sent, and `finish_sms`/`cancel_opted_out_sms` credit a balance that a
-- signed-in owner cannot otherwise touch by a single taka. `sms_logs` has no
-- client-writable policy at all, precisely so that nothing holding a cookie can
-- claim a message reached a handset. An RPC would walk straight past that.
--
-- SECURITY INVOKER does not save them either, which is the trap: `service_role`
-- is the only role these are granted to, so an invoker function called by an
-- `authenticated` request would fail on the table policies — but only after the
-- refund had been attempted, and only as long as those policies stay as they are.
-- The grant is the fence. The body's checks are what stands behind it.
--
-- REVOKED FROM `anon` AND `authenticated` BY NAME, not just from PUBLIC.
-- 20260811000010 is the migration that learned this the hard way: Supabase ships
--
--   alter default privileges for role postgres in schema public
--     grant all on functions to postgres, anon, authenticated, service_role;
--
-- so at the instant a function in `public` is created, both browser-facing roles
-- are handed EXECUTE explicitly. PUBLIC is a different grantee and revoking it
-- leaves those two standing — which means the obvious three-line idiom
-- (`revoke all … from public; grant execute … to service_role;`) reads like a
-- closed door and is not one. `app.refund_sms` gets the same treatment for
-- symmetry rather than necessity: those default privileges name `schema public`,
-- and `app` is not in PostgREST's exposed schemas at all.
--
-- Not granted to `authenticated` at any point. There is no screen that should
-- call these, and the day one needs to it will go through a Server Action holding
-- the admin client — the way every other write to the money path already does.
-- ---------------------------------------------------------------------------

revoke all on function public.claim_sms_batch(integer) from anon, authenticated, public;
revoke all on function public.finish_sms(uuid, boolean, text, text) from anon, authenticated, public;
revoke all on function public.cancel_opted_out_sms() from anon, authenticated, public;
revoke all on function public.reap_stranded_sms() from anon, authenticated, public;
revoke all on function app.refund_sms(uuid, text) from anon, authenticated, public;

grant execute on function public.claim_sms_batch(integer) to service_role;
grant execute on function public.finish_sms(uuid, boolean, text, text) to service_role;
grant execute on function public.cancel_opted_out_sms() to service_role;
grant execute on function public.reap_stranded_sms() to service_role;
grant execute on function app.refund_sms(uuid, text) to service_role;
