/**
 * Applies every migration to a throwaway Postgres and reports what was created,
 * then checks the four structural invariants that the whole tenant boundary
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
  // One view sums the expense table, and it is the profit line.
  //
  // 20260811000045 shipped `salary` in the expense category list on purpose — a
  // centre that has not set up per-person salary terms still knows it paid the
  // staff, and refusing the category would send that money to `miscellaneous`
  // where it is invisible instead of merely awkward. Its header then said what
  // has to follow: the profit line must define its expense side as
  // sum(amount_bdt) where category <> 'salary' and take payroll from
  // salary_payments, "and nothing else in the product may sum expenses to get a
  // profit". 20260811000049 built that view. This is the sentence enforced.
  //
  // WHY A SECOND SUMMING VIEW IS A WRONG NUMBER RATHER THAN A DUPLICATE ONE. A
  // centre that pays through payroll and also logs the same money as a `salary`
  // expense has both rows on purpose, and only the `category <> 'salary'` filter
  // keeps that from being subtracted twice. A second view that sums expenses
  // without it does not disagree with the first by a rounding error — it reads a
  // profitable month as a loss, on the screen an owner uses to decide whether to
  // open another branch. Nothing in the schema can tell the two rows apart, so
  // the filter is the whole defence and it has to live in one place.
  //
  // A LEGITIMATE READER WILL EVENTUALLY TRIP THIS, and that is the intended way
  // to use it: MASTERPLAN.md §9.6's expense breakdown is a list rather than a
  // profit figure, and a view for it is fine. Whoever adds one reads this, checks
  // that theirs does not compute a profit, and adds it to the set below. What is
  // not fine is doing that by accident.
  //
  // PAYROLL IS NOT COVERED HERE, deliberately. §9.5 may well want a salary
  // register view, and a second reader of salary_payments is not the same hazard:
  // the double-count comes from the expense side carrying salaries too, so the
  // filter that prevents it is on expenses. The asymmetry is the reasoning, not
  // an omission.
  //
  // pg_depend rather than a grep over pg_views.definition: a dependency is a fact
  // Postgres records, so a column named `expenses_bdt` and the word inside a
  // comment cannot produce a hit, and a view that reads the table under an alias
  // cannot hide from one.
  // -------------------------------------------------------------------------
  const EXPENSE_READERS = new Set(['center_profit_month'])

  const expenseViews = await db.query(`
    select distinct v.relname
    from pg_depend d
    join pg_rewrite r on r.oid = d.objid and d.classid = 'pg_rewrite'::regclass
    join pg_class v on v.oid = r.ev_class and v.relkind = 'v'
    join pg_namespace vn on vn.oid = v.relnamespace and vn.nspname = 'public'
    join pg_class t on t.oid = d.refobjid and d.refclassid = 'pg_class'::regclass
    join pg_namespace tn on tn.oid = t.relnamespace and tn.nspname = 'public'
    where t.relname = 'expenses'
    order by 1;
  `)

  const strayExpenses = expenseViews.rows
    .map((r) => r.relname)
    .filter((name) => !EXPENSE_READERS.has(name))

  const missingProfit = [...EXPENSE_READERS].filter(
    (name) => !expenseViews.rows.some((r) => r.relname === name),
  )

  if (strayExpenses.length > 0 || missingProfit.length > 0) {
    if (strayExpenses.length > 0) {
      console.error(
        `\nEXPENSES SUMMED SOMEWHERE ELSE — ${strayExpenses.length} view(s) besides the profit line read the expense table:\n`,
      )
      for (const name of strayExpenses) console.error(`  ${name}`)
      console.error(
        `
20260811000045's header: nothing else in the product may sum expenses to get a
profit. The reason is the 'salary' expense category, which exists so a centre
without per-person salary terms can still record paying its staff — a centre
that also runs payroll has that money in both tables, and only
center_profit_month's \`category <> 'salary'\` filter stops it being subtracted
twice.

If the view above lists or groups expenses rather than netting them into a
profit — §9.6's breakdown, say — it is fine. Add its name to EXPENSE_READERS in
this file, beside center_profit_month, and say in its own header what it is and
is not.`,
      )
    }
    if (missingProfit.length > 0) {
      console.error(
        `\nPROFIT LINE MISSING — expected view(s) no longer read the expense table:\n`,
      )
      for (const name of missingProfit) console.error(`  ${name}`)
      console.error(
        `
This is the other direction of the same rule. §9.8's profit is collected minus
expenses minus payroll, and a profit line that has stopped reading expenses is
not a profit line — it reports a centre's takings as its earnings. Either the
view was renamed, in which case rename it in EXPENSE_READERS too, or the
expense side was dropped, in which case put it back.`,
      )
    }
    process.exit(1)
  }

  console.log(
    `Expenses: summed by ${expenseViews.rows.length} view(s) — ${expenseViews.rows
      .map((r) => r.relname)
      .join(', ')}.`,
  )

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
the function, in the same statement block, and name BOTH roles:

  revoke all on function <name>(<args>) from public;
  revoke all on function <name>(<args>) from anon;

Either one alone leaves this check failing, and it is worth knowing why before
you write only one of them:

  * Postgres grants EXECUTE on every new function to PUBLIC. Revoking from anon
    does not touch that grant, and has_function_privilege('anon', ...) is
    satisfied *through* PUBLIC — so anon still has it.
  * Supabase then ships its own separate
    "alter default privileges in schema public grant all on functions to anon",
    which is a direct grant to anon that survives a revoke from PUBLIC.

Two independent grants, so two revokes. The four SMS worker functions in
20260811000016 write it as one statement per function,
"from anon, authenticated, public", which is the form to copy.

Name anon explicitly rather than relying on PUBLIC: the argument list has to
match the signature exactly, so an overloaded function needs one revoke per
signature.

If a function genuinely must serve signed-out callers, it needs a comment in the
migration saying why, and this check needs to learn about it deliberately.`,
    )
    process.exit(1)
  }

  console.log(
    `Functions: ${ourFunctions.rows[0].n} of ours in public, none callable by anon.`,
  )

  // -------------------------------------------------------------------------
  // Every SECURITY DEFINER function must pin an empty search_path.
  //
  // These nineteen functions are the most privileged code in the database. They
  // run as their owner — the migration role, which bypasses RLS — and that is
  // the entire point of them: app.member_center_ids() has to read
  // center_members past the policies that are asking it who you are.
  //
  // An unqualified name inside the body resolves through the *caller's*
  // search_path. So without a pin, the caller chooses which table the
  // owner-privileged body reads. Measured on this schema, not reasoned about:
  // a security definer `select count(*) from students` pinned to `public`
  // returned 0, and after `create temp table students (id uuid)` with two rows
  // in it, the same function returned 2. It read the caller's table as the
  // owner. Creating a temp table needs no grant — every signed-in role can.
  //
  // WHY THE EMPTY STRING AND NOT MERELY SOME PIN. `set search_path = public`
  // is what the check above would accept if it only looked for the setting's
  // presence, and it is exactly the case that was hijacked: the temp schema is
  // searched ahead of the listed schemas unless `pg_temp` is written last. With
  // `= ''` nothing unqualified resolves at all — the probe failed at call time
  // with `relation "students" does not exist` — so the body has to name
  // `public.students`, and a qualified name never consults the path. The empty
  // pin is fail-closed; a schema pin is fail-quiet, and quiet is what a
  // migration author would ship.
  //
  // ALL OUR SCHEMAS, NOT JUST PUBLIC — 17 of the 19 are app.* RLS helpers, and
  // they are the higher-stakes half. They are not exposed through PostgREST, so
  // nobody can POST to them; they do not need to. Every authenticated request
  // that touches a tenant table calls them implicitly from inside a policy.
  // Hijacking one does not leak a single function's rows — it changes the answer
  // to "which centre is this caller in" underneath all 63 policies at once.
  //
  // Written as a deny-list so the default is checked: a schema a future
  // migration creates is covered without anyone remembering to edit this.
  // -------------------------------------------------------------------------
  const OUR_SCHEMAS = `n.nspname !~ '^pg_' and n.nspname not in ('information_schema', 'auth')`

  // proconfig is a text[] of `name=value`. Postgres stores the empty pin as the
  // five characters `search_path=""`, so the value we require is `""` — read by
  // stripping the prefix rather than splitting on '=', which would truncate any
  // value containing one.
  const SEARCH_PATH = `
    coalesce(
      (select substr(c, length('search_path=') + 1)
       from unnest(p.proconfig) c
       where c like 'search_path=%'),
      '(not set)'
    )`

  const unpinned = await db.query(`
    select n.nspname as schema, p.proname,
           pg_get_function_identity_arguments(p.oid) as args,
           ${SEARCH_PATH} as path
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef
      and ${OUR_SCHEMAS}
      and ${NOT_FROM_EXTENSION}
      and ${SEARCH_PATH} <> '""'
    order by n.nspname, p.proname;
  `)

  const definers = await db.query(`
    select count(*)::int as n
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef and ${OUR_SCHEMAS} and ${NOT_FROM_EXTENSION};
  `)

  if (unpinned.rows.length > 0) {
    console.error(
      `\nSECURITY DEFINER WITHOUT AN EMPTY search_path — ${unpinned.rows.length} function(s) let the caller decide what they read:\n`,
    )
    for (const f of unpinned.rows) {
      console.error(
        `  ${f.schema}.${f.proname}(${f.args})   search_path = ${f.path}`,
      )
    }
    console.error(
      `
Each of these runs as its owner, which bypasses RLS, and resolves unqualified
names through the caller's search_path. A caller who can create a temp table —
which is every signed-in role — can hand it a different table to read. Add the
clause to the function, between the language and the body:

  language plpgsql
  security definer
  set search_path = ''
  as $$ ... $$;

and qualify every reference in the body: public.students, not students. That
part is not optional and not a style choice — with an empty path an unqualified
name raises "relation ... does not exist" the first time the function is called,
which is the check doing its job at runtime.

"(not set)" means no clause at all. Any other value means the clause is there
and pinned to a schema, which is NOT sufficient: the temporary schema is
searched ahead of the listed ones unless pg_temp is written last, so a schema
pin is the case this check was written after measuring.

If a function genuinely cannot be fully qualified, it does not need SECURITY
DEFINER — drop that instead and let RLS apply to it.`,
    )
    process.exit(1)
  }

  console.log(
    `Security definer: ${definers.rows[0].n} function(s), all pinned to an empty search_path.`,
  )

  // -------------------------------------------------------------------------
  // Every tap-to-send receipt table must be counted by the founder panel.
  //
  // Unlike the four above, this one is not about the tenant boundary. It is
  // about a mistake that has now been made three times in a row, silently, and
  // will keep being made: 20260811000020 counted fee_reminders because it was
  // the only message a centre could send; /progress shipped and needed
  // 20260811000022 to be seen at all; then result_notices and absence_notices
  // shipped and nobody remembered, so a centre whose teachers messaged forty
  // parents last month read as a centre that sent nothing.
  //
  // WHY A BUILD FAILURE. platform_centers() is the only evidence the roadmap
  // has. A zero on that screen meaning "not wired up" is indistinguishable from
  // a zero meaning "nobody used it", and the second is a reason to delete a
  // feature. Nothing else fails when a table is missed — the panel keeps
  // working, the tests keep passing, and the number is simply wrong.
  //
  // THE SHAPE, not a list of names. These tables are all the same table with a
  // different parent: the tenant, an outreach_channel, the number it was aimed
  // at, the text put in front of whoever tapped, and who tapped. Five columns
  // together are specific enough that nothing else in the schema matches, and
  // general enough that the fifth one is caught the day it is created rather
  // than the day somebody re-reads this script.
  //
  // Read out of prosrc, which is textual — and reliable here precisely because
  // the function is pinned to an empty search_path, so it cannot name a table
  // any way other than `public.<name>`.
  // -------------------------------------------------------------------------
  const RECEIPT_SHAPE = `
    (select count(*) from pg_attribute a
     join pg_type ty on ty.oid = a.atttypid
     where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
       and (
            a.attname = 'coaching_center_id'
         or a.attname = 'to_phone'
         or a.attname = 'body'
         or a.attname = 'sent_by'
         or (a.attname = 'channel' and ty.typname = 'outreach_channel')
       )) = 5`

  const PANEL_BODY = `
    coalesce(
      (select p.prosrc
       from pg_proc p
       join pg_namespace pn on pn.oid = p.pronamespace and pn.nspname = 'public'
       where p.proname = 'platform_centers'),
      ''
    )`

  const receipts = await db.query(`
    select c.relname,
           strpos(${PANEL_BODY}, 'public.' || c.relname) > 0 as counted
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where c.relkind = 'r' and ${RECEIPT_SHAPE}
    order by c.relname;
  `)

  const uncounted = receipts.rows.filter((r) => !r.counted)

  if (receipts.rows.length === 0) {
    console.error(
      `\nOUTREACH RECEIPT SHAPE MATCHED NOTHING — this check has stopped checking.

fee_reminders, progress_updates, result_notices and absence_notices all carry
coaching_center_id, channel, to_phone, body and sent_by. If none of them match,
one of those columns has been renamed and this script is now silently passing.
Fix the shape above, do not delete the check.`,
    )
    process.exit(1)
  }

  if (uncounted.length > 0) {
    console.error(
      `\nMESSAGE TABLE THE FOUNDER PANEL CANNOT SEE — ${uncounted.length} tap-to-send receipt table(s) are not counted by platform_centers():\n`,
    )
    for (const r of uncounted) console.error(`  ${r.relname}`)
    console.error(
      `
Every one of these records a message that left somebody's phone, and the founder
panel is the only place that fact is ever read. Add a CTE to platform_centers()
in a new migration, the way 20260811000034 added two, plus an output column and
a name in greatest() so the send counts as a sign of life:

  <name>s as (
    select x.coaching_center_id, count(*)::int as n, max(x.created_at) as at
    from public.<table> x
    cross join cutoff k
    where x.created_at >= k.ts
    group by x.coaching_center_id
  ),

then carry it through src/lib/platform/centers.ts, the CSV headings in both
dictionaries, and the panel-count assertions in scripts/test-rls.mjs.

Do not fold it into taps_30d. The counts are kept apart because which message a
centre actually sends is the one thing this screen is read for, and a sum cannot
be un-summed.

If a receipt table genuinely should not be counted — a draft, a queue, something
the owner never taps — this check needs to learn about it deliberately.`,
    )
    process.exit(1)
  }

  console.log(
    `Founder panel: ${receipts.rows.length} tap-to-send table(s) (${receipts.rows
      .map((r) => r.relname)
      .join(', ')}), all counted.`,
  )

  // -------------------------------------------------------------------------
  // No table in public may leave TRUNCATE with a signed-in request.
  //
  // Supabase ships
  //
  //   alter default privileges in schema public grant all on tables to anon,
  //     authenticated, service_role
  //
  // and `all` on a table includes TRUNCATE. So every `create table` in this
  // schema hands out the right to empty it, to every signed-in user and to
  // signed-out ones, without any migration saying so.
  //
  // What makes that worth a build failure rather than a note is what TRUNCATE
  // does to the rest of the schema's promises. A row trigger does not fire for
  // it: the append-only guards on fee_payments, salary_payments and expenses all
  // refuse a DELETE row by row and see nothing at all, and 20260811000046's audit
  // log would record no line for a table emptied in one statement. It is the one
  // write in Postgres that is invisible to every mechanism this database uses to
  // make money and history hard to rewrite.
  //
  // It is held rather than reachable today, because PostgREST has no verb that
  // issues a TRUNCATE — which is exactly why it needs a gate instead of a test.
  // Nothing an integration test can do will notice the privilege, and the day
  // something can reach it is not the day to find out who holds it.
  //
  // 20260811000046 closed the whole class with one statement. That statement
  // cannot reach a table created after it, so this check is the part that lasts:
  // a migration that adds a table now fails here until it says what it means.
  // -------------------------------------------------------------------------
  const truncatable = await db.query(`
    select c.relname, r.rolname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    cross join (values ('authenticated'), ('anon')) as r(rolname)
    where c.relkind in ('r', 'p')
      and pg_catalog.has_table_privilege(r.rolname, c.oid, 'TRUNCATE')
    order by c.relname, r.rolname;
  `)

  if (truncatable.rows.length > 0) {
    console.error(
      `\nTRUNCATE IS GRANTED — ${truncatable.rows.length} table/role pair(s) let a request empty a table in one statement:\n`,
    )
    for (const t of truncatable.rows) console.error(`  ${t.relname} → ${t.rolname}`)
    console.error(
      `
No trigger fires for a TRUNCATE, so every append-only guard in this schema and
every line the audit log would have written are bypassed at once. Supabase's
default privileges granted this; the table did not ask for it.

Add it to the end of the migration that creates the table:

  revoke truncate on public.<table> from authenticated, anon;

service_role keeps it, because a support request has to be answerable.

If a table genuinely should be emptiable by a signed-in user, this check needs to
learn about it deliberately — and whatever writes it should be a function with a
name, not a privilege nobody granted on purpose.`,
    )
    process.exit(1)
  }

  console.log('TRUNCATE: not held by authenticated or anon on any table.')

  await db.close()
} catch (error) {
  console.error(`\nMIGRATION FAILED\n${error.message}`)
  process.exit(1)
}
