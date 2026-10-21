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
 *
 * The timezone is not negotiable but the *language* is: every function here that
 * produces something a person reads takes a `Locale`. The clock is Dhaka's for
 * an English-medium teacher too — what changes is the numerals and the words,
 * never the day.
 *
 * `locale` defaults to 'bn' while the English sweep is in progress, so a screen
 * that has not been converted yet keeps rendering exactly what it rendered
 * before. The default comes out in the commit that adds the language switch:
 * with it gone, `tsc` names every call site still missing a locale, which is a
 * better checklist than anything written down.
 */
import type { Locale } from '../i18n/locale.ts'

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

/**
 * The day of the week a given YYYY-MM-DD fell on, 0 = Sunday.
 *
 * The same numbering as `dhakaDayOfWeek` and therefore as `extract(dow)` and
 * `batch_schedules.day_of_week`, but for a calendar day rather than a moment.
 * Walking back through last week to find which day a batch last met is arithmetic
 * on dates, and there is no instant involved to have a timezone.
 *
 * Parsed at UTC noon like `daysBetween` and `addDays`, so the twelve hours of
 * slack in either direction make it impossible for any offset quirk to answer
 * with the neighbouring day. Returns -1 for a string that is not a date, which is
 * a value no schedule can hold, so a malformed date matches no class rather than
 * matching Sunday's.
 */
export function dayOfWeekOn(isoDate: string): number {
  const at = Date.parse(`${isoDate}T12:00:00Z`)
  if (Number.isNaN(at)) return -1
  return new Date(at).getUTCDay()
}

/**
 * Day and month names in both languages.
 *
 * Hard-coded rather than taken from Intl, which does have bn-BD data: Intl's
 * Bangla month names are the Indian-Bengali forms (আগস্ট is spelled the same but
 * ফেব্রুয়ারি and others are not), and the spellings below are the ones a Dhaka
 * centre writes on a notice board. A date is read by a parent; it should look
 * the way the notice board looks, not the way ICU does.
 *
 * These are calendar labels, not UI copy, so they live here rather than in the
 * dictionaries — a screen never picks a month name, it passes a date.
 */
const DAY_NAMES: Record<Locale, readonly string[]> = {
  bn: [
    'রবিবার',
    'সোমবার',
    'মঙ্গলবার',
    'বুধবার',
    'বৃহস্পতিবার',
    'শুক্রবার',
    'শনিবার',
  ],
  en: [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ],
}

/** Sunday-based, matching Postgres `extract(dow)` — see dhakaDayOfWeek. */
export function dayName(dow: number, locale: Locale = 'bn'): string {
  return DAY_NAMES[locale][dow] ?? ''
}

/**
 * The same days, short enough for a row.
 *
 * A batch that meets five days spells out to "রবিবার, সোমবার, মঙ্গলবার, বুধবার,
 * বৃহস্পতিবার" — fifty characters, which truncates halfway through
 * Tuesday on a 375px phone and tells the owner nothing. These are the forms a
 * centre writes on its own routine sheet.
 *
 * বৃহঃ keeps the visarga because that is how Thursday is abbreviated on a
 * Bangladeshi timetable; বৃহ alone looks like a typo.
 */
const DAY_NAMES_SHORT: Record<Locale, readonly string[]> = {
  bn: ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহঃ', 'শুক্র', 'শনি'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
}

/** Sunday-based like `dayName`, and interchangeable with it. */
export function dayNameShort(dow: number, locale: Locale = 'bn'): string {
  return DAY_NAMES_SHORT[locale][dow] ?? ''
}

/**
 * The week in the order a Bangladeshi reads it: Saturday first.
 *
 * Friday and Saturday are the weekend here and Saturday is the first working
 * day, so a day picker that starts on Sunday puts the start of the week in the
 * middle of the row. The numbers stay Sunday-based because they are stored, and
 * `extract(dow)` decides what stored means; only the reading order changes.
 *
 * Exported because the batch form is not the only thing that will ever need to
 * lay out a week, and a second copy of this array is a fortnight of somebody's
 * attendance filed against the wrong day.
 */
export const WEEK_ORDER: readonly number[] = [6, 0, 1, 2, 3, 4, 5]

