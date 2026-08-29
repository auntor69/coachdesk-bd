-- Who did that.
--
-- MASTERPLAN.md §10:
--
--   "One append-only log of who did what, covering every action where the answer to
--   'who changed this?' has money or a child's record behind it: fee amount changes ·
--   payments recorded · payment voids and refunds · discounts and scholarships
--   granted · salary terms changed · salary paid · expenses recorded · permission
--   changes · login accounts created or deactivated · branch transfers · attendance
--   overrides · student status changes · capacity purchases · plan changes.
--
--   Each entry: actor, action, target, before, after, when. It is written by the same
--   transaction that made the change, so a change cannot exist without its log line.
--
--   The first serious support conversation this product has will be a centre owner
--   saying 'my manager says he never entered that'."
--
-- WRITTEN BY TRIGGERS, and that last sentence of §10 is the whole reason. A log the
-- application writes is a log the next code path forgets: one screen records a payment
-- and logs it, a month-close does not, and the gap is invisible until somebody needs
-- the line that was never written. 20260811000042 made this argument for transfer
-- history and 20260811000003 for profiles — "a trigger cannot be skipped" — and it is
-- strongest here, because the missing line is the line about an act somebody may want
-- missing. "A change cannot exist without its log line" is not a policy anybody can
-- follow by being careful; it is a property of where the INSERT lives.
--
-- So the browser cannot write this table at all, exactly as with student_transfers: no
-- insert, update or delete policy, and the privileges revoked besides. Every row here
-- is a side effect of a write that already had to pass its own table's policies.
--
-- WHAT AN "ACTION" IS, and this is the one place the schema declines to do what §10
-- literally says. §10 asks for an `action`, and "discount granted" is an action. But a
-- discount granted and a fee corrected are both an UPDATE of fee_invoices, and telling
-- them apart means a trigger that encodes what the business calls things. That trigger
-- is then the second place the product decides what a discount is, it drifts from the
-- first, and renaming anything means a migration and a backfill of rows that describe
-- events that already happened.
--
-- So the log records what it can be certain of — which table, which of insert, update
-- or delete, and exactly which values moved — and the screen in §16's step 18 names the
-- action from that. "Discount granted" is `entity = 'fee_invoices' and before ?
-- 'discount_bdt'`, computed where it can be corrected without touching history. A log
-- that records only mechanical truth cannot be wrong about it.
--
-- ONLY THE COLUMNS THAT MOVED, on an update. Storing both whole rows would double the
-- table and leave the reader to diff twenty columns to find the one that changed;
-- storing the diff means `before` and `after` are already the answer to "what
-- changed". Inserts and deletes carry the whole row, because there the whole row is
-- the change.
--
-- OWNER-ONLY ON READ, which breaks the `is_staff_admin` convention every other
-- administrative table follows, and there are two reasons rather than a preference.
-- The first is decisive: this log carries rows from `subscriptions` and `payments`,
-- and 20260811000002 restricted both of those to the owner in as many words — "a
-- branch manager runs their branch but never sees or changes what the center pays us".
-- A log readable by managers would be a way around that policy wearing the name of an
-- audit trail. The second is §10's own sentence: the question is "my manager says he
-- never entered that", and the manager is its subject.
--
-- ONE HOLE CLOSED WHILE WE ARE HERE. A row trigger does not fire for TRUNCATE, so
-- every table with TRUNCATE still granted to `authenticated` is a table this log has a
-- documented gap in. Eight migrations have closed it one table at a time; section 5
-- closes the rest of the schema in one statement.
--
-- WHAT IS NOT HERE. Attendance overrides, which §10 lists: there is no override marker
-- to log until §16's step 10 adds one, and a trigger on `attendance_records` today
-- would log every student on every day — the one shape of noise that makes a log go
-- unread. `enrollments` is left out for the same kind of reason and a weaker one: §10
-- does not list it and admission season would fill the log with it. `student_transfers`
-- is not audited because it *is* an audit record; logging it would say everything
-- twice. The screen is step 18.

-- ---------------------------------------------------------------------------
-- 1. The three things that can happen to a row.
--
-- Named for a reader rather than for SQL — 'created' and not 'INSERT' — because these
-- values end up in front of a centre owner, and because the mapping from `tg_op` is
-- then written down once, here, instead of assumed everywhere.
-- ---------------------------------------------------------------------------

