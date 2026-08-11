/**
 * Dates and times, always in Asia/Dhaka.
 *
 * The server runs in UTC and Dhaka is UTC+6, so `new Date().toISOString()`
 * silently returns *yesterday* for the first six hours of every Bangladeshi
 * day. An evening batch marked at 8pm Dhaka is 2pm UTC — same day, fine — but
 * a teacher opening the app at 5am to prepare would file attendance against
 * the previous date, and nobody would notice until a parent asked why their
 * child was absent on a holiday.
 *
 * Bangladesh has observed no DST since the 2009 experiment was abandoned, so
 * the offset is a genuine constant. We still go through Intl rather than
 * adding six hours by hand, because a fixed offset is the kind of assumption
 * that stops being true without telling you.
 */

export const DHAKA_TZ = 'Asia/Dhaka'

/** Today in Dhaka as YYYY-MM-DD — the shape Postgres `date` columns want. */
export function todayInDhaka(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD, which is ISO order without manual padding.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: DHAKA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/**
 * Day of week in Dhaka, 0 = Sunday.
 *
 * Sunday-based to match Postgres `extract(dow)`, so a number stored by a
 * trigger and a number computed here mean the same thing. Note that the
 * Bangladeshi week runs Sunday to Thursday with Friday and Saturday off —
 * the numbering is shared with the US, the weekend is not.
 */
export function dhakaDayOfWeek(now: Date = new Date()): number {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: DHAKA_TZ,
    weekday: 'short',
  }).format(now)
  const index = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday)
  return index === -1 ? new Date(now).getUTCDay() : index
}

const DAY_NAMES_BN = [
  'রবিবার',
  'সোমবার',
  'মঙ্গলবার',
  'বুধবার',
  'বৃহস্পতিবার',
  'শুক্রবার',
  'শনিবার',
]

export function dayNameBn(dow: number): string {
  return DAY_NAMES_BN[dow] ?? ''
}

const MONTHS_BN = [
  'জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
  'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর',
]

/**
 * Renders a YYYY-MM-DD as "১১ আগস্ট ২০২৬".
 *
 * Parsed by hand rather than through Date, because `new Date('2026-08-11')` is
 * parsed as UTC midnight and then displayed in local time, which moves the date
 * backwards for anyone west of Greenwich. A date column has no timezone and
 * should not acquire one on the way to a screen.
 */
export function formatDateBn(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  if (!y || !m || !d) return isoDate
  return `${toBanglaDigits(d)} ${MONTHS_BN[m - 1]} ${toBanglaDigits(y)}`
}

/** HH:MM:SS or HH:MM -> "৭:৩০ সকাল". Times come back from Postgres as strings. */
export function formatTimeBn(time: string | null): string {
  if (!time) return ''
  const [hStr, mStr] = time.split(':')
  const h = Number(hStr)
  const m = Number(mStr)
  if (Number.isNaN(h) || Number.isNaN(m)) return time

  const period =
    h < 6 ? 'রাত' : h < 12 ? 'সকাল' : h < 16 ? 'দুপুর' : h < 19 ? 'বিকাল' : 'রাত'
  const h12 = h % 12 === 0 ? 12 : h % 12

  return `${toBanglaDigits(h12)}:${toBanglaDigits(String(m).padStart(2, '0'))} ${period}`
}

const BANGLA_DIGIT_CHARS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯']

/**
 * ASCII digits to Bangla numerals.
 *
 * Used for dates and times only. Money and counts stay in ASCII digits: prices
 * are read and re-typed into bKash, and mixing numeral systems around a payment
 * is how a ৳৫০০ becomes a 900.
 */
export function toBanglaDigits(value: string | number): string {
  return String(value).replace(/\d/g, (d) => BANGLA_DIGIT_CHARS[Number(d)])
}

/** Current month as YYYY-MM-01, the shape used by fee_invoices.period_month. */
export function currentPeriodMonth(now: Date = new Date()): string {
  return `${todayInDhaka(now).slice(0, 7)}-01`
}

/** Renders a YYYY-MM-01 as "আগস্ট ২০২৬" — a billing period, not a day. */
export function formatMonthBn(periodMonth: string): string {
  const [y, m] = periodMonth.split('-').map(Number)
  if (!y || !m || m > 12) return periodMonth
  return `${MONTHS_BN[m - 1]} ${toBanglaDigits(y)}`
}

/**
 * Just the month name — "আগস্ট", no year.
 *
 * For places where the year is five characters of nothing: a parent reading an
 * SMS about an unpaid fee is not wondering which year it is, and inside a
 * 70-character Bangla segment those five characters are the difference between
 * one SMS and two.
 */
export function monthNameBn(periodMonth: string): string {
  const [y, m] = periodMonth.split('-').map(Number)
  if (!y || !m || m > 12) return periodMonth
  return MONTHS_BN[m - 1]
}

/**
 * Shifts a YYYY-MM-01 by whole months.
 *
 * Arithmetic on the numbers rather than through Date, for the same reason
 * formatDateBn parses by hand: a period_month is a label for a billing cycle,
 * not an instant, and routing it through a timezone can only move it.
 */
export function addMonths(periodMonth: string, delta: number): string {
  const [y, m] = periodMonth.split('-').map(Number)
  if (!y || !m) return periodMonth
  // Months as a single count from year zero, so a negative delta crosses
  // January without a special case.
  const total = y * 12 + (m - 1) + delta
  const year = Math.floor(total / 12)
  const month = total - year * 12 + 1
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`
}