const MONTHS: Record<Locale, readonly string[]> = {
  bn: [
    'জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
    'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর',
  ],
  en: [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ],
}

/**
 * Renders a YYYY-MM-DD as "১১ আগস্ট ২০২৬" or "11 August 2026".
 *
 * Day first in both languages. Bangladesh writes dates day-first, and an
 * English-medium teacher there reads 11 August, not August 11 — matching the
 * Bangla order also means switching language never reflows a table column.
 *
 * Parsed by hand rather than through Date, because `new Date('2026-08-11')` is
 * parsed as UTC midnight and then displayed in local time, which moves the date
 * backwards for anyone west of Greenwich. A date column has no timezone and
 * should not acquire one on the way to a screen.
 */
export function formatDate(isoDate: string, locale: Locale = 'bn'): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  if (!y || !m || !d || m > 12) return isoDate
  return `${digits(d, locale)} ${MONTHS[locale][m - 1]} ${digits(y, locale)}`
}

/**
 * HH:MM:SS or HH:MM -> "৭:৩০ সকাল" or "7:30 am". Postgres hands times back as
 * strings, so there is no Date to route this through and no timezone to lose.
 *
 * The two languages divide the day differently, and this is the one formatter
 * where English is not a table swap. Bangla names four parts of the day and a
 * 4pm class is বিকাল while a 7pm one is রাত; English has am and pm and a
 * bilingual reader would find "afternoon/evening" glued to a 12-hour clock
 * stranger than the pm they already use for the same times.
 */
export function formatTime(time: string | null, locale: Locale = 'bn'): string {
  if (!time) return ''
  const [hStr, mStr] = time.split(':')
  const h = Number(hStr)
  const m = Number(mStr)
  if (Number.isNaN(h) || Number.isNaN(m)) return time

  const period =
    locale === 'en'
      ? h < 12
        ? 'am'
        : 'pm'
      : h < 6
        ? 'রাত'
        : h < 12
          ? 'সকাল'
          : h < 16
            ? 'দুপুর'
            : h < 19
              ? 'বিকাল'
              : 'রাত'
  const h12 = h % 12 === 0 ? 12 : h % 12

  return `${digits(h12, locale)}:${digits(String(m).padStart(2, '0'), locale)} ${period}`
}

/**
 * A `timestamptz` as the Dhaka calendar day and the clock time inside it.
 *
 * `created_at.slice(0, 10)` is the UTC day, and for the first six hours of every
 * Bangladeshi morning that is yesterday: a payment taken at 1am Dhaka reads as the
 * previous date, at 7pm. Harmless on a `date` column, which has no instant in it to
 * convert; wrong on every timestamptz, and worst of all on the audit log, whose whole
 * job is saying when something happened.
 *
 * Returns the two shapes `formatDate` and `formatTime` already take, so the language
 * and the numerals stay their business.
 */
export function dhakaMoment(iso: string): { date: string; time: string } {
  const at = new Date(iso)
  // A string Postgres did not produce. The date half of it is still better than an
  // exception on a screen that is only reporting history.
  if (Number.isNaN(at.getTime())) return { date: iso.slice(0, 10), time: '' }

  // h23 rather than hour12: false — a 12-hour cycle answers midnight as 24 on some ICU
  // builds, and `formatTime` reads the hour as a number.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DHAKA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)

  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '00'

  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    time: `${part('hour')}:${part('minute')}`,
  }
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

/**
 * Numerals for whichever language is reading — Bangla for 'bn', untouched for
 * 'en'.
 *
 * The money rule above is unchanged and is not this function's job: a taka
 * figure stays ASCII in both locales, and the place that enforces that is
 * `formatTaka` in src/lib/money.ts, which never calls this.
 */
export function digits(value: string | number, locale: Locale = 'bn'): string {
  return locale === 'en' ? String(value) : toBanglaDigits(value)
}