create type public.audit_operation as enum ('created', 'updated', 'deleted');

-- ---------------------------------------------------------------------------
-- 2. The line.
-- ---------------------------------------------------------------------------

create table public.audit_log (
  id           uuid primary key default gen_random_uuid(),
  coaching_center_id uuid not null references public.coaching_centers (id) on delete cascade,

  -- WHO. Null is a real and common answer: a migration, the founder working in the SQL
  -- editor, or one of our own server writes. `actor_role` is what tells those apart
  -- from each other, so a null here is never mistaken for an unknown browser.
  actor        uuid references auth.users (id) on delete set null,
  actor_role   text,

  -- WHAT it happened to. `entity` is the table name and not an enum, because an enum
  -- would need `alter type` in every migration that audits a new table and — per
  -- 20260811000015 — a value added in one transaction cannot be used in it, so that
  -- migration would have to be two files. A text column costs a few bytes and never
  -- forces that.
  entity       text not null,
  entity_id    uuid,

  operation    public.audit_operation not null,

  -- The change. On an update these hold only the keys that differ, so `before` and
  -- `after` have the same key set and reading one against the other is the diff. On an
  -- insert `before` is null; on a delete `after` is null.
  before       jsonb,
  after        jsonb,

  -- WHEN, and `clock_timestamp()` rather than the `now()` every other table defaults
  -- to. Inside one transaction `now()` is a constant, so two lines from a single save
  -- would carry an identical timestamp and nothing would say which came first.
  -- `clock_timestamp()` advances, which makes the log orderable without a second
  -- column to order it by.
  created_at   timestamptz not null default clock_timestamp()
);

-- The log screen: this centre, newest first.
create index audit_log_center_idx
  on public.audit_log (coaching_center_id, created_at desc);

-- "Who has touched this invoice", which is the question §10's support conversation
-- actually asks — about one row, not about the centre.
create index audit_log_entity_idx
  on public.audit_log (coaching_center_id, entity, entity_id, created_at desc);

-- "What has this person been doing", for the other half of the same conversation.
-- Partial, because server writes leave this null and there are a lot of them.
create index audit_log_actor_idx
  on public.audit_log (coaching_center_id, actor, created_at desc)
  where actor is not null;

comment on table public.audit_log is
  'MASTERPLAN.md §10 — append-only record of who changed what, written by triggers in '
  'the same transaction as the change and unwritable from a browser. Owner-only on '
  'read, because it carries subscription and platform-payment rows that '
  '20260811000002 keeps from managers.';

comment on column public.audit_log.entity is
  'The table the change happened to. Text and not an enum, so auditing a new table '
  'needs no alter type and no second migration file.';

comment on column public.audit_log.actor_role is
  'The database role the write arrived as — authenticated, service_role, or null for '
  'a migration. Read from the `role` setting, not current_user, because the trigger '
  'is SECURITY DEFINER and current_user inside it is the owner.';

comment on column public.audit_log.before is
  'On an update, only the columns that changed. On a delete, the whole row. Null on '
  'an insert.';

comment on column public.audit_log.after is
  'On an update, only the columns that changed. On an insert, the whole row. Null on '
  'a delete.';

