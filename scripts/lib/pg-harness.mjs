/**
 * Boots real PostgreSQL (compiled to WASM) with enough of Supabase's `auth`
 * schema stubbed in that our migrations run unchanged. Lets us execute the
 * schema and exercise RLS policies locally, with no Docker and no cloud project.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { citext } from '@electric-sql/pglite/contrib/citext'

const MIGRATIONS_DIR = 'supabase/migrations'

/**
 * Mirrors the pieces of Supabase's platform that our SQL depends on:
 * the auth.users table, and the auth.uid()/auth.role() helpers that every
 * RLS policy calls. Supabase derives these from the request JWT; here they
 * read a session-local setting we control from the test.
 *
 * The column list is deliberately wider than any policy needs. Our signup
 * trigger reads new.raw_user_meta_data, and a stub missing that column turns
 * a working migration into a test-only failure — which is the worst kind,
 * because the fix is to change the stub and the instinct is to change the SQL.
 */
const AUTH_STUB = `
  create schema if not exists auth;

  create table auth.users (
    id                 uuid primary key default gen_random_uuid(),
    email              text unique,
    phone              text unique,
    aud                text default 'authenticated',
    role               text default 'authenticated',
    encrypted_password text,
    raw_app_meta_data  jsonb default '{}'::jsonb,
    raw_user_meta_data jsonb default '{}'::jsonb,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
  );

  create or replace function auth.uid()
  returns uuid
  language sql stable
  as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;

  create or replace function auth.role()
  returns text
  language sql stable
  as $$
    select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon');
  $$;

  -- Supabase ships these roles; policies and grants reference them.
  do $$
  begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then
      create role anon nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
      create role authenticated nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then
      create role service_role nologin noinherit bypassrls;
    end if;
  end
  $$;

  -- Supabase grants these, and until the invoice-void trigger (20260811000028) nothing
  -- here needed them: every other auth.uid() caller in the schema is either an RLS
  -- policy expression, which Postgres evaluates as the table owner, or a SECURITY
  -- DEFINER function, which runs as its owner. A SECURITY INVOKER trigger is the first
  -- thing to reach auth.uid() with the caller's own privileges, and without these two
  -- lines it fails with "permission denied for schema auth" — a lock the real database
  -- does not have.
  --
  -- Checked against the live project rather than assumed: has_schema_privilege(
  -- 'authenticated', 'auth', 'usage') and has_function_privilege('authenticated',
  -- 'auth.uid()', 'execute') are both true there.
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;
`

export async function bootDatabase({ verbose = false } = {}) {
  const db = new PGlite({ extensions: { pgcrypto, citext } })
  await db.exec('create extension if not exists pgcrypto;')
  await db.exec(AUTH_STUB)

  // Supabase grants these roles broad table privileges and relies entirely on
  // RLS to filter rows. Replicating that here matters: without the grants a
  // query fails with "permission denied" and a test would pass for the wrong
  // reason, hiding a missing policy.
  //
  // Set as DEFAULT privileges *before* the migrations, not as a blanket grant
  // after them. On the real project the grants already exist by the time a
  // migration runs, so a migration that revokes one — see the billing column
  // lock in 20260811000004 — keeps it revoked. Granting afterwards would hand it
  // straight back, and the suite would prove the opposite of production.
  await db.exec(`
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public
      grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public
      grant all on sequences to anon, authenticated, service_role;
    -- Functions too, and this one is easy to miss because Postgres alone would
    -- have granted EXECUTE to PUBLIC and a "revoke ... from public" in a
    -- migration would look like it had closed the door. On Supabase the door is
    -- a separate, explicit grant to anon that the revoke does not touch, so
    -- every new RPC starts out callable by a signed-out request. Reproducing
    -- that here is the only way the local suite can catch it.
    alter default privileges in schema public
      grant all on functions to anon, authenticated, service_role;
  `)

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  for (const file of files) {
    const sql = readFileSync(`${MIGRATIONS_DIR}/${file}`, 'utf8')
    try {
      await db.exec(sql)
      if (verbose) console.log(`  applied ${file}`)
    } catch (error) {
      throw new Error(`${file}: ${error.message}`)
    }
  }

  return { db, migrations: files }
}

/**
 * Runs `fn` as the given user, the way Supabase scopes a request.
 *
 * Must be a transaction: SET LOCAL is silently ignored outside one, which
 * would leave queries running as the superuser — and a superuser bypasses RLS,
 * so every isolation test would pass while proving nothing.
 *
 * Pass userId = null to test anonymous access.
 */
export async function asUser(db, userId, fn) {
  return db.transaction(async (tx) => {
    const role = userId ? 'authenticated' : 'anon'
    await tx.exec(`set local role ${role};`)
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [
      userId ?? '',
    ])
    await tx.query(`select set_config('request.jwt.claim.role', $1, true)`, [role])
    return fn(tx)
  })
}

/**
 * Like asUser, but for a statement expected to be blocked. A failed statement
 * poisons its transaction, so each attempt needs its own.
 * Resolves true when the statement was rejected.
 */
export async function deniedAsUser(db, userId, sql, params = []) {
  try {
    await asUser(db, userId, (tx) => tx.query(sql, params))
    return false
  } catch {
    return true
  }
}

