'use client'

/**
 * What a coaching centre would pay us, worked out as the owner types.
 *
 * A client component because the whole value is the immediacy: an owner sitting
 * across a desk from the founder tries 80 students, then 150, then asks what
 * happens if they hire two more teachers, and a round trip per keystroke turns a
 * conversation into a wait. `plans.ts` is pure and its only import is a type, so
 * the arithmetic ships to the browser for a few hundred bytes.
 *
 * THE BREAKDOWN IS NOT DECORATION. A single figure an owner cannot reconstruct
 * reads as a number invented on the spot, and this product is sold face to face by
 * the person who set the prices — so every part of the bill is shown next to the
 * rate that produced it. The bands are the same array the server bills from; a rate
 * changed in `plans.ts` changes this table without anybody remembering to.
 *
 * The figure is labelled as calculated rather than quoted. Centre pricing is agreed
 * in conversation, and an owner who is shown ৳4,300 here and asked for ৳4,800 later
 * stops believing the rest of the screen.
 */
import { useState } from 'react'

import { Card } from '@/components/ui'
import { toAsciiDigits } from '@/lib/bd/phone'
import { digits } from '@/lib/bd/time'
import type { Locale, T } from '@/lib/i18n'
import { fill } from '@/lib/i18n/fill'
import { formatTaka } from '@/lib/money'
import {
  PLANS,
  STUDENT_BANDS,
  CENTER_MONTHLY_FLOOR_BDT,
  CENTER_FREE_TEACHER_SEATS,
  CENTER_TEACHER_SEAT_BDT,
  monthlyBillBdt,
  studentChargeBdt,
  teacherChargeBdt,
} from '@/lib/plans'

/**
 * A ceiling on the inputs, not on the plan.
 *
 * The bands are open-ended and the arithmetic holds at any size; this stops a
 * mistyped 90000000 from rendering a bill with nine digits in it, which reads as a
 * broken calculator rather than as a large centre. Well above the largest coaching
 * centre in the country.
 */
const MAX_STUDENTS = 5000
const MAX_TEACHERS = 200

/**
 * Whole, in range, and never NaN — the field is `text` on purpose, see below.
 *
 * `toAsciiDigits` first, because `\d` in a JavaScript regex is ASCII-only and an
 * owner using the Bangla keyboard types ১২০. Without it their digits are stripped
 * as punctuation and the field refuses everything they enter, in the language the
 * app is written in.
 */
function count(raw: string, max: number): number {
  const n = Number.parseInt(toAsciiDigits(raw).replace(/[^\d]/g, ''), 10)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(n, max)
}