/**
 * Whole days from `from` to `to`, both YYYY-MM-DD. Negative when `to` is earlier.
 *
 * Parsed as UTC noon rather than midnight: both dates shift by the same amount,
 * so the difference is exact, and noon leaves twelve hours of slack in either
 * direction — enough that no offset quirk anywhere can round a day away.
 *
 * A `date` column has no timezone, so this deliberately never consults one. The
 * caller decides which day "today" is (todayInDhaka), and from there the gap
 * between two calendar days is arithmetic, not a moment in time.
 */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T12:00:00Z`)
  const b = Date.parse(`${to}T12:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.round((b - a) / 86_400_000)
}

/**
 * Shifts a YYYY-MM-DD by whole days, staying a YYYY-MM-DD.
 *
 * Through Date at UTC noon, unlike addMonths which does its own arithmetic: a
 * month is a label and can be counted, but adding days has to cross month
 * lengths and leap years, and Date already knows that February 2028 has 29.
 */
export function addDays(isoDate: string, delta: number): string {
  const at = Date.parse(`${isoDate}T12:00:00Z`)
  if (Number.isNaN(at)) return isoDate
  return new Date(at + delta * 86_400_000).toISOString().slice(0, 10)
}

/** Current month as YYYY-MM-01, the shape used by fee_invoices.period_month. */
export function currentPeriodMonth(now: Date = new Date()): string {
  return `${todayInDhaka(now).slice(0, 7)}-01`
}

/**
 * The wall clock in Dhaka, as HH:MM.
 *
 * The hour half of `todayInDhaka`, and the only way this app is allowed to ask what
 * time it is. Two rules follow from that and both are enforced by where this function
 * is rather than by a comment: a page cannot call `new Date()` during render (React
 * refuses the impure call), so the clock arrives as a value; and the value is Dhaka's
 * rather than the server's, which for the first six hours of a Bangladeshi day would
 * otherwise be six hours behind the classes it is being compared with.
 *
 * Minutes and no seconds, because every class time it is compared against is stored
 * as `time` without them and a class at 16:00 is starting at 16:00, not at 16:00:00
 * plus whatever the request took to arrive. `hourCycle: 'h23'` for `dhakaMoment`'s
 * reason: some ICU builds answer midnight as 24 under `hour12: false`.
 */
export function dhakaClock(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DHAKA_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)

  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '00'

  return `${part('hour')}:${part('minute')}`
}

/**
 * Whether a `timestamptz` from the database has already gone by.
 *
 * A moment rather than a calendar day, so no timezone comes into it: both sides are
 * instants and the comparison is the same in Dhaka as in UTC. That matters for a quote
 * that runs out at 2pm — reading it as a Dhaka date would keep it alive until midnight.
 *
 * Here rather than at the call site because a page is not allowed to read the clock:
 * `Date.now()` during render is an impure call the React compiler refuses, and every
 * other clock read in the app already goes through this module.
 *
 * An unreadable timestamp has NOT passed. A caller uses this to decide whether to offer
 * an action, and a parse failure should leave the button there for the database to refuse
 * rather than hide it on the strength of a bad string.
 */
export function hasPassed(iso: string | null, now: Date = new Date()): boolean {
  if (!iso) return false
  const at = Date.parse(iso)
  return !Number.isNaN(at) && at <= now.getTime()
}

/** Renders a YYYY-MM-01 as "আগস্ট ২০২৬" — a billing period, not a day. */
export function formatMonth(periodMonth: string, locale: Locale = 'bn'): string {
  const [y, m] = periodMonth.split('-').map(Number)
  if (!y || !m || m > 12) return periodMonth
  return `${MONTHS[locale][m - 1]} ${digits(y, locale)}`
}

/**
 * Just the month name — "আগস্ট", no year.
 *
 * For places where the year is five characters of nothing: a parent reading an
 * SMS about an unpaid fee is not wondering which year it is, and inside a
 * 70-character Bangla segment those five characters are the difference between
 * one SMS and two.
 */
export function monthName(periodMonth: string, locale: Locale = 'bn'): string {
  const [y, m] = periodMonth.split('-').map(Number)
  if (!y || !m || m > 12) return periodMonth
  return MONTHS[locale][m - 1]
}

/**
 * Shifts a YYYY-MM-01 by whole months.
 *
 * Arithmetic on the numbers rather than through Date, for the same reason
 * formatDate parses by hand: a period_month is a label for a billing cycle,
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
