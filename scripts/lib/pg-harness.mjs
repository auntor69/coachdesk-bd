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
 */
const AUTH_STUB = `
  create schema if not exists auth;

  create table auth.users (
    id    uuid primary key default gen_random_uuid(),
    email text unique,
    phone text unique
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
`

export async function bootDatabase({ verbose = false } = {}) {
  const db = new PGlite({ extensions: { pgcrypto, citext } })
  await db.exec('create extension if not exists pgcrypto;')
  await db.exec(AUTH_STUB)

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

  // Supabase grants these roles broad table privileges and relies entirely on
  // RLS to filter rows. Replicating that here matters: without the grants a
  // query fails with "permission denied" and a test would pass for the wrong
  // reason, hiding a missing policy.
  await db.exec(`
    grant usage on schema public to anon, authenticated, service_role;
    grant all on all tables in schema public to anon, authenticated, service_role;
    grant all on all sequences in schema public to anon, authenticated, service_role;
  `)

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