export function PriceCalculator({
  t,
  locale,
}: {
  t: T<'planCalc'>
  /**
   * For the counts inside the sentences, which take Bangla numerals like every
   * other count in prose in this app. The taka figures stay ASCII in both
   * languages — they get re-typed into bKash.
   */
  locale: Locale
}) {
  // Strings, not numbers, because the field has to be allowed to be empty while
  // somebody clears it and types again. A numeric state would snap to 0 mid-edit
  // and the cursor would land after it.
  const [students, setStudents] = useState('120')
  const [teachers, setTeachers] = useState('4')

  const n = count(students, MAX_STUDENTS)
  const staff = count(teachers, MAX_TEACHERS)

  const rawStudents = studentChargeBdt(n)
  // What the students are actually billed at, which below a certain size is the
  // floor rather than the per-head sum. The breakdown shows this figure and not
  // the raw one, because two rows reading ৳500 and ৳1,999 under a total of ৳1,999
  // is a column that does not add up — and an owner who tries to add it concludes
  // the calculator is wrong before they conclude the label is.
  const billedStudents = Math.max(CENTER_MONTHLY_FLOOR_BDT, rawStudents)
  const seatPart = teacherChargeBdt(staff)
  const total = monthlyBillBdt(PLANS.center, n, staff)
  // Shown only when it bites. On a centre past the floor the line would be a fact
  // about somebody else's bill.
  const onFloor = rawStudents < CENTER_MONTHLY_FLOOR_BDT
  const extraSeats = Math.max(0, staff - CENTER_FREE_TEACHER_SEATS)

  return (
    <Card>
      <h2 className="font-semibold text-ink">{t.title}</h2>
      <p className="mt-1 text-sm text-ink-soft">{t.body}</p>

      <div className="mt-4 flex gap-3">
        <NumberField
          label={t.students}
          value={students}
          max={MAX_STUDENTS}
          onChange={setStudents}
        />
        <NumberField
          label={t.teachers}
          value={teachers}
          max={MAX_TEACHERS}
          onChange={setTeachers}
        />
      </div>

      <div
        className="mt-4 flex items-baseline justify-between gap-4 rounded-lg
          bg-brand-50 px-3 py-2"
      >
        <span className="font-medium text-brand-800">{t.monthly}</span>
        <span className="num text-2xl font-bold text-brand-900">
          {formatTaka(total)}
        </span>
      </div>

      <p className="mt-3 text-sm font-medium text-ink-soft">{t.breakdown}</p>
      <dl className="mt-1 flex flex-col gap-1 text-sm">
        <Row label={t.studentPart} value={formatTaka(billedStudents)} />
        {/* A note rather than a row, so the figures above and below it are the two
            that make the total. It explains the row it sits under: the students
            came to less than this and this is what is charged anyway. */}
        {onFloor && (
          <p className="text-ink-faint">
            {fill(t.floorNote, { floor: formatTaka(CENTER_MONTHLY_FLOOR_BDT) })}
          </p>
        )}
        {extraSeats > 0 ? (
          <Row
            label={fill(t.seatPart, { n: digits(extraSeats, locale) })}
            value={formatTaka(seatPart)}
          />
        ) : (
          <p className="text-ink-faint">
            {fill(t.seatsIncluded, {
              n: digits(CENTER_FREE_TEACHER_SEATS, locale),
            })}
          </p>
        )}
      </dl>

      <p className="mt-4 text-sm font-medium text-ink-soft">{t.ratesTitle}</p>
      <ul className="mt-1 flex flex-col gap-0.5 text-sm text-ink-soft">
        {STUDENT_BANDS.map((band, i) => {
          const from = (i === 0 ? 0 : (STUDENT_BANDS[i - 1].upTo ?? 0)) + 1
          const rate = formatTaka(band.rateBdt)
          return (
            <li key={band.rateBdt} className="num">
              {band.upTo === null
                ? fill(t.bandLast, { from: digits(from - 1, locale), rate })
                : fill(t.bandRow, {
                    from: digits(from, locale),
                    to: digits(band.upTo, locale),
                    rate,
                  })}
            </li>
          )
        })}
        <li className="num">
          {fill(t.seatRate, {
            n: digits(CENTER_FREE_TEACHER_SEATS, locale),
            rate: formatTaka(CENTER_TEACHER_SEAT_BDT),
          })}
        </li>
      </ul>

      <p className="mt-3 text-xs text-ink-faint">{t.quoteNote}</p>
    </Card>
  )
}

/**
 * One count field.
 *
 * `inputMode="numeric"` on a text input rather than `type="number"`: the numeric
 * keypad is the part that matters on a phone, and a number input brings spinners
 * nobody taps, accepts `e` and `-`, and silently reports an empty string for
 * "12abc" so the value cannot be cleaned up. `count` above does the cleaning.
 *
 * The field keeps ASCII digits even for a Bangla reader, because it is typed into
 * rather than read: whatever the keyboard sends is converted, and what comes back
 * is what a phone's numeric keypad produces. The sentences below the field are
 * where the numerals switch.
 */
function NumberField({
  label,
  value,
  max,
  onChange,
}: {
  label: string
  value: string
  max: number
  onChange: (value: string) => void
}) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1.5">
      <span className="text-sm font-medium text-ink">{label}</span>
      <input
        type="text"
        inputMode="numeric"
        value={value}
        maxLength={String(max).length}
        onChange={(e) =>
          onChange(toAsciiDigits(e.target.value).replace(/[^\d]/g, ''))
        }
        className="num min-h-tap w-full rounded-xl border-2 border-line bg-white px-3
          text-lg font-semibold text-ink"
      />
    </label>
  )
}

/** One line of the breakdown. */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="min-w-0 text-ink-soft">{label}</dt>
      <dd className="num shrink-0 font-medium text-ink">{value}</dd>
    </div>
  )
}
