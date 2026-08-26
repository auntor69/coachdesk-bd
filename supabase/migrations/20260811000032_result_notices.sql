-- ---------------------------------------------------------------------------
-- Telling a parent their child's result, from the owner's own phone.
--
-- THE DEAD END THIS CLOSES. `sms_credit_balance` defaults to 0, every tier in
-- src/lib/plans.ts grants `monthlySmsCredits: 0`, there is no top-up screen
-- anywhere in the product, and the founder panel can read a balance but not
-- write one. So the balance is 0 for every centre on every plan, permanently —
-- and the result gate disables its send button whenever `creditCost > balance`.
-- The one screen in the app whose whole job is telling forty families how their
-- children did has been unable to tell anybody, for anyone, since it was built.
--
-- None of that is a bug in the credit system. There is no BTRC-registered sender
-- ID, so there is no aggregator account, so there is no gateway for a metered
-- message to leave through; a non-zero allowance would be a counter decrementing
-- against nothing. The metering, the ledger and the refund path are correct and
-- stay exactly as they are for the day a gateway exists.
--
-- The bug is that results were the only message in this product with no second
-- way out. Fee reminders reach a family today, through a prefilled `sms:` or
-- `wa.me` link on the owner's own handset, recorded in `fee_reminders`. The
-- weekly progress note reaches them the same way, recorded in
-- `progress_updates`. Marks had a queue and nothing else. This table is the
-- third of those three, so the answer to "can this centre tell a parent
-- anything" stops depending on which screen they are standing on.
--
-- NOT A SECOND SEND PATH FOR THE SAME MESSAGE. `sms_logs` holds messages the
-- platform owes a parent and has not yet delivered; a row here is a note that
-- somebody at the centre already handed the message to their own phone. One is a
-- promise, the other is a receipt, and a single table trying to be both would
-- have every query start by asking which kind of row it had found.
--
-- NOT progress_updates either, for the reason that table gives about
-- fee_reminders: its rows are keyed to a seven-day window and carry no exam,
-- while these are keyed to one exam and one student and mean nothing without it.
-- A nullable exam_id and a nullable window on one table is two features wearing
-- one name.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Whether the caller may send a family a message at all
--
-- `teacher_permissions.can_send_sms` has gated the result queue in the app layer
-- since the gate was written — `canSendSms` in lib/auth/session — and has never
-- had a database half, because the queue is written by the service role and
-- never by a browser session. The table below IS written by a browser session,
-- by whoever tapped the chip, so the permission needs to exist in SQL too or the
-- policy would have to be "any staff admin", which is narrower than the button
-- the owner already ticks.
--
-- ABSENT MEANS ALLOWED, exactly as app.can_manage_exams reads it and for the
-- same reason in the same data: the column defaults to true, and
-- `bootstrap_center` gives the owner's own teacher row no permissions row at
-- all. Reading that absence as "may do nothing" would stop an owner messaging
-- the parents of the batch they teach themselves on the day they signed up. So
-- this denies only on an explicit false — and an explicit false is the owner
-- saying so, which is the one answer that should win.
-- ---------------------------------------------------------------------------

create or replace function app.can_send_sms(center uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from public.teacher_permissions tp
    join public.teachers t
      on t.id = tp.teacher_id
     and t.coaching_center_id = tp.coaching_center_id
    where t.user_id = auth.uid()
      and t.coaching_center_id = center
      and not tp.can_send_sms
  );
$$;

grant execute on function app.can_send_sms(uuid) to authenticated, service_role;

comment on function app.can_send_sms(uuid) is
  'False when a teacher_permissions row for the caller at `center` has '
  'can_send_sms off. No row means allowed, as with can_manage_exams — the column '
  'defaults to true and an owner bootstrapped by bootstrap_center has no row. '
  'Says nothing about which students; pair it with app.teaches_batch.';

