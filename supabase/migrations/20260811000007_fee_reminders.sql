-- CoachDesk BD — the record of having chased a fee.
--
-- The fee board can say who is late. It cannot yet say who has been *asked*, and
-- that is the more useful of the two facts. An owner working down twenty overdue
-- rows on a Thursday needs to know which parents they already messaged on Monday,
-- because the two failure modes are symmetrical and both cost them: message the
-- same family three times and they stop reading; skip one and the money never
-- arrives. A paper register at least had the phone number written next to the
-- name. This table is what lets the screen beat the register.
--
-- WHY NOT sms_logs, which already exists and already stores a body and a phone:
--
-- Because nothing here is sent by us. There is no SMS gateway yet — sender IDs
-- in Bangladesh go through a BTRC-approved aggregator and need the owner's NID,
-- which is a real-world errand no amount of code shortens — so the reminder a
-- centre can send *tonight* is one that opens their own SMS or WhatsApp app with
-- the message already written, from their own number, at their own cost of zero.
--
-- Recording that in sms_logs would be wrong three ways. Its `status` enum is
-- queued/sent/delivered/failed/cancelled and none of those describes "handed to
-- the owner's handset"; `sms_logs_pending_idx` exists so a delivery worker can
-- drain rows with status 'queued', and these must never appear in that queue;
-- and every row there carries a credit_cost that bills the centre for a message
-- the platform did not send. A table whose meaning is "we owe the parent a
-- message" cannot also mean "the owner already sent one themselves".
--
-- It is also the shape the automated reminder needs later. When the aggregator is
-- live and a Cloudflare cron sends at due−3, due, and due+7, the thing it must
-- check first is when this invoice was last mentioned to this family — by the
-- worker or by a human. That is one query against this table, and it is the same
-- query the board already runs.

-- ---------------------------------------------------------------------------
-- Channels are how the owner reached the parent, not what we transmitted.
--
-- 'sms' and 'whatsapp' both mean a prefilled deep link the owner tapped; 'call'
-- means they dialled. A call is worth recording precisely because it often does
-- not connect — "rang twice, no answer" is why they should try WhatsApp next,
-- and without it the board would show an unchased row that has been chased.
--
-- No 'auto_sms' value yet. It would be the honest name for a gateway send, and
-- adding it is one ALTER TYPE when a gateway exists; inventing it now would put
-- a value in the schema that no code can produce and no reader can interpret.
-- ---------------------------------------------------------------------------

create type fee_reminder_channel as enum ('sms', 'whatsapp', 'call');

create table fee_reminders (
  id           uuid primary key default gen_random_uuid(),
  coaching_center_id uuid not null references coaching_centers (id) on delete cascade,
  invoice_id   uuid not null,
  channel      fee_reminder_channel not null,
  -- What was owed at the moment of asking, frozen.
  --
  -- Not derivable afterwards and not the same as the invoice's balance today: a
  -- parent who is told ৳700 and then gets a ৳200 discount will ask why the
  -- message said 700, and the answer has to be a record rather than a
  -- recollection. numeric(10, 2) for the same reason as every other money column
  -- here — the arithmetic that produced it was exact and storing it as a float
  -- would be the one lossy step in the chain.
  amount_bdt   numeric(10, 2) not null,
  -- The number as it was dialled or messaged, E.164, because a guardian's number
  -- gets corrected and "we told the old number" is the explanation for a family
  -- that swears nobody contacted them.
  to_phone     text,
  -- The exact text put in front of the owner. Kept so a complaint about wording
  -- can be answered, and so a future template change is visibly a change.
  body         text,
  sent_by      uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),

  -- Composite, per the invariant 20260811000005 established and
  -- check-migrations.mjs enforces: a reference from one tenant table to another
  -- carries coaching_center_id, so a row cannot cite an invoice belonging to a
  -- different centre while still passing its own RLS check.
  constraint fee_reminders_invoice_id_center_fkey
    foreign key (invoice_id, coaching_center_id)
    references fee_invoices (id, coaching_center_id) on delete cascade
);

-- The board's question, asked once per render for every row on it: when was this
-- invoice last mentioned to the family. Descending so the answer is the first
-- tuple the index yields.
create index fee_reminders_invoice_idx on fee_reminders (invoice_id, created_at desc);
create index fee_reminders_center_idx
  on fee_reminders (coaching_center_id, created_at desc);

comment on table fee_reminders is
  'Fee chases the centre made from their own phone (prefilled SMS/WhatsApp deep '
  'link, or a call). Not a send queue — see sms_logs for messages the platform '
  'owes a parent.';

alter table fee_reminders enable row level security;

-- ---------------------------------------------------------------------------
-- Owners and managers, and nobody else.
--
-- Deliberately no self-read policy for families, unlike fee_invoices and
-- fee_payments where a parent seeing their own bill and their own receipts is the
-- point. "This centre messaged you about money three times in October" is the
-- centre's own working note, and a parent reading a tally of how often they were
-- chased learns nothing they need and something that only strains the
-- relationship the reminder was trying to protect.
--
-- Teachers are excluded for the same reason they cannot record a payment: a
-- can_view_fees teacher may read the board, but who has been chased for money is
-- the owner's business with that family.
-- ---------------------------------------------------------------------------

create policy fee_reminders_staff_admin on fee_reminders
  for all to authenticated
  using (app.is_staff_admin(coaching_center_id))
  with check (app.is_staff_admin(coaching_center_id));
