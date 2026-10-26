import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bootDatabase, asUser } from '../scripts/lib/pg-harness.mjs'
import {
  countChasesDue,
  type ChaseCandidate,
} from '../src/lib/fees/reminder-schedule.ts'
import { tallyOutstanding } from '../src/lib/money.ts'

// Predictable Dhaka date helper
function getDhakaToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const y = parts.find((p) => p.type === 'year')!.value
  const m = parts.find((p) => p.type === 'month')!.value
  const d = parts.find((p) => p.type === 'day')!.value
  return `${y}-${m}-${d}`
}

function addDays(isoDate: string, days: number): string {
  const [y, dMonth, dDay] = isoDate.split('-').map(Number)
  const dt = new Date(Date.UTC(y, dMonth - 1, dDay))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

test('dashboard SQL aggregation vs JavaScript parity across 12 edge cases', async (t) => {
  const { db } = await bootDatabase()

  // Drop not-null on due_date specifically so we can exercise the null due_date edge case
  await db.exec('alter table fee_invoices alter column due_date drop not null;')

  // Create isolated coaching center and owner
  const ownerId: string = (
    (await db.query("insert into auth.users (id) values (gen_random_uuid()) returning id")) as any
  ).rows[0].id
  const centerId: string = (
    (await db.query("insert into coaching_centers (name) values ('Parity Center') returning id")) as any
  ).rows[0].id
  await db.query(
    "insert into center_members (coaching_center_id, user_id, role) values ($1, $2, 'owner')",
    [centerId, ownerId]
  )

  const today = getDhakaToday()

  // Helper to create a student
  async function createStudent(name: string, phone: string | null): Promise<string> {
    return (
      (await db.query(
        "insert into students (coaching_center_id, name, guardian_phone) values ($1, $2, $3) returning id",
        [centerId, name, phone]
      )) as any
    ).rows[0].id
  }

  // Helper to query SQL views as owner
  async function querySqlSummaries() {
    return asUser(db, ownerId, async (tx: any) => {
      const feeRow = (
        await tx.query(
          'select * from dashboard_fee_summary where coaching_center_id = $1',
          [centerId]
        )
      ).rows[0]
      const remRow = (
        await tx.query(
          'select * from dashboard_reminder_summary where coaching_center_id = $1',
          [centerId]
        )
      ).rows[0]

      return {
        outstanding: feeRow ? Number(feeRow.outstanding_bdt) : 0,
        overdueCount: feeRow ? Number(feeRow.overdue_count) : 0,
        remindersDue: remRow ? Number(remRow.reminders_due_today) : 0,
      }
    })
  }

  // Helper to calculate JS figures from raw invoice balances & reminders
  async function calculateJsSummaries() {
    return asUser(db, ownerId, async (tx: any) => {
      // Cast due_date to text so node-postgres returns string 'YYYY-MM-DD'
      const invoices = (
        (await tx.query(
          `select id, remaining_bdt, due_date::text as due_date, voided_at, guardian_phone
           from fee_invoice_balances
           where coaching_center_id = $1
             and voided_at is null`,
          [centerId]
        )) as any
      ).rows

      // Fetch all reminders, casting created_at to Dhaka date string
      const reminders = (
        (await tx.query(
          `select invoice_id, (created_at at time zone 'Asia/Dhaka')::date::text as created_on
           from fee_reminders
           where coaching_center_id = $1`,
          [centerId]
        )) as any
      ).rows

      const remainders = (invoices as any[]).map((r: any) => Number(r.remaining_bdt ?? 0))
      const { outstanding } = tallyOutstanding(remainders)
      const overdue = (invoices as any[]).filter(
        (r: any) => Number(r.remaining_bdt ?? 0) > 0 && (r.due_date ?? today) < today
      )

      // Latest reminder lookup per invoice
      const latestReminder = new Map<string, string>()
      for (const r of reminders as any[]) {
        const cur = latestReminder.get(r.invoice_id)
        if (!cur || r.created_on > cur) latestReminder.set(r.invoice_id, r.created_on)
      }

      // Exact replica of dashboard/page.tsx candidate mapping:
      const candidates: ChaseCandidate[] = (invoices as any[])
        .filter((r: any) => Number(r.remaining_bdt ?? 0) > 0)
        .map((r: any) => ({
          invoiceId: r.id,
          dueDate: r.due_date ?? today,
          lastRemindedOn: latestReminder.get(r.id) ?? null,
          reachable: Boolean(r.guardian_phone),
        }))

      const remindersDue = countChasesDue(candidates, today)

      return {
        outstanding,
        overdueCount: overdue.length,
        remindersDue,
      }
    })
  }

  async function resetData() {
    await db.query('delete from fee_reminders where coaching_center_id = $1', [centerId])
    await db.query('delete from fee_payments where coaching_center_id = $1', [centerId])
    await db.query('delete from fee_invoices where coaching_center_id = $1', [centerId])
    await db.query('delete from students where coaching_center_id = $1', [centerId])
  }

  // 1. No invoices (0 rows, fallback to 0)
  await t.test('1. No invoices (0 rows fallback)', async () => {
    try {
      const sql = await querySqlSummaries()
      const js = await calculateJsSummaries()

      assert.equal(sql.outstanding, 0)
      assert.equal(sql.overdueCount, 0)
      assert.equal(sql.remindersDue, 0)
      assert.deepEqual(sql, js)
    } finally {
      await resetData()
    }
  })

  // 2. Single valid future invoice
  await t.test('2. Single valid future invoice (due today + 10)', async () => {
    try {
      const stId = await createStudent('Student 2', '01711000002')
      await db.query(
        `insert into fee_invoices (coaching_center_id, student_id, period_month, amount_bdt, due_date)
         values ($1, $2, '2026-06-01', 1500, $3)`,
        [centerId, stId, addDays(today, 10)]
      )

      const sql = await querySqlSummaries()
      const js = await calculateJsSummaries()

      assert.equal(sql.outstanding, 1500)
      assert.equal(sql.overdueCount, 0)
      assert.equal(sql.remindersDue, 0)
      assert.deepEqual(sql, js)
    } finally {
      await resetData()
    }
  })

  // 3. Null due date
  await t.test('3. Null due date (coalesced to today for reminders, non-overdue)', async () => {
    try {
      const stId = await createStudent('Student 3', '01711000003')
      await db.query(
        `insert into fee_invoices (coaching_center_id, student_id, period_month, amount_bdt, due_date)
         values ($1, $2, '2026-06-01', 2000, null)`,
        [centerId, stId]
      )

      const sql = await querySqlSummaries()
      const js = await calculateJsSummaries()

      // Outstanding = 2000, overdue = 0 (due_date < today is false), remindersDue = 1 (stage = 'due')
      assert.equal(sql.outstanding, 2000)
      assert.equal(sql.overdueCount, 0)
      assert.equal(sql.remindersDue, 1)
      assert.deepEqual(sql, js)
    } finally {
      await resetData()
    }
  })

  // 4. Partial payments (remaining_bdt > 0)
  await t.test('4. Partial payment (remaining_bdt = 600 of 1000)', async () => {
    try {
      const stId = await createStudent('Student 4', '01711000004')
      const invId = (
        (await db.query(
          `insert into fee_invoices (coaching_center_id, student_id, period_month, amount_bdt, due_date)
           values ($1, $2, '2026-06-01', 1000, $3) returning id`,
          [centerId, stId, addDays(today, -5)]
        )) as any
      ).rows[0].id
      await db.query(
        `insert into fee_payments (coaching_center_id, invoice_id, student_id, amount_bdt, method)
         values ($1, $2, $3, 400, 'cash')`,
        [centerId, invId, stId]
      )

      const sql = await querySqlSummaries()
      const js = await calculateJsSummaries()

      assert.equal(sql.outstanding, 600)
      assert.equal(sql.overdueCount, 1)
      assert.equal(sql.remindersDue, 1) // stage 'due'
      assert.deepEqual(sql, js)
    } finally {
      await resetData()
    }
  })

  // 5. Fully paid / settled (remaining_bdt = 0, excluded)
  await t.test('5. Fully paid / settled (remaining_bdt = 0)', async () => {
    try {
      const stId = await createStudent('Student 5', '01711000005')
      const invId = (
        (await db.query(
          `insert into fee_invoices (coaching_center_id, student_id, period_month, amount_bdt, due_date)
           values ($1, $2, '2026-06-01', 1000, $3) returning id`,
          [centerId, stId, addDays(today, -5)]
        )) as any
      ).rows[0].id
      await db.query(
        `insert into fee_payments (coaching_center_id, invoice_id, student_id, amount_bdt, method)
         values ($1, $2, $3, 1000, 'cash')`,
        [centerId, invId, stId]
      )

      const sql = await querySqlSummaries()
      const js = await calculateJsSummaries()

      assert.equal(sql.outstanding, 0)
      assert.equal(sql.overdueCount, 0)
      assert.equal(sql.remindersDue, 0)
      assert.deepEqual(sql, js)
    } finally {
      await resetData()
    }
  })

  // 6. Voided invoices (voided_at is not null, excluded)
  await t.test('6. Voided invoices (voided_at is not null)', async () => {
    try {
      const stId = await createStudent('Student 6', '01711000006')
      const invId = (
        (await db.query(
          `insert into fee_invoices (coaching_center_id, student_id, period_month, amount_bdt, due_date)
           values ($1, $2, '2026-06-01', 1000, $3) returning id`,
          [centerId, stId, addDays(today, -5)]
        )) as any
      ).rows[0].id
      await db.query(
        `update fee_invoices set voided_at = now(), void_reason = 'mistake' where id = $1`,
        [invId]
      )

      const sql = await querySqlSummaries()
      const js = await calculateJsSummaries()

      assert.equal(sql.outstanding, 0)
      assert.equal(sql.overdueCount, 0)
      assert.equal(sql.remindersDue, 0)
      assert.deepEqual(sql, js)
    } finally {
      await resetData()
    }
  })

  // 7. Whitespace-only phone ("   ")
  await t.test('7. Whitespace-only phone ("   ")', async () => {
    try {
      const stId = await createStudent('Student 7', '   ')
      await db.query(
        `insert into fee_invoices (coaching_center_id, student_id, period_month, amount_bdt, due_date)
         values ($1, $2, '2026-06-01', 750, $3)`,
        [centerId, stId, addDays(today, -2)]
      )

      const sql = await querySqlSummaries()
      const js = await calculateJsSummaries()

      assert.equal(sql.outstanding, 750)
      assert.equal(sql.overdueCount, 1)
      assert.equal(sql.remindersDue, 1) // Boolean("   ") is true, SQL string <> '' is true
      assert.deepEqual(sql, js)
    } finally {
      await resetData()
    }
  })

  // 8. Empty string phone ("") and null phone
  await t.test('8. Empty string phone ("") and null phone (unreachable)', async () => {
    try {
      const stEmpty = await createStudent('Student 8a', '')
      const stNull = await createStudent('Student 8b', null)
      await db.query(
        `insert into fee_invoices (coaching_center_id, student_id, period_month, amount_bdt, due_date)
         values ($1, $2, '2026-06-01', 500, $3)`,
        [centerId, stEmpty, addDays(today, -2)]
      )
      await db.query(
        `insert into fee_invoices (coaching_center_id, student_id, period_month, amount_bdt, due_date)
         values ($1, $2, '2026-06-01', 500, $3)`,
        [centerId, stNull, addDays(today, -2)]
      )

      const sql = await querySqlSummaries()
      const js = await calculateJsSummaries()

      assert.equal(sql.outstanding, 1000)
      assert.equal(sql.overdueCount, 2)
      assert.equal(sql.remindersDue, 0) // Both unreachable
      assert.deepEqual(sql, js)
    } finally {
      await resetData()
    }
  })

  // 9. 3-day cooldown boundary (2 days held vs 3 days eligible)
  await t.test('9. 3-day cooldown boundary (2 days held vs 3 days eligible)', async () => {
    try {
      const stHeld = await createStudent('Student 9a', '01711000009')
      const stEligible = await createStudent('Student 9b', '01711000010')

      const invHeld = (
        (await db.query(
          `insert into fee_invoices (coaching_center_id, student_id, period_month, amount_bdt, due_date)
           values ($1, $2, '2026-06-01', 800, $3) returning id`,
          [centerId, stHeld, addDays(today, -10)]
        )) as any
      ).rows[0].id
      const invEligible = (
        (await db.query(
          `insert into fee_invoices (coaching_center_id, student_id, period_month, amount_bdt, due_date)
           values ($1, $2, '2026-06-01', 800, $3) returning id`,
          [centerId, stEligible, addDays(today, -10)]
        )) as any
      ).rows[0].id

      // Reminder 2 days ago (held by cooldown: today - lastReminded = 2 < 3)
      await db.query(
        `insert into fee_reminders (coaching_center_id, invoice_id, channel, amount_bdt, created_at)
         values ($1, $2, 'sms', 800, ($3::date + time '10:00') at time zone 'Asia/Dhaka')`,
        [centerId, invHeld, addDays(today, -2)]
      )

      // Reminder 4 days ago (prior to stage_since today - 3, cooldown 4 >= 3 -> eligible)
      await db.query(
        `insert into fee_reminders (coaching_center_id, invoice_id, channel, amount_bdt, created_at)
         values ($1, $2, 'sms', 800, ($3::date + time '10:00') at time zone 'Asia/Dhaka')`,
        [centerId, invEligible, addDays(today, -4)]
      )

      const sql = await querySqlSummaries()
      const js = await calculateJsSummaries()

      assert.equal(sql.outstanding, 1600)
      assert.equal(sql.overdueCount, 2)
      assert.equal(sql.remindersDue, 1) // Only invEligible is due
      assert.deepEqual(sql, js)
    } finally {
      await resetData()
    }
  })

  // 10. Covered stage boundary
  await t.test('10. Covered stage boundary (reminder on or after stage_since)', async () => {
    try {
      const stId = await createStudent('Student 10', '01711000011')
      const invId = (
        (await db.query(
          `insert into fee_invoices (coaching_center_id, student_id, period_month, amount_bdt, due_date)
           values ($1, $2, '2026-06-01', 950, $3) returning id`,
          [centerId, stId, addDays(today, -2)]
        )) as any
      ).rows[0].id

      // Reminder sent yesterday (today - 1), which is >= stage_since (today - 2)
      await db.query(
        `insert into fee_reminders (coaching_center_id, invoice_id, channel, amount_bdt, created_at)
         values ($1, $2, 'sms', 950, ($3::date + time '10:00') at time zone 'Asia/Dhaka')`,
        [centerId, invId, addDays(today, -1)]
      )

      const sql = await querySqlSummaries()
      const js = await calculateJsSummaries()

      assert.equal(sql.outstanding, 950)
      assert.equal(sql.overdueCount, 1)
      assert.equal(sql.remindersDue, 0) // Covered
      assert.deepEqual(sql, js)
    } finally {
      await resetData()
    }
  })

  // 11. 14-day cycle fortnightly cadence
  await t.test('11. 14-day cycle fortnightly cadence (days_late = 35, cycle 2 starts today)', async () => {
    try {
      const stId = await createStudent('Student 11', '01711000012')
      const invId = (
        (await db.query(
          `insert into fee_invoices (coaching_center_id, student_id, period_month, amount_bdt, due_date)
           values ($1, $2, '2026-06-01', 1200, $3) returning id`,
          [centerId, stId, addDays(today, -35)] // cycle 2 starts today
        )) as any
      ).rows[0].id

      // Reminded 5 days ago (during cycle 1, before cycle 2 opened today)
      await db.query(
        `insert into fee_reminders (coaching_center_id, invoice_id, channel, amount_bdt, created_at)
         values ($1, $2, 'sms', 1200, ($3::date + time '10:00') at time zone 'Asia/Dhaka')`,
        [centerId, invId, addDays(today, -5)]
      )

      const sql = await querySqlSummaries()
      const js = await calculateJsSummaries()

      assert.equal(sql.outstanding, 1200)
      assert.equal(sql.overdueCount, 1)
      assert.equal(sql.remindersDue, 1) // Cycle 2 opened today, cooldown 5 >= 3 -> due
      assert.deepEqual(sql, js)
    } finally {
      await resetData()
    }
  })

  // 12. Historical reminders (>60 days ago)
  await t.test('12. Historical reminders (>60 days ago)', async () => {
    try {
      const stId = await createStudent('Student 12', '01711000013')
      const invId = (
        (await db.query(
          `insert into fee_invoices (coaching_center_id, student_id, period_month, amount_bdt, due_date)
           values ($1, $2, '2026-06-01', 2500, $3) returning id`,
          [centerId, stId, addDays(today, -90)]
        )) as any
      ).rows[0].id

      // Reminded 65 days ago
      await db.query(
        `insert into fee_reminders (coaching_center_id, invoice_id, channel, amount_bdt, created_at)
         values ($1, $2, 'sms', 2500, ($3::date + time '10:00') at time zone 'Asia/Dhaka')`,
        [centerId, invId, addDays(today, -65)]
      )

      const sql = await querySqlSummaries()
      const js = await calculateJsSummaries()

      assert.equal(sql.outstanding, 2500)
      assert.equal(sql.overdueCount, 1)
      assert.deepEqual(sql, js)
    } finally {
      await resetData()
    }
  })

  await db.close()
})
