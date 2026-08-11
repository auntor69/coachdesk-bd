/**
 * Applies every migration to a throwaway Postgres and reports what was created.
 * Run: node scripts/check-migrations.mjs
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

  await db.close()
} catch (error) {
  console.error(`\nMIGRATION FAILED\n${error.message}`)
  process.exit(1)
}
