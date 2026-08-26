/**
 * Applies every migration to a throwaway Postgres and reports what was created,
 * then checks the three structural invariants that the whole tenant boundary
 * rests on. Run: node scripts/check-migrations.mjs
 */
import { bootDatabase } from './lib/pg-harness.mjs'

try {
  const { db, migrations } = await bootDatabase({ verbose: true })

  const tables = await db.query(`
    select table_name
    from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name;
  `)

  const missingTenant = await db.query(`
    select t.table_name
    from information_schema.tables t
    where t.table_schema = 'public'
      and t.table_type = 'BASE TABLE'
      and not exists (
        select 1 from information_schema.columns c
        where c.table_schema = 'public'
          and c.table_name = t.table_name
          and c.column_name = 'coaching_center_id'
      )
    order by t.table_name;
  `)

  console.log(`\n${migrations.length} migration(s) applied cleanly.`)
  console.log(`${tables.rows.length} tables: ${tables.rows.map((r) => r.table_name).join(', ')}`)
  console.log(
    `\nTables without coaching_center_id (expected: profiles, coaching_centers, and pure child tables):\n  ${missingTenant.rows
      .map((r) => r.table_name)
      .join(', ')}`,
  )

  // -------------------------------------------------------------------------
  // Every reference between two tenant tables must carry the tenant with it.
  //
  // `exams.subject_id references subjects (id)` only says the subject exists,
  // not that it is this centre's subject — so a write can pair a legitimate
  // coaching_center_id with another centre's sibling id and pass both the
  // foreign key and the RLS check. 20260811000005 closed all 36 of those by
  // making each reference composite: (sibling_id, coaching_center_id).
  //
  // This query is here so the next table cannot reopen it. It is a schema fact,
  // not a behaviour, which means it holds for tables nobody has written a test
  // for yet — including whatever gets added at 2am six months from now.
  // -------------------------------------------------------------------------
  const holes = await db.query(`
    with tenant_tables as (
      select c.relname, c.oid
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      where c.relkind = 'r'
        and exists (
          select 1 from pg_attribute a
          where a.attrelid = c.oid and a.attname = 'coaching_center_id'
            and a.attnum > 0 and not a.attisdropped
        )
    )
    select con.conname, child.relname as child_table, parent.relname as parent_table,
           (select string_agg(a.attname, ', ' order by k.ord)
              from unnest(con.conkey) with ordinality k(att, ord)
              join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.att) as child_cols
    from pg_constraint con
    join tenant_tables child on child.oid = con.conrelid
    join tenant_tables parent on parent.oid = con.confrelid
    where con.contype = 'f'
      and parent.relname <> 'coaching_centers'
      and not exists (
        select 1 from unnest(con.conkey) k(att)
        join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.att
        where a.attname = 'coaching_center_id'
      )
    order by child.relname, con.conname;
  `)

  const composite = await db.query(`
    select count(*)::int as n
    from pg_constraint con
    join pg_class ch on ch.oid = con.conrelid
    join pg_namespace n on n.oid = ch.relnamespace and n.nspname = 'public'
    where con.contype = 'f' and array_length(con.conkey, 1) = 2
      and exists (
        select 1 from unnest(con.conkey) k(att)
        join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.att
        where a.attname = 'coaching_center_id'
      );
  `)

  if (holes.rows.length > 0) {
    console.error(
      `\nTENANT BOUNDARY HOLE — ${holes.rows.length} reference(s) between tenant tables do not carry coaching_center_id:\n`,
    )
    for (const h of holes.rows) {
      console.error(
        `  ${h.child_table}.(${h.child_cols}) -> ${h.parent_table}   [${h.conname}]`,
      )
    }
    console.error(
      `
Each of these lets a row in one centre reference a row in another. Fix it the
way 20260811000005 did, in a new migration:

  alter table <parent> add constraint <parent>_id_center_key
    unique (id, coaching_center_id);
  alter table <child> drop constraint <name>;
  alter table <child> add constraint <child>_<col>_center_fkey
    foreign key (<col>, coaching_center_id)
    references <parent> (id, coaching_center_id) on delete <action>;

Use "on delete set null (<col>)" rather than a bare "set null" — a bare one
would try to null coaching_center_id too, and that column is NOT NULL.

If a reference genuinely must cross centres, it needs a comment in the
migration saying why, and this check needs to learn about it deliberately.`,
    )
    process.exit(1)
  }

  console.log(
    `\nTenant-consistent references: ${composite.rows[0].n} composite foreign keys, 0 holes.`,
  )

  // -------------------------------------------------------------------------
  // Every view must execute as its caller.
  //
  // A Postgres view runs with the privileges of its owner by default, and the
  // owner here is the migration role, which bypasses RLS. So a view over a
  // tenant table serves every centre's rows to every caller while all 63
  // policies sit underneath it, untouched and irrelevant. Measured on this
  // schema: as owner B, the students table returned 1 row and a naive view over
  // it returned 2.
  //
  // security_invoker = true makes the view execute as the caller so the
  // underlying policies apply. It is one clause, it is easy to leave out, and
  // leaving it out is silent — the view works, it just works for everyone. That
  // combination is what makes it worth a build failure rather than a code review.
  // -------------------------------------------------------------------------
  const leakyViews = await db.query(`
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where c.relkind = 'v'
      and coalesce(
        (select option_value
         from pg_options_to_table(c.reloptions)
         where option_name = 'security_invoker'),
        'false'
      ) <> 'true'
    order by c.relname;
  `)

  const views = await db.query(`
    select count(*)::int as n
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where c.relkind = 'v';
  `)

  if (leakyViews.rows.length > 0) {
    console.error(
      `\nVIEW BYPASSES RLS — ${leakyViews.rows.length} view(s) in public run as their owner, not the caller:\n`,
    )
    for (const v of leakyViews.rows) console.error(`  ${v.relname}`)
    console.error(
      `
Each of these serves every centre's rows to every caller, with the row-level
policies underneath still intact and doing nothing. Add the option:

  create view <name> with (security_invoker = true) as …

or, for one that already exists:

  alter view <name> set (security_invoker = true);

If a view genuinely must read past RLS — a platform-admin report, say — it does
not belong in the public schema where PostgREST will expose it.`,
    )
    process.exit(1)
  }

  console.log(`Views: ${views.rows[0].n}, all security_invoker.`)

  // -------------------------------------------------------------------------
  // No function in public may be callable by a signed-out request.
  //
  // This one is not Postgres's doing, which is what makes it dangerous. Postgres
  // alone grants EXECUTE on a new function to PUBLIC, and a migration writing
  // `revoke execute on function … from public` looks like it has closed the
  // door. On Supabase the door is a *second*, explicit grant: the project ships
  //
  //   alter default privileges in schema public grant all on functions to anon
  //
  // so every `create function` in public silently becomes callable by anon, and
  // revoking from PUBLIC does not touch it. The harness reproduces those default
  // privileges before applying any migration precisely so this is catchable here
  // — see the note in lib/pg-harness.mjs.
  //
  // PostgREST exposes public functions at /rest/v1/rpc/<name> using the anon key,
  // which is in the browser bundle by design. So the gap is not theoretical
  // privilege: it is a URL anybody can POST to. Two of the nine functions here
  // move money and messages — claim_sms_batch hands out queued SMS, and
  // import_students writes minors' names and guardians' phone numbers — and one,
  // platform_centers, is SECURITY DEFINER, which means an anon caller would run
  // it with the owner's rights and read every centre on the platform.
  //
  // Extension functions are excluded by pg_depend rather than by name. citext and
  // pgcrypto install ~84 functions into public and they all carry the same anon
  // grant; they are pure helpers with no data access, they are not ours to
  // revoke, and listing them would bury the one line that matters. Excluding
  // them by dependency means a newly installed extension does not need this
  // script edited, while every function *we* write is caught.
  // -------------------------------------------------------------------------
  const NOT_FROM_EXTENSION = `
    not exists (
      select 1 from pg_depend d
      where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
    )`

  const anonCallable = await db.query(`
    select p.proname, pg_get_function_identity_arguments(p.oid) as args,
           p.prosecdef as security_definer
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
    where has_function_privilege('anon', p.oid, 'EXECUTE')
      and ${NOT_FROM_EXTENSION}
    order by p.proname;
  `)

  const ourFunctions = await db.query(`
    select count(*)::int as n
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
    where ${NOT_FROM_EXTENSION};
  `)

  if (anonCallable.rows.length > 0) {
    console.error(
      `\nFUNCTION CALLABLE BY ANON — ${anonCallable.rows.length} function(s) in public can be executed by a signed-out request:\n`,
    )
    for (const f of anonCallable.rows) {
      console.error(
        `  ${f.proname}(${f.args})${f.security_definer ? '   [SECURITY DEFINER — runs as owner]' : ''}`,
      )
    }
    console.error(
      `
PostgREST publishes these at /rest/v1/rpc/<name>, reachable with the anon key
that ships in the browser bundle. Add the revoke to the migration that creates
the function, in the same statement block:

  revoke all on function <name>(<args>) from anon;

A "revoke ... from public" is NOT enough. Supabase's own
"alter default privileges ... grant all on functions to anon" is a separate
grant, and it survives that revoke — which is the whole reason this check
exists rather than a code review.

Name anon explicitly even when also revoking from authenticated: the argument
list has to match the signature exactly, so an overloaded function needs one
revoke per signature.

If a function genuinely must serve signed-out callers, it needs a comment in the
migration saying why, and this check needs to learn about it deliberately.`,
    )
    process.exit(1)
  }

  console.log(
    `Functions: ${ourFunctions.rows[0].n} of ours in public, none callable by anon.`,
  )

  await db.close()
} catch (error) {
  console.error(`\nMIGRATION FAILED\n${error.message}`)
  process.exit(1)
}
