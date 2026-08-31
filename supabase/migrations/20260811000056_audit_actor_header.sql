-- The server names itself when it writes.
--
-- 20260811000046 built the audit log and left one route open on purpose:
--
--   > But the writes §10 most wants attributed — plan changes, capacity purchases — are
--   > made by our own server with the service_role key and no JWT at all, and would land
--   > here as null. So the server may name itself by setting `app.actor` for the
--   > transaction.
--
-- `app.actor` cannot be set. Not "was not" — cannot: every PostgREST request is its own
-- transaction, so a `set_config('app.actor', uid, true)` issued as one supabase-js call is
-- rolled back before the `.insert()` in the next call opens its own. Only a direct
-- Postgres connection could hold the two together, and no server action in this product
-- has one; they all speak to PostgREST. The setting stays supported below, because a
-- migration or a psql session genuinely can use it, but nothing in `src/` ever will.
--
-- WHAT WORKS INSTEAD IS A REQUEST HEADER. PostgREST puts every header of the request into
-- `request.headers` as JSON, readable in the same transaction as the write it arrived
-- with, and supabase-js sets them per client. So `createAdminClient(session.userId)` sends
-- `x-app-actor`, and the trigger reads it off the request rather than off a setting
-- nothing can set.
--
-- THIS IS NOT A WAY TO FORGE AN ACTOR, and the reasoning is 46's own, one step longer:
--
--   * `auth.uid()` is still tried FIRST, so a request carrying a JWT is recorded as that
--     JWT's user and the header cannot overwrite it. Every browser write in this product
--     carries one.
--   * A holder of `anon` who sent the header would reach no audited table: none of the
--     fourteen grants anon an insert, update or delete policy.
--   * Which leaves exactly one caller who can land on the fallback — a request holding
--     the service_role key. Anybody holding that key can already write any row in any
--     centre and could write straight into `audit_log` if they wanted; a header they
--     control is not new authority.
--
-- So the header is trusted for the one thing it does: putting a name on a write that
-- would otherwise be anonymous. It is a courtesy from our own server to its own log.
--
-- A NULL ACTOR REMAINS A REAL ANSWER, and the cron worker is why. `api/cron/sms` drains
-- every centre's queue with no human behind it, and the honest record of that is
-- `actor_role = 'service_role'` with no actor — which is exactly what it gets, by passing
-- nothing. An invented actor there would be worse than the null: it would name somebody
-- who was asleep.

-- ---------------------------------------------------------------------------
-- 1. The header, as a uuid or nothing.
--
-- EVERY FAILURE IS A NULL. A payment insert must not be aborted because a header was
-- truncated, or because `request.headers` is absent (a direct connection, this migration),
-- or because something sent `x-app-actor: rahim`. The log line is worth less than the
-- payment it describes, so a bad header costs the attribution and nothing else.
--
-- That is also why this is its own function rather than three lines inside the trigger:
-- `exception when others` needs a block, and a block inside `log_audit_entry` would put
-- the whole insert inside a subtransaction on every audited write.
--
-- STABLE and not IMMUTABLE: the answer changes per request. Not SECURITY DEFINER either —
-- it reads a setting, touches no table, and needs nobody else's privileges.
--
-- `nullif` is unqualified for 20260811000046's reason, which is not a style choice: it is
-- SQL syntax rather than a catalog function, so there is no `pg_catalog.nullif` to name and
-- qualifying it fails at runtime with "function pg_catalog.nullif(text, unknown) does not
-- exist". Everything that IS a function is qualified, because `search_path` is empty.
-- ---------------------------------------------------------------------------

create or replace function app.request_actor()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
begin
  return nullif(
    pg_catalog.current_setting('request.headers', true)::json ->> 'x-app-actor',
    ''
  )::uuid;
exception
  when others then
    return null;
end;
$$;

revoke all on function app.request_actor() from public, anon, authenticated;

comment on function app.request_actor() is
  'The x-app-actor request header as a uuid, or null for anything that is not one. Set by '
  'createAdminClient(actor) so a service-role write can be attributed; see '
  '20260811000056 for why it cannot be used to forge one.';

-- ---------------------------------------------------------------------------
-- 2. The trigger, re-emitted with a third source for the actor.
--
-- Unchanged from 20260811000046 apart from the coalesce, and re-emitted in full because
-- `create or replace function` has no way to patch one expression. The order of the three
-- is the security property: JWT, then the setting a psql session can hold, then the
-- header.
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
    -- `updated_at` out before anything is compared: every audited table bumps it, so it
    -- would be in the diff of every update and the only entry in a save that changed
    -- nothing.
    new_row := pg_catalog.to_jsonb(new) - 'updated_at';
    old_row := pg_catalog.to_jsonb(old) - 'updated_at';
    present := new_row;
    op := 'updated';

    if new_row = old_row then
      return null;
    end if;

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

  tenant := coalesce(
    (present ->> 'coaching_center_id')::uuid,
    case when tg_table_name = 'coaching_centers' then (present ->> 'id')::uuid end
  );

  if tenant is null then
    raise exception
      'the audit trigger on %.% cannot tell which centre the row belongs to',
      tg_table_schema, tg_table_name;
  end if;

  -- A centre closing takes its log with it, and the cascade deletes the parent first, so
  -- a line written now would fail the foreign key and make `delete from coaching_centers`
  -- impossible for ever.
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
      nullif(pg_catalog.current_setting('app.actor', true), '')::uuid,
      app.request_actor()
    ),
    -- `role` and not `current_user`, which is the owner inside a SECURITY DEFINER
    -- function. 'none' is what a migration reads, and null says that better.
    nullif(pg_catalog.current_setting('role', true), 'none'),
    tg_table_name,
    (present ->> key_column)::uuid,
    op,
    changed_before,
    changed_after
  );

  return null;
end;
$$;

revoke all on function app.log_audit_entry() from public, anon, authenticated;
