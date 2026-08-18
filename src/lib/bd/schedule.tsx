import type { BatchSlot as BatchSlotEnum } from '@/lib/supabase/types'
import { formatTime } from '@/lib/bd/time'
import type { Locale } from '@/lib/i18n/locale'

/**
 * Bangladeshi coaching centres run the same batch several times a day, and the
 * slot is how everyone refers to it — "the morning batch", never "the 7am
 * batch". Both are shown when a time exists, because two morning batches need
 * telling apart.
 *
 * The table lives here rather than in the dictionary, next to `formatTime`'s
 * part-of-day words, because it is the same vocabulary: a 7:30 batch reads
 * "সকাল · ৭:৩০ সকাল", and the two halves drifting apart would be visible in one
 * line of one row. `lib/bd` is what the country calls things; the dictionary is
 * what the app says.
 */
const SLOT_LABELS: Record<Locale, Record<BatchSlotEnum, string>> = {
  bn: {
    morning: 'সকাল',
    noon: 'দুপুর',
    afternoon: 'বিকাল',
    evening: 'সন্ধ্যা',
    night: 'রাত',
  },
  en: {
    morning: 'Morning',
    noon: 'Noon',
    afternoon: 'Afternoon',
    evening: 'Evening',
    night: 'Night',
  },
}

export function slotLabel(slot: BatchSlotEnum | null, locale: Locale = 'bn'): string {
  return slot ? SLOT_LABELS[locale][slot] : ''
}

/**
 * Renders a batch's when: "সকাল · ৭:৩০ সকাল–৯:০০ সকাল", or whichever half exists.
 * Returns null when neither does, so callers can omit the separator entirely.
 */
export function BatchSlot({
  slot,
  start,
  end,
  locale = 'bn',
}: {
  slot: BatchSlotEnum | null
  start?: string | null
  end?: string | null
  locale?: Locale
}) {
  const label = slotLabel(slot, locale)
  const range = start
    ? `${formatTime(start, locale)}${end ? `–${formatTime(end, locale)}` : ''}`
    : ''
  const text = [label, range].filter(Boolean).join(' · ')
  return text ? <>{text}</> : null
}