-- ---------------------------------------------------------------------------
-- 3. The one trigger.
--
-- One function for every audited table, driven by `tg_op` and `tg_table_name`, because
-- fourteen near-identical functions is fourteen places to fix a bug in and thirteen
-- chances to fix it in only some of them. 20260811000045 argued the opposite for
-- voucher numbers and the difference is worth naming: a generic voucher function would
-- have needed dynamic SQL to name its own table, and this one needs none — `to_jsonb`
-- takes the row whatever shape it is.
--
-- SECURITY DEFINER, which is the only way a row lands in a table the caller has no
-- INSERT privilege on, and the same reasoning 20260811000042 gives: it takes no
-- argument from the caller, reads nothing the caller supplied, and copies values off a
-- row that has already passed its own table's policies. There is nothing here to aim.
--
-- WHICH COLUMN IS THE TARGET is a trigger argument rather than a guess. Almost every
-- table's identity is `id`, so that is the default, and `teacher_permissions` — keyed
-- on `teacher_id`, because a teacher has exactly one permission row — says so at the
-- point where somebody reading the trigger will see it.
--
-- WHO, when the browser is not involved. `auth.uid()` answers correctly under SECURITY
-- DEFINER, because it reads the request's JWT claim out of a transaction-local setting
-- rather than the current role. But the writes §10 most wants attributed — plan
-- changes, capacity purchases — are made by our own server with the service_role key
-- and no JWT at all, and would land here as null. So the server may name itself by
-- setting `app.actor` for the transaction.
--
-- That is not a way to forge an actor. `auth.uid()` is tried FIRST, so a session with a
-- JWT is always recorded as itself and the setting cannot overwrite it; and a browser
-- has no way to run set_config in the first place, because PostgREST does not expose
-- one. The setting can only fill a null, and only from a connection that already holds
-- the service_role key.
-- ---------------------------------------------------------------------------

create or replace function app.log_audit_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  key_column text := coalesce(tg_argv[0], 'id');
  new_row  jsonb;
  old_row  jsonb;
  -- Whichever of the two rows exists, for reading the tenant and the target off.
  present  jsonb;
  op       public.audit_operation;
  changed_before jsonb;
  changed_after  jsonb;
  tenant   uuid;
begin
  if tg_op = 'INSERT' then
    new_row := pg_catalog.to_jsonb(new);
    present := new_row;
    op := 'created';
    changed_after := new_row;

  elsif tg_op = 'DELETE' then
    old_row := pg_catalog.to_jsonb(old);
    present := old_row;
    op := 'deleted';
    changed_before := old_row;

  else
    -- `updated_at` is dropped before anything is compared, because every audited table
    -- has a BEFORE trigger that bumps it. Left in, it would appear in the diff of every
    -- single update and be the only entry in the diff of a save that changed nothing.
    new_row := pg_catalog.to_jsonb(new) - 'updated_at';
    old_row := pg_catalog.to_jsonb(old) - 'updated_at';
    present := new_row;
    op := 'updated';

    -- A form submitted without an edit. A line about it is a line somebody has to read
    -- past to reach a real one.
    if new_row = old_row then
      return null;
    end if;

    -- Both sides filtered by the same predicate, so the two objects come out with the
    -- same key set and `before -> k` against `after -> k` is the whole story. Neither
    -- aggregate can come back null, because the rows are known to differ by here.
    changed_before := (
      select pg_catalog.jsonb_object_agg(e.key, e.value)
      from pg_catalog.jsonb_each(old_row) e
      where e.value is distinct from (new_row -> e.key)
    );
    changed_after := (
      select pg_catalog.jsonb_object_agg(e.key, e.value)
      from pg_catalog.jsonb_each(new_row) e
      where e.value is distinct from (old_row -> e.key)
    );
  end if;

  -- Every audited table carries `coaching_center_id`; `coaching_centers` is the one
  -- that cannot, because its own id IS the centre. Anything else means this trigger has
  -- been attached to a table nobody thought about, and the raise below is how that is
  -- found — in the test suite, on the commit that attaches it, rather than as a log
  -- line no policy can ever return.
  tenant := coalesce(
    (present ->> 'coaching_center_id')::uuid,
    case when tg_table_name = 'coaching_centers' then (present ->> 'id')::uuid end
  );

  if tenant is null then
    raise exception
      'the audit trigger on %.% cannot tell which centre the row belongs to',
      tg_table_schema, tg_table_name;
  end if;

  -- A centre being erased takes its log with it — the cascade on `coaching_center_id`
  -- says so — and the cascade deletes the centre row before its children. So a delete
  -- reaching here with no centre left is a centre closing, and a line written now would
  -- reference a parent that is already gone and fail the foreign key, which would make
  -- `delete from coaching_centers` impossible for ever. This is the same landmine
  -- 20260811000042 dodged by dropping a constraint and 20260811000044 by choosing NO
  -- ACTION; here the honest fix is to write nothing, because there is nothing left to
  -- write it into.
  if tg_op = 'DELETE'
     and not exists (select 1 from public.coaching_centers c where c.id = tenant)
  then
    return null;
  end if;

  insert into public.audit_log (
    coaching_center_id,
    actor,
    actor_role,
    entity,
    entity_id,
    operation,
    before,
    after
  )
  values (
    tenant,
    coalesce(
      auth.uid(),
      nullif(pg_catalog.current_setting('app.actor', true), '')::uuid
    ),
    -- `role` and not `current_user`: see this section's header. 'none' is what the
    -- setting reads when nothing set it, which is a migration, and null says that
    -- better than the word does. `nullif` stays unqualified because it is SQL syntax
    -- rather than a catalog function — there is no pg_catalog.nullif to name.
    nullif(pg_catalog.current_setting('role', true), 'none'),
    tg_table_name,
    (present ->> key_column)::uuid,
    op,
    changed_before,
    changed_after
  );

  -- AFTER trigger: the return value is discarded, and null says so plainly.
  return null;
