-- ---------------------------------------------------------------------------
-- Telling a parent their child did not turn up, on the day it happened.
--
-- THE GAP THIS CLOSES. Attendance is the first thing a centre does every day and
-- the reason the product gets opened at all — MASTERPLAN calls it the hook, and
-- everything else here is built on the habit. A teacher taps down forty names,
-- twelve of them absent, saves, and the register is correct. Then nothing
-- happens. The parents of those twelve children find out at the end of the month
-- from an attendance percentage on a report, if they see one.
--
-- That is the single most valuable message this product can carry and it was the
-- one message it could not send. A guardian who learns at six in the evening that
-- their child never reached the four o'clock batch can do something about it that
-- evening; the same fact a month later is a statistic. Owners in this market
-- already do this by hand, from their own phone, one child at a time, off a
-- paper register — which is exactly the work the roster screen had just finished
-- and then threw away.
--
-- THE THIRD OF THE SAME THREE, again. fee_reminders, progress_updates and
-- result_notices each record that somebody at the centre put a message in front
-- of a family from their own handset. This is that table for a missed class, and
-- it exists for the reason the other three do: the screen has to be able to
-- answer "which of these parents have I already rung" halfway down the list,
-- after a power cut, from a different phone, in a shared account.
--
-- KEYED TO (session, student) because that is the question. An attendance session
-- is one batch on one day, so the pair is one child and one missed class — and a
-- child absent on Sunday and again on Tuesday is two facts a parent is owed
-- separately, not one row updated twice.
--
-- ABSENT ONLY, not late. A late child arrived, and "your son was twenty minutes
-- late" is a different message with a different tone that no parent needs the
-- same evening. Lateness is on the register and in the attendance rate, where an
-- owner can see a pattern and raise it in person. Nothing here reads
-- attendance_records.status, so widening this later is a change to one query on
-- the screen and not to this table.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- The record of having told one family about one missed class.
--
-- The body is frozen on the row rather than rebuilt at read time, the same call
-- the other three logs make: this answers "what did I tell them", and a message
-- regenerated later could describe a register a teacher corrected an hour after
-- the send. What was said is not what is now true, and only one of those is a
-- record.
-- ---------------------------------------------------------------------------

create table absence_notices (
  id           uuid primary key default gen_random_uuid(),
  coaching_center_id uuid not null references coaching_centers (id) on delete cascade,
  session_id   uuid not null,
  student_id   uuid not null,
  channel      outreach_channel not null,
  -- E.164, because a guardian's number gets corrected and "we messaged the old
  -- one" is the answer for a family insisting nobody told them anything.
  to_phone     text,
  -- The exact text put in front of whoever tapped. Null for a call.
  body         text,
  sent_by      uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),

  -- Composite, per the invariant 20260811000005 established and
  -- check-migrations.mjs enforces: a reference from one tenant table to another
  -- carries coaching_center_id, so a row cannot cite another centre's register or
  -- student while still passing its own RLS check.
  constraint absence_notices_session_id_center_fkey
    foreign key (session_id, coaching_center_id)
    references attendance_sessions (id, coaching_center_id) on delete cascade,
  constraint absence_notices_student_id_center_fkey
    foreign key (student_id, coaching_center_id)
    references students (id, coaching_center_id) on delete cascade
);

-- The screen's question, asked once per absent row of the register: has this
-- family been told about this class. Newest first, so the answer is the first
-- tuple the index yields.
create index absence_notices_session_idx
  on absence_notices (session_id, student_id, created_at desc);
create index absence_notices_center_idx
  on absence_notices (coaching_center_id, created_at desc);

comment on table absence_notices is
  'Missed-class messages the centre sent from their own phone (prefilled '
  'SMS/WhatsApp deep link, or a call), one row per family per send, with the '
  'text frozen on it. Not a send queue — see sms_logs for messages we owe.';

alter table absence_notices enable row level security;

-- ---------------------------------------------------------------------------
-- Owners and managers always; a teacher for the batches they teach, if permitted.
--
-- The same three policies result_notices carries, and reusing app.can_send_sms
-- rather than a second function of its own: whether somebody may message a
-- family is one permission the owner ticks once, and two functions reading one
-- column is how a screen ends up disagreeing with the box.
--
-- Wider than fee_reminders on purpose, and for a stronger reason than results
-- were. The teacher standing in the room is the only person who knows the child
-- is not in it. Restricting this to whoever runs the place would mean the fact
-- travels from the teacher to the owner and only then to the parent — which is
-- how a same-day message becomes a next-week one, and the same-day part is the
-- entire value.
--
-- Scoped through the register's batch, which is the shape every teacher policy on
-- attendance already uses. `teaches_batch` answers "is the caller a teacher of
-- this batch" on its own, so no role test is needed beside it, and a teacher who
-- was never given the batch matches nothing here whatever their permissions say.
--
-- Read is narrowed the same way but without the permission, exactly as
-- result_notices does it: a teacher whose owner unticked "send SMS" still needs
-- to see which parents were told, because they are the one the parent will ask
-- when they come to collect the child. Reading is not sending.
--
-- No self-read for the family, the same call the other three tables made. A
-- parent knows whether their phone rang; a tally of how promptly the centre got
-- round to ringing is a working note about the centre's own diligence.
-- ---------------------------------------------------------------------------

create policy absence_notices_staff_admin on absence_notices
  for all to authenticated
  using (app.is_staff_admin(coaching_center_id))
  with check (app.is_staff_admin(coaching_center_id));

create policy absence_notices_teacher_read on absence_notices
  for select to authenticated
  using (
    session_id in (
      select s.id from attendance_sessions s where app.teaches_batch(s.batch_id)
    )
  );

create policy absence_notices_teacher_insert on absence_notices
  for insert to authenticated
  with check (
    session_id in (
      select s.id from attendance_sessions s where app.teaches_batch(s.batch_id)
    )
    and app.can_send_sms(coaching_center_id)
  );
