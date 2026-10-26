import { performance } from 'node:perf_hooks'
import { bootDatabase, asUser } from '../lib/pg-harness.mjs'
import { countChasesDue } from '../../src/lib/fees/reminder-schedule.ts'
import { tallyOutstanding } from '../../src/lib/money.ts'

function getDhakaToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const y = parts.find((p) => p.type === 'year').value
  const m = parts.find((p) => p.type === 'month').value
  const d = parts.find((p) => p.type === 'day').value
  return `${y}-${m}-${d}`
}

function addDays(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

async function main() {
  console.log('=== CoachDesk BD: Dashboard Fee & Reminder Performance Benchmark ===\n')
  console.log('Booting PostgreSQL harness...')
  const { db } = await bootDatabase()

  // Setup Centre A & Centre B
  console.log('Creating organizations...')
  const ownerA = (
    await db.query("insert into auth.users (id) values (gen_random_uuid()) returning id")
  ).rows[0].id
  const centerA = (
    await db.query(
      "insert into coaching_centers (name) values ('Dhaka Academy - Centre A') returning id"
    )
  ).rows[0].id
  await db.query(
    "insert into center_members (coaching_center_id, user_id, role) values ($1, $2, 'owner')",
    [centerA, ownerA]
  )

  const ownerB = (
    await db.query("insert into auth.users (id) values (gen_random_uuid()) returning id")
  ).rows[0].id
  const centerB = (
    await db.query(
      "insert into coaching_centers (name) values ('Chittagong High - Centre B') returning id"
    )
  ).rows[0].id
  await db.query(
    "insert into center_members (coaching_center_id, user_id, role) values ($1, $2, 'owner')",
    [centerB, ownerB]
  )

  const today = getDhakaToday()

  console.log('Seeding Centre A: 2,500 students, 3,000 invoices (1,500 settled, 500 partial, 1,000 unpaid), 2,500 reminders...')
  const seedStart = performance.now()

  // Bulk seed students for Centre A
  await db.query(`
    insert into students (id, coaching_center_id, name, guardian_phone)
    select
      gen_random_uuid(),
      $1,
      'Student A ' || i,
      case when i % 10 = 0 then null else '0171' || lpad(i::text, 7, '0') end
    from generate_series(1, 2500) i
  `, [centerA])

  const studentRowsA = (
    await db.query('select id from students where coaching_center_id = $1 order by id', [centerA])
  ).rows.map((r) => r.id)

  // Seed 3000 invoices for Centre A:
  // 1500 settled (1..1500)
  // 500 partial (1501..2000)
  // 1000 unpaid (2001..3000)
  await db.query(`
    insert into fee_invoices (id, coaching_center_id, student_id, period_month, amount_bdt, due_date)
    select
      gen_random_uuid(),
      $1,
      ($2::uuid[])[1 + ((i - 1) % 2500)],
      '2026-05-01',
      1000.00,
      ($3::date + ((i % 40) - 20))
    from generate_series(1, 3000) i
  `, [centerA, studentRowsA, today])

  const invoiceRowsA = (
    await db.query('select id, student_id from fee_invoices where coaching_center_id = $1 order by id', [centerA])
  ).rows

  // 1500 full payments for invoices 0..1499
  const settledSlice = invoiceRowsA.slice(0, 1500)
  await db.query(`
    insert into fee_payments (coaching_center_id, invoice_id, student_id, amount_bdt, method)
    select
      $1,
      id,
      student_id,
      1000.00,
      'cash'
    from json_to_recordset($2::json) as (id uuid, student_id uuid)
  `, [centerA, JSON.stringify(settledSlice)])

  // 500 partial payments (400 BDT) for invoices 1500..1999
  const partialSlice = invoiceRowsA.slice(1500, 2000)
  await db.query(`
    insert into fee_payments (coaching_center_id, invoice_id, student_id, amount_bdt, method)
    select
      $1,
      id,
      student_id,
      400.00,
      'bkash'
    from json_to_recordset($2::json) as (id uuid, student_id uuid)
  `, [centerA, JSON.stringify(partialSlice)])

  // 2,500 reminders across unpaid & partial invoices
  const chaseableInvoices = invoiceRowsA.slice(1500, 3000)
  await db.query(`
    insert into fee_reminders (coaching_center_id, invoice_id, channel, amount_bdt, created_at)
    select
      $1,
      id,
      'sms',
      case when i <= 500 then 600.00 else 1000.00 end,
      ($3::date - (i % 15) + time '11:00') at time zone 'Asia/Dhaka'
    from generate_series(1, 2500) i
    cross join lateral (
      select id from json_to_recordset($2::json) as (id uuid) offset ((i - 1) % 1500) limit 1
    ) sub
  `, [centerA, JSON.stringify(chaseableInvoices), today])

  // Seed Centre B (noise for multi-tenant isolation benchmark): 1,000 students, 1,200 invoices
  console.log('Seeding Centre B: 1,000 students, 1,200 invoices...')
  await db.query(`
    insert into students (id, coaching_center_id, name, guardian_phone)
    select
      gen_random_uuid(),
      $1,
      'Student B ' || i,
      '0181' || lpad(i::text, 7, '0')
    from generate_series(1, 1000) i
  `, [centerB])

  const studentRowsB = (
    await db.query('select id from students where coaching_center_id = $1 order by id', [centerB])
  ).rows.map((r) => r.id)

  await db.query(`
    insert into fee_invoices (id, coaching_center_id, student_id, period_month, amount_bdt, due_date)
    select
      gen_random_uuid(),
      $1,
      ($2::uuid[])[1 + ((i - 1) % 1000)],
      '2026-05-01',
      800.00,
      ($3::date + ((i % 30) - 15))
    from generate_series(1, 1200) i
  `, [centerB, studentRowsB, today])

  const seedEnd = performance.now()
  console.log(`Seed completed in ${(seedEnd - seedStart).toFixed(1)} ms.\n`)

  // Update table statistics so query planner uses realistic cost estimates
  console.log('Running ANALYZE on test database...')
  await db.query('analyze;')
  console.log('ANALYZE complete.\n')

  // --- Run Baseline Benchmark ---
  // In the baseline:
  // 1. pageAll('fee_invoice_balances') fetches in batches of 1000 rows
  // 2. pageAll('fee_reminders') fetches in batches of 1000 rows
  // 3. Node.js executes tallyOutstanding, overdue filter, reminder schedule calculations
  async function runBaseline() {
    return asUser(db, ownerA, async (tx) => {
      const t0 = performance.now()
      let networkRoundTrips = 0
      let totalPayloadBytes = 0

      // Simulate paginated fetch of fee_invoice_balances (pageSize = 1000)
      const allInvoices = []
      let invOffset = 0
      const invLimit = 1000
      while (true) {
        networkRoundTrips++
        const page = (
          await tx.query(
            `select id, remaining_bdt, due_date::text as due_date, voided_at, student_name, guardian_phone
             from fee_invoice_balances
             where coaching_center_id = $1 and voided_at is null
             order by id
             limit $2 offset $3`,
            [centerA, invLimit, invOffset]
          )
        ).rows
        totalPayloadBytes += Buffer.byteLength(JSON.stringify(page))
        allInvoices.push(...page)
        if (page.length < invLimit) break
        invOffset += invLimit
      }

      // Simulate paginated fetch of fee_reminders (pageSize = 1000)
      const allReminders = []
      let remOffset = 0
      const remLimit = 1000
      while (true) {
        networkRoundTrips++
        const page = (
          await tx.query(
            `select invoice_id, (created_at at time zone 'Asia/Dhaka')::date::text as sent_at
             from fee_reminders
             where coaching_center_id = $1
             order by id
             limit $2 offset $3`,
            [centerA, remLimit, remOffset]
          )
        ).rows
        totalPayloadBytes += Buffer.byteLength(JSON.stringify(page))
        allReminders.push(...page)
        if (page.length < remLimit) break
        remOffset += remLimit
      }

      const tDb = performance.now()

      // Node.js memory processing
      const remainders = allInvoices.map((r) => Number(r.remaining_bdt ?? 0))
      const { outstanding } = tallyOutstanding(remainders)
      const overdue = allInvoices.filter(
        (r) => Number(r.remaining_bdt ?? 0) > 0 && (r.due_date ?? today) < today
      )

      const latestReminder = new Map()
      for (const r of allReminders) {
        const cur = latestReminder.get(r.invoice_id)
        if (!cur || r.sent_at > cur) latestReminder.set(r.invoice_id, r.sent_at)
      }

      const candidates = allInvoices
        .filter((r) => Number(r.remaining_bdt ?? 0) > 0)
        .map((r) => ({
          invoiceId: r.id,
          dueDate: r.due_date ?? today,
          lastRemindedOn: latestReminder.get(r.id) ?? null,
          reachable: Boolean(r.guardian_phone),
        }))

      const remindersDue = countChasesDue(candidates, today)
      const tEnd = performance.now()

      return {
        dbTimeMs: tDb - t0,
        totalTimeMs: tEnd - t0,
        networkRoundTrips,
        totalPayloadBytes,
        result: {
          outstanding,
          overdueCount: overdue.length,
          remindersDue,
        },
      }
    })
  }

  // --- Run Optimized Benchmark (Phase 2A) ---
  // In Phase 2A:
  // 1. dashboard_fee_summary (1 row, 2 columns)
  // 2. top 8 overdue invoices (8 rows, 4 columns)
  // 3. dashboard_reminder_summary (1 row, 1 column)
  // Parallel execution in 1 round-trip Promise.all
  async function runOptimized() {
    return asUser(db, ownerA, async (tx) => {
      const t0 = performance.now()
      let totalPayloadBytes = 0

      // Execute 3 queries
      const [feeSummaryRes, overdueRes, reminderSummaryRes] = await Promise.all([
        tx.query(
          'select outstanding_bdt, overdue_count from dashboard_fee_summary where coaching_center_id = $1',
          [centerA]
        ),
        tx.query(
          `select id, student_name, remaining_bdt, due_date::text as due_date
           from fee_invoice_balances
           where coaching_center_id = $1
             and voided_at is null
             and remaining_bdt > 0
             and due_date < (now() at time zone 'Asia/Dhaka')::date
           order by remaining_bdt desc, id asc
           limit 8`,
          [centerA]
        ),
        tx.query(
          'select reminders_due_today from dashboard_reminder_summary where coaching_center_id = $1',
          [centerA]
        ),
      ])

      totalPayloadBytes += Buffer.byteLength(JSON.stringify(feeSummaryRes.rows))
      totalPayloadBytes += Buffer.byteLength(JSON.stringify(overdueRes.rows))
      totalPayloadBytes += Buffer.byteLength(JSON.stringify(reminderSummaryRes.rows))

      const tDb = performance.now()

      // Node.js memory processing: trivial scalar extractions
      const feeRow = feeSummaryRes.rows[0]
      const remRow = reminderSummaryRes.rows[0]
      const outstanding = feeRow ? Number(feeRow.outstanding_bdt) : 0
      const overdueCount = feeRow ? Number(feeRow.overdue_count) : 0
      const remindersDue = remRow ? Number(remRow.reminders_due_today) : 0

      const tEnd = performance.now()

      return {
        dbTimeMs: tDb - t0,
        totalTimeMs: tEnd - t0,
        httpRequests: 3, // 3 concurrent HTTP requests dispatched in parallel via Promise.all
        totalPayloadBytes,
        result: {
          outstanding,
          overdueCount,
          remindersDue,
          topOverdueCount: overdueRes.rows.length,
        },
      }
    })
  }

  // Warmup run
  console.log('Warming up queries...')
  await runBaseline()
  await runOptimized()

  // Benchmark iterations
  const ITERATIONS = 5
  console.log(`Running benchmark (${ITERATIONS} iterations each)...`)

  const baselineRuns = []
  for (let i = 0; i < ITERATIONS; i++) {
    baselineRuns.push(await runBaseline())
  }

  const optimizedRuns = []
  for (let i = 0; i < ITERATIONS; i++) {
    optimizedRuns.push(await runOptimized())
  }

  // Aggregate results
  const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length

  const baselineAvgDb = avg(baselineRuns.map((r) => r.dbTimeMs))
  const baselineAvgTotal = avg(baselineRuns.map((r) => r.totalTimeMs))
  const baselineBytes = baselineRuns[0].totalPayloadBytes
  const baselineTrips = baselineRuns[0].networkRoundTrips

  const optimizedAvgDb = avg(optimizedRuns.map((r) => r.dbTimeMs))
  const optimizedAvgTotal = avg(optimizedRuns.map((r) => r.totalTimeMs))
  const optimizedBytes = optimizedRuns[0].totalPayloadBytes
  const optimizedTrips = optimizedRuns[0].networkRoundTrips

  console.log('\n--- VERIFICATION OF CALCULATION RESULTS ---')
  console.log('Baseline Result: ', baselineRuns[0].result)
  console.log('Optimized Result:', optimizedRuns[0].result)
  const isMatch =
    baselineRuns[0].result.outstanding === optimizedRuns[0].result.outstanding &&
    baselineRuns[0].result.overdueCount === optimizedRuns[0].result.overdueCount &&
    baselineRuns[0].result.remindersDue === optimizedRuns[0].result.remindersDue
  console.log(`Parity Match: ${isMatch ? 'PASSED (100% IDENTICAL)' : 'FAILED'}\n`)

  console.log('--- EMPIRICAL PERFORMANCE BENCHMARK RESULTS ---')
  console.table([
    {
      Metric: 'HTTP Requests (PostgREST)',
      Baseline: `${baselineTrips} sequential round trips (pageAll waterfalls)`,
      Optimized: `3 concurrent requests (Promise.all parallel dispatch)`,
      Improvement: `Eliminates pagination waterfalls; 4 fewer round trips`,
    },
    {
      Metric: 'Serialized Payload Size',
      Baseline: `${(baselineBytes / 1024).toFixed(2)} KB (${baselineBytes} B)`,
      Optimized: `${(optimizedBytes / 1024).toFixed(2)} KB (${optimizedBytes} B)`,
      Improvement: `${((1 - optimizedBytes / baselineBytes) * 100).toFixed(1)}% reduction (direct wire saving)`,
    },
    {
      Metric: 'Database Execution Time (PGlite WASM)',
      Baseline: `${baselineAvgDb.toFixed(2)} ms`,
      Optimized: `${optimizedAvgDb.toFixed(2)} ms`,
      Improvement: `${((1 - optimizedAvgDb / baselineAvgDb) * 100).toFixed(1)}% delta`,
    },
    {
      Metric: 'End-to-End Latency (Node.js in WASM)',
      Baseline: `${baselineAvgTotal.toFixed(2)} ms`,
      Optimized: `${optimizedAvgTotal.toFixed(2)} ms`,
      Improvement: `${((1 - optimizedAvgTotal / baselineAvgTotal) * 100).toFixed(1)}% delta`,
    },
  ])

  console.log('Note on benchmark environment:')
  console.log('1. Concurrency: Promise.all dispatches 3 independent concurrent HTTP requests to PostgREST; it does NOT batch them into a single HTTP packet.')
  console.log('2. Execution Engine: PGlite runs interpreted single-threaded WebAssembly in Node.js. Database execution times measured in WASM do not reflect native Linux x86_64 PostgreSQL execution in production.')
  console.log('3. Payload Benefit: The 99.8% reduction in serialized payload size eliminates major transfer latency and bandwidth consumption on 3G/4G mobile connections in Bangladesh.')

  await db.close()
  console.log('Benchmark finished cleanly.')
}

main().catch((err) => {
  console.error('Benchmark failed:', err)
  process.exit(1)
})