end;
$$;

revoke all on function app.log_audit_entry() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. What is watched.
--
-- §10's list, table by table, with the section that asked for each. AFTER and not
-- BEFORE, for the reason 20260811000042 gives: the log should record a change that
-- actually happened, so it is written once the row has survived every constraint and
-- guard trigger in front of it.
--
-- `for each row` on all three operations. A statement-level trigger would fire once for
-- a bulk update and have no row to describe.
-- ---------------------------------------------------------------------------

-- Plan changes and capacity purchases (§10, §12.4). The centre row is also where
-- `student_capacity` lands, so a purchase is an update of it.
create trigger coaching_centers_audit
  after insert or update or delete on public.coaching_centers
  for each row execute function app.log_audit_entry();

-- Permission changes, and login accounts created or deactivated (§10, §5.1). A role
-- moved from teacher to manager is one column of one row here.
create trigger center_members_audit
  after insert or update or delete on public.center_members
  for each row execute function app.log_audit_entry();

-- The other half of "login accounts created or deactivated": `user_id` appearing on a
-- teacher, and `active` going false.
create trigger teachers_audit
  after insert or update or delete on public.teachers
  for each row execute function app.log_audit_entry();

-- Permission changes, §6.5's checkbox set. Keyed on `teacher_id` and not `id`, which is
-- why this one names its target column.
create trigger teacher_permissions_audit
  after insert or update or delete on public.teacher_permissions
  for each row execute function app.log_audit_entry('teacher_id');

-- And for non-teaching staff, per 20260811000043.
create trigger employees_audit
  after insert or update or delete on public.employees
  for each row execute function app.log_audit_entry();

-- Student status changes and branch transfers (§10, §7.2). `student_transfers` records a
-- move in more detail and is the record a family's file reads; this is the uniform line
-- that sits beside every other change in one list.
create trigger students_audit
  after insert or update or delete on public.students
  for each row execute function app.log_audit_entry();

-- Not in §10's list, and here because it is the same class of act. A guardian phone is
-- the number every fee reminder and every result notice goes to, so changing one
-- redirects the centre's money conversation to whoever changed it. That is precisely a
-- "who changed this?" with money behind it.
create trigger guardians_audit
  after insert or update or delete on public.guardians
  for each row execute function app.log_audit_entry();

-- Fee amount changes, discounts and scholarships granted, and voids (§10, §9.2,
-- 20260811000028, 20260811000030).
create trigger fee_invoices_audit
  after insert or update or delete on public.fee_invoices
  for each row execute function app.log_audit_entry();

-- Payments recorded, voids and refunds (§10, §9.3). The table is already append-only
-- and already numbers its receipts; what it could not say before now is who typed it.
create trigger fee_payments_audit
  after insert or update or delete on public.fee_payments
  for each row execute function app.log_audit_entry();

-- Salary terms changed (§10, §9.5). Worth more than most: a raise applied to the wrong
-- person is a dispute, and 20260811000044 retires the previous agreement automatically,
-- so the log is where the sequence of agreements can be read back.
create trigger salary_terms_audit
  after insert or update or delete on public.salary_terms
  for each row execute function app.log_audit_entry();

-- Salary paid (§10, §9.5).
create trigger salary_payments_audit
  after insert or update or delete on public.salary_payments
  for each row execute function app.log_audit_entry();