-- ---------------------------------------------------------------------------
-- The record of having told one family about one exam.
--
-- Keyed to the pair, because that is the question the screen asks: an owner
-- working down forty names after evening batch needs to know which parents they
-- already messaged before the power cut, and both failure modes cost them
-- something real. Message twice and a parent who was pleased the first time
-- reads the second as spam from a number they cannot reply to. Miss one and the
-- child whose marks dropped is exactly the family that heard nothing.
--
-- The body is frozen rather than rebuilt, the same call fee_reminders makes about
-- its amount and progress_updates about its window: this row answers "what did I
-- tell them", and a message regenerated at read time could describe marks that
-- were corrected an hour later. What was said is not what is now true, and only
-- one of those is a record.
-- ---------------------------------------------------------------------------

create table result_notices (
  id           uuid primary key default gen_random_uuid(),
  coaching_center_id uuid not null references coaching_centers (id) on delete cascade,
  exam_id      uuid not null,
  student_id   uuid not null,
  channel      outreach_channel not null,
  -- E.164, because a guardian's number gets corrected and "we messaged the old
  -- one" is the answer for a family insisting nobody told them anything.
  to_phone     text,
  -- The exact text put in front of whoever tapped, so a complaint about wording
  -- is answered from a record instead of a recollection. Null for a call.
  body         text,
  sent_by      uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),

  -- Composite, per the invariant 20260811000005 established and
  -- check-migrations.mjs enforces: a reference from one tenant table to another
  -- carries coaching_center_id, so a row cannot cite another centre's exam or
  -- student while still passing its own RLS check.
  constraint result_notices_exam_id_center_fkey
    foreign key (exam_id, coaching_center_id)
    references exams (id, coaching_center_id) on delete cascade,
  constraint result_notices_student_id_center_fkey
    foreign key (student_id, coaching_center_id)
    references students (id, coaching_center_id) on delete cascade
);

-- The screen's question, asked once per row of the marks sheet: has this family
-- been told about this exam. Newest first, so the answer is the first tuple.
create index result_notices_exam_idx
  on result_notices (exam_id, student_id, created_at desc);
create index result_notices_center_idx
  on result_notices (coaching_center_id, created_at desc);

comment on table result_notices is
  'Result messages the centre sent from their own phone (prefilled SMS/WhatsApp '
  'deep link, or a call), one row per family per send, with the text frozen on '
  'it. Not a send queue — see sms_logs for messages the platform owes a parent.';

alter table result_notices enable row level security;

-- ---------------------------------------------------------------------------
-- Owners and managers always; a teacher for the batches they teach, if permitted.
--
-- Wider than progress_updates and fee_reminders, deliberately. Those two are
-- about money and about a centre-wide weekly rhythm, both of which belong to
-- whoever runs the place. This one is about a test a teacher set, marked, and is
-- standing in front of the class that sat — and the app has said so since the
-- gate was built, because `canSendSms` lets a permitted teacher use it. A policy
-- restricted to staff admins here would have made the chip below fail silently
-- for exactly the person most likely to tap it.
--
-- Scoped through the exam's batch, which is the shape every teacher policy on
-- this feature already uses — see exam_results_teacher_insert. `teaches_batch`
-- answers "is the caller a teacher of this batch" on its own, so no role test is
-- needed beside it, and a teacher who was never given the batch matches nothing
-- here whatever their permissions row says.
--
-- Read is narrowed the same way but without the permission, exactly as
-- exam_results_teacher_read is: a teacher whose owner unticked "send SMS" still
-- needs to see that the parents were told, because they are the one the parent
-- will ask about it. Reading is not sending.
--
-- No self-read for the family, the same call the other two tables made: a tally
-- of how promptly a centre passed on marks is a working note about the centre's
-- own diligence, and a parent reading it learns something true that helps nobody.
-- ---------------------------------------------------------------------------

create policy result_notices_staff_admin on result_notices
  for all to authenticated
  using (app.is_staff_admin(coaching_center_id))
  with check (app.is_staff_admin(coaching_center_id));

create policy result_notices_teacher_read on result_notices
  for select to authenticated
  using (
    exam_id in (select x.id from exams x where app.teaches_batch(x.batch_id))
  );

create policy result_notices_teacher_insert on result_notices
  for insert to authenticated
  with check (
    exam_id in (select x.id from exams x where app.teaches_batch(x.batch_id))
    and app.can_send_sms(coaching_center_id)
  );
