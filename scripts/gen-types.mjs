/**
 * Generates src/lib/supabase/types.ts by introspecting the live database.
 *
 * The Supabase CLI does this too, but it is a 100MB binary that needs Docker
 * for half its commands. We already have a Postgres connection for migrations,
 * and information_schema knows everything we need, so this stays a dependency
 * we don't have.
 *
 *   npm run gen:types
 *
 * Regenerate after every migration. The types are checked in so CI and Vercel
 * builds never need database access.
 */
import { writeFileSync } from 'node:fs'
import pg from 'pg'

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('SUPABASE_DB_URL is not set. Add it to .env.local.')
  process.exit(1)
}

const url = new URL(dbUrl)
const client = new pg.Client({
  host: url.hostname,
  port: Number(url.port || 5432),
  database: url.pathname.replace(/^\//, '') || 'postgres',
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
})

await client.connect()

/** Postgres type name -> TypeScript type. Anything unlisted falls back to Json. */
const SCALARS = {
  bool: 'boolean',
  int2: 'number',
  int4: 'number',
  int8: 'number',
  float4: 'number',
  float8: 'number',
  // numeric comes back as a string from node-pg to protect precision, but
  // PostgREST serialises it as a JSON number. This file describes PostgREST.
  numeric: 'number',
  text: 'string',
  varchar: 'string',
  bpchar: 'string',
  uuid: 'string',
  date: 'string',
  time: 'string',
  timetz: 'string',
  timestamp: 'string',
  timestamptz: 'string',
  json: 'Json',
  jsonb: 'Json',
  interval: 'string',
  inet: 'string',
}

const { rows: enums } = await client.query(`
  select t.typname as name,
         -- Cast to text[]: array_agg over the name type yields name[], which
         -- node-pg has no parser for and hands back as a raw {a,b} string.
         array_agg(e.enumlabel::text order by e.enumsortorder) as labels
  from pg_type t
  join pg_enum e on e.enumtypid = t.oid
  join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public'
  group by t.typname
  order by t.typname
`)

const enumNames = new Set(enums.map((e) => e.name))

const { rows: columns } = await client.query(`
  select
    c.relname                                   as table_name,
    c.relkind                                   as kind,
    a.attname                                   as column_name,
    a.attnum                                    as position,
    a.attnotnull                                as not_null,
    t.typname                                   as type_name,
    t.typcategory                               as type_category,
    et.typname                                  as element_type,
    pg_get_expr(d.adbin, d.adrelid) is not null as has_default,
    a.attidentity <> ''                         as is_identity,
    col_description(c.oid, a.attnum)            as comment
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  join pg_type t on t.oid = a.atttypid
  left join pg_type et on et.oid = t.typelem
  left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
  where n.nspname = 'public'
    and c.relkind in ('r', 'v', 'm')
  order by c.relname, a.attnum
`)

/**
 * Foreign keys, which supabase-js needs far more than it lets on.
 *
 * Its `.select('a, other_table (b)')` parser resolves embeds through the
 * Relationships array. Omit it and type inference does not merely lose the
 * embed — it collapses the whole row to `never`, and every property access
 * fails with an error that says nothing about foreign keys.
 */
const { rows: fkeys } = await client.query(`
  select
    con.conname                        as name,
    src.relname                        as table_name,
    tgt.relname                        as referenced_relation,
    array_agg(sa.attname::text order by u.ord)  as columns,
    array_agg(ta.attname::text order by u.ord)  as referenced_columns,
    -- One-to-one exactly when the referencing columns are themselves unique.
    exists (
      select 1 from pg_index i
      where i.indrelid = con.conrelid
        and (i.indisunique or i.indisprimary)
        and i.indnatts = array_length(con.conkey, 1)
        and i.indkey::int2[] @> con.conkey
        and con.conkey @> i.indkey::int2[]
    )                                  as is_one_to_one
  from pg_constraint con
  join pg_class src on src.oid = con.conrelid
  join pg_class tgt on tgt.oid = con.confrelid
  join pg_namespace n on n.oid = src.relnamespace
  cross join unnest(con.conkey, con.confkey) with ordinality as u(sattnum, tattnum, ord)
  join pg_attribute sa on sa.attrelid = con.conrelid and sa.attnum = u.sattnum
  join pg_attribute ta on ta.attrelid = con.confrelid and ta.attnum = u.tattnum
  where con.contype = 'f' and n.nspname = 'public'
  group by con.conname, con.conkey, con.conrelid, src.relname, tgt.relname
  order by src.relname, con.conname
`)

/**
 * Functions callable through PostgREST — public schema only, since that is all
 * PostgREST exposes. A helper living in `app` is invisible to `.rpc()`.
 */
const { rows: functions } = await client.query(`
  select
    p.proname                                as name,
    pg_get_function_arguments(p.oid)         as args,
    pg_get_function_result(p.oid)            as returns,
    -- A strict function returns null on any null input, so PostgREST callers
    -- must pass real values. Otherwise every argument accepts null.
    p.proisstrict                            as strict
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind = 'f'
    -- Trigger functions live in public too, but .rpc() can never call one:
    -- they take their arguments from the trigger context, not from the caller.
    and p.prorettype <> 'pg_catalog.trigger'::regtype
    -- Skip extension-owned functions; we only want ours.
    and not exists (
      select 1 from pg_depend d
      where d.objid = p.oid and d.deptype = 'e'
    )
  order by p.proname
`)

function tsType(col) {
  // 'A' is the array category; element_type holds what it is an array of.
  if (col.type_category === 'A' && col.element_type) {
    const inner = enumNames.has(col.element_type)
      ? pascal(col.element_type)
      : (SCALARS[col.element_type] ?? 'Json')
    return `${inner}[]`
  }
  if (enumNames.has(col.type_name)) return pascal(col.type_name)
  return SCALARS[col.type_name] ?? 'Json'
}

function pascal(snake) {
  return snake
    .split('_')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('')
}

/**
 * SQL spellings, which are not typname spellings. pg_get_function_arguments
 * says `integer` where pg_type says `int4`, and `timestamp with time zone`
 * where pg_type says `timestamptz`, so the SCALARS table above cannot be
 * reused on its own.
 */
const SQL_SCALARS = {
  boolean: 'boolean',
  smallint: 'number',
  integer: 'number',
  bigint: 'number',
  real: 'number',
  'double precision': 'number',
  numeric: 'number',
  text: 'string',
  'character varying': 'string',
  character: 'string',
  'timestamp without time zone': 'string',
  'timestamp with time zone': 'string',
  'time without time zone': 'string',
  'time with time zone': 'string',
  void: 'undefined',
}

function pgTypeToTs(pgType) {
  let base = pgType.trim().toLowerCase()
  const isArray = base.endsWith('[]')
  if (isArray) base = base.slice(0, -2).trim()
  // character varying(80) -> character varying
  base = base.replace(/\(.*\)$/, '').trim()

  const inner = enumNames.has(base)
    ? pascal(base)
    : (SQL_SCALARS[base] ?? SCALARS[base] ?? 'Json')
  return isArray ? `${inner}[]` : inner
}

/**
 * Parses one pg_get_function_arguments string into named Args entries.
 *
 * The format is built for humans, not parsers: `a text, b integer DEFAULT 5,
 * VARIADIC c text[]`. Splitting on commas alone breaks on numeric(10,2) and on
 * defaults containing commas, so track bracket depth instead.
 */
function parseArgs(signature) {
  if (!signature || !signature.trim()) return []

  const parts = []
  let depth = 0
  let current = ''
  for (const ch of signature) {
    if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth--
    if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim()) parts.push(current)

  const args = []
  for (const part of parts) {
    let text = part.trim()
    // An OUT parameter is part of the result, never part of the call.
    if (/^out\s/i.test(text)) continue
    text = text.replace(/^(?:in|inout|variadic)\s+/i, '')

    const optional = /\sdefault\s/i.test(text)
    text = text.split(/\s+default\s+/i)[0].trim()

    const space = text.indexOf(' ')
    // Unnamed arguments cannot be passed by .rpc(), which only takes an object.
    if (space === -1) continue
    args.push({
      name: text.slice(0, space),
      type: pgTypeToTs(text.slice(space + 1)),
      optional,
    })
  }
  return args
}

/**
 * Return types. TABLE(...) and SETOF both arrive as arrays through PostgREST,
 * and a void function resolves to undefined rather than null.
 */
function returnType(returns) {
  const raw = returns.trim()

  const table = raw.match(/^table\((.*)\)$/is)
  if (table) {
    const cols = parseArgs(table[1])
    if (cols.length === 0) return 'Json[]'
    return `{ ${cols.map((c) => `${c.name}: ${c.type}`).join('; ')} }[]`
  }

  const setof = raw.match(/^setof\s+(.+)$/i)
  if (setof) {
    const target = setof[1].trim()
    if (tables.has(target)) {
      return `Database['public']['Tables']['${target}']['Row'][]`
    }
    return `${pgTypeToTs(target)}[]`
  }

  if (tables.has(raw)) return `Database['public']['Tables']['${raw}']['Row']`
  return pgTypeToTs(raw)
}

const tables = new Map()
for (const col of columns) {
  if (!tables.has(col.table_name)) {
    tables.set(col.table_name, { kind: col.kind, cols: [] })
  }
  tables.get(col.table_name).cols.push(col)
}

const lines = []
lines.push('/**')
lines.push(' * Database types — GENERATED by `npm run gen:types`. Do not edit by hand.')
lines.push(' *')
lines.push(' * Introspected from the live schema, so if a column here is wrong the')
lines.push(' * database is wrong. Regenerate after every migration.')
lines.push(' */')
lines.push('')
lines.push('export type Json =')
lines.push('  | string')
lines.push('  | number')
lines.push('  | boolean')
lines.push('  | null')
lines.push('  | { [key: string]: Json | undefined }')
lines.push('  | Json[]')
lines.push('')

for (const e of enums) {
  lines.push(`export type ${pascal(e.name)} = ${e.labels.map((l) => `'${l}'`).join(' | ')}`)
}
lines.push('')

lines.push('export type Database = {')
lines.push('  public: {')
lines.push('    Tables: {')

for (const [name, { kind, cols }] of [...tables].filter(([, t]) => t.kind === 'r')) {
  lines.push(`      ${name}: {`)
  lines.push('        Row: {')
  for (const col of cols) {
    const nullable = col.not_null ? '' : ' | null'
    lines.push(`          ${col.column_name}: ${tsType(col)}${nullable}`)
  }
  lines.push('        }')

  lines.push('        Insert: {')
  for (const col of cols) {
    // A column is optional on insert when the database can fill it in itself.
    //
    // Three of those the catalogue states outright: nullable, has a DEFAULT, is an
    // identity column. The fourth it cannot — a BEFORE INSERT trigger that assigns
    // the value is invisible here, and pg_trigger would only say the table has one,
    // never which column it writes. Left unhandled, a NOT NULL trigger-assigned
    // column reads as required and every insert in the app fails to typecheck for a
    // value the caller is not allowed to choose.
    //
    // So the column says so itself: `@generated` anywhere in its COMMENT. Declared
    // in the migration next to the trigger that does the assigning, which is the
    // only place that knows, and visible in the database rather than in a list kept
    // over here that nobody updates. fee_payments.receipt_no is the first one.
    const generated = /@generated\b/.test(col.comment ?? '')
    const optional = !col.not_null || col.has_default || col.is_identity || generated ? '?' : ''
    const nullable = col.not_null ? '' : ' | null'
    lines.push(`          ${col.column_name}${optional}: ${tsType(col)}${nullable}`)
  }
  lines.push('        }')

  lines.push('        Update: {')
  for (const col of cols) {
    const nullable = col.not_null ? '' : ' | null'
    lines.push(`          ${col.column_name}?: ${tsType(col)}${nullable}`)
  }
  lines.push('        }')

  const rels = fkeys.filter((f) => f.table_name === name)
  if (rels.length === 0) {
    lines.push('        Relationships: []')
  } else {
    lines.push('        Relationships: [')
    for (const rel of rels) {
      lines.push('          {')
      lines.push(`            foreignKeyName: '${rel.name}'`)
      lines.push(`            columns: [${rel.columns.map((c) => `'${c}'`).join(', ')}]`)
      lines.push(`            isOneToOne: ${rel.is_one_to_one}`)
      lines.push(`            referencedRelation: '${rel.referenced_relation}'`)
      lines.push(
        `            referencedColumns: [${rel.referenced_columns.map((c) => `'${c}'`).join(', ')}]`,
      )
      lines.push('          },')
    }
    lines.push('        ]')
  }
  lines.push('      }')
  void kind
}

lines.push('    }')
lines.push('    Views: {')
for (const [name, { kind, cols }] of [...tables].filter(([, t]) => t.kind !== 'r')) {
  void kind
  lines.push(`      ${name}: {`)
  lines.push('        Row: {')
  for (const col of cols) {
    lines.push(`          ${col.column_name}: ${tsType(col)} | null`)
  }
  lines.push('        }')
  lines.push('        Relationships: []')
  lines.push('      }')
}
lines.push('    }')

if (functions.length === 0) {
  lines.push('    Functions: Record<string, never>')
} else {
  lines.push('    Functions: {')
  for (const fn of functions) {
    const args = parseArgs(fn.args)
    lines.push(`      ${fn.name}: {`)
    if (args.length === 0) {
      lines.push('        Args: Record<PropertyKey, never>')
    } else {
      lines.push('        Args: {')
      for (const arg of args) {
        // A strict function is null-in-null-out, so passing null is pointless
        // and almost always a bug. A non-strict one decides for itself.
        const nullable = fn.strict ? '' : ' | null'
        lines.push(`          ${arg.name}${arg.optional ? '?' : ''}: ${arg.type}${nullable}`)
      }
      lines.push('        }')
    }
    lines.push(`        Returns: ${returnType(fn.returns)}`)
    lines.push('      }')
  }
  lines.push('    }')
}
lines.push('    Enums: {')
for (const e of enums) {
  lines.push(`      ${e.name}: ${pascal(e.name)}`)
}
lines.push('    }')
lines.push('    CompositeTypes: Record<string, never>')
lines.push('  }')
lines.push('}')
lines.push('')

// Shorthands, because `Database['public']['Tables']['students']['Row']` in
// every signature is how a codebase becomes unreadable.
lines.push('export type Tables<T extends keyof Database[\'public\'][\'Tables\']> =')
lines.push('  Database[\'public\'][\'Tables\'][T][\'Row\']')
lines.push('')
lines.push('export type TablesInsert<T extends keyof Database[\'public\'][\'Tables\']> =')
lines.push('  Database[\'public\'][\'Tables\'][T][\'Insert\']')
lines.push('')
lines.push('export type TablesUpdate<T extends keyof Database[\'public\'][\'Tables\']> =')
lines.push('  Database[\'public\'][\'Tables\'][T][\'Update\']')
lines.push('')

writeFileSync('src/lib/supabase/types.ts', lines.join('\n'))

const tableCount = [...tables.values()].filter((t) => t.kind === 'r').length
console.log(
  `Wrote src/lib/supabase/types.ts — ${tableCount} tables, ${enums.length} enums.`,
)

await client.end()