-- Expenses recorded (§10, §9.6), and the table whose migration header quotes the
-- support conversation this log exists to answer.
create trigger expenses_audit
  after insert or update or delete on public.expenses
  for each row execute function app.log_audit_entry();

-- Plan changes as the billing side sees them (§10, §12).
create trigger subscriptions_audit
  after insert or update or delete on public.subscriptions
  for each row execute function app.log_audit_entry();

-- Capacity purchases and every other taka the centre pays us (§10, §12.4).
create trigger payments_audit
  after insert or update or delete on public.payments
  for each row execute function app.log_audit_entry();

-- ---------------------------------------------------------------------------
-- 5. The gap a row trigger cannot cover.
--
-- A row trigger does not fire for TRUNCATE, so a table with TRUNCATE still granted to
-- `authenticated` is a table this log has a hole in — and worse, a hole shaped like
-- every row at once. 20260811000017 named the stakes for one table: "one `truncate
-- fee_payments` away from erasing every receipt in every centre". Nothing filters a
-- truncate; row-level security has no say in it.
--
-- Eight migrations have closed it one table at a time — 17, 24, 28, 31, 36, 42, 44, 45 —
-- because each of them was writing about the table it happened to be adding. That
-- leaves roughly half the schema: `students`, `guardians`, `teachers`, `center_members`,
-- `enrollments`, `batches`, `branches`, `exams`, `exam_results`, `employees`,
-- `salary_terms`, `coaching_centers` and the rest all still hand TRUNCATE to any
-- signed-in user, because Supabase ships `alter default privileges in schema public
-- grant all on tables to anon, authenticated, service_role` and `all` includes it.
--
-- One statement closes the class rather than the next instance of it. This is defence in
-- depth and not a live exploit — PostgREST has no verb that issues a TRUNCATE, so the
-- privilege is held rather than reachable — which is exactly the ground 20260811000042
-- stood on: the day somebody pastes a `grant all on all tables in schema public` out of
-- a setup snippet, or adds an RPC that takes a table name, the privilege is what decides
-- how bad that day is.
--
-- `service_role` keeps it, because a support request has to be answerable and because
-- our own server is not the threat model.
--
-- A TABLE ADDED AFTER THIS MIGRATION gets the grant again from those default
-- privileges, and this statement cannot reach forwards in time. That belongs in
-- check-migrations.mjs beside the five invariants already there — assert that no table
-- in `public` leaves TRUNCATE with `authenticated` — and it is left as the next thing
-- that gate should learn rather than done here, because a schema gate that grows an
-- invariant in the same commit as the fix has never been run against the failure.
-- ---------------------------------------------------------------------------

revoke truncate on all tables in schema public from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 6. Who may read it, and nobody may write it.
--
-- Owner only, plus the founder for §10's support conversation. See the header for why
-- this is not `is_staff_admin`: the log carries `subscriptions` and `payments` rows,
-- which 20260811000002 keeps from managers, and the manager is the subject of the
-- question the log exists to answer.
--
-- SELECT only. No insert policy, no update policy, no delete policy — the only
-- legitimate writer is the trigger in section 3, and it runs as the owner. The revoke is
-- belt and braces for the same pasted-grant day section 5 is about.
--
-- NOTHING MAY EDIT A LINE, not even the server. The money tables hand `reference` and
-- `note` back to a browser because a mistyped bKash trxID is a real correction that
-- changes no number. There is no equivalent here: every column of this table is a
-- statement about what somebody did, and a correctable audit log is not one.
--
-- NO RETENTION RULE YET, and it is worth writing down that this is a decision and not
-- an oversight. This table grows with every write to fourteen others and nothing prunes
-- it. That is right for now — a log that quietly forgets is worse than a large one, and
-- the first centre to reach a size where this matters is a customer worth the
-- conversation. When it does matter, the answer is an archive of old lines rather than a
-- delete, and it will need a migration that says so.
-- ---------------------------------------------------------------------------

alter table public.audit_log enable row level security;

create policy audit_log_owner_read on public.audit_log
  for select to authenticated
  using (app.is_owner(coaching_center_id) or app.is_platform_admin());

revoke insert, update, delete, truncate on public.audit_log from authenticated, anon;



