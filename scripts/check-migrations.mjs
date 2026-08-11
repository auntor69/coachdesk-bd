/**
 * Applies every migration to a throwaway Postgres and reports what was created,
 * then checks the two structural invariants that the whole tenant boundary
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

  await db.close()
} catch (error) {
  console.error(`\nMIGRATION FAILED\n${error.message}`)
  process.exit(1)
}
