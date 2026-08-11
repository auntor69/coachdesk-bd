import type { BatchSlot as BatchSlotEnum } from '@/lib/supabase/types'
import { formatTimeBn } from '@/lib/bd/time'

/**
 * Bangladeshi coaching centres run the same batch several times a day, and the
 * slot is how everyone refers to it — "the morning batch", never "the 7am
 * batch". Both are shown when a time exists, because two morning batches need
 * telling apart.
 */
const SLOT_LABELS: Record<BatchSlotEnum, string> = {
  morning: 'সকাল',
  noon: 'দুপুর',
  afternoon: 'বিকাল',
  evening: 'সন্ধ্যা',
  night: 'রাত',
}

export function slotLabel(slot: BatchSlotEnum | null): string {
  return slot ? SLOT_LABELS[slot] : ''
}

/**
 * Renders a batch's when: "সকাল · ৭:৩০ সকাল–৯:০০ সকাল", or whichever half exists.
 * Returns null when neither does, so callers can omit the separator entirely.
 */
export function BatchSlot({
  slot,
  start,
  end,
}: {
  slot: BatchSlotEnum | null
  start?: string | null
  end?: string | null
}) {
  const label = slotLabel(slot)
  const range = start ? `${formatTimeBn(start)}${end ? `–${formatTimeBn(end)}` : ''}` : ''
  const text = [label, range].filter(Boolean).join(' · ')
  return text ? <>{text}</> : null
}
