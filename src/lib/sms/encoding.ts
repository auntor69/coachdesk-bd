/**
 * How many SMS a message actually costs.
 *
 * This is billing arithmetic, not a nicety. Bangladeshi aggregators charge per
 * segment, and Bangla is the expensive case: a message containing any Bangla
 * character is encoded UCS-2, which fits **70 characters**, not 160. Cross that
 * line by one character and the centre pays twice for the same result.
 *
 * So the count is computed here, shown to the owner before they authorise a
 * send, and charged against credits afterwards using the same function. One
 * implementation, so the number on the confirmation screen and the number on the
 * invoice can never disagree.
 */

/**
 * GSM 03.38 basic alphabet. Anything outside this set forces UCS-2 for the
 * entire message — one Bangla character in an otherwise English message costs
 * the same as an all-Bangla one.
 */
const GSM_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?'
  + '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'

/** Escape-table characters. Each occupies two septets, not one. */
const GSM_EXTENDED = '^{}\\[~]|€'

export type SmsEncoding = 'gsm7' | 'ucs2'

/** Per-segment capacity. The concatenated figures are smaller: a multi-part
 *  message spends 6 septets (or 3 UCS-2 characters) per part on the UDH header
 *  that tells the handset how to reassemble it. */
const LIMITS = {
  gsm7: { single: 160, multi: 153 },
  ucs2: { single: 70, multi: 67 },
} as const

/**
 * What one Bangla SMS holds.
 *
 * Exported so the settings screen can teach the owner this number instead of
 * asserting it: every centre plans around 160 until somebody tells them
 * otherwise, and a hard-coded 70 in a sentence is a fact that can silently stop
 * matching the arithmetic underneath it.
 */
export const UCS2_SEGMENT = LIMITS.ucs2.single

export type SmsCost = {
  encoding: SmsEncoding
  /** Billable units — what the message costs in septets or UCS-2 characters. */
  length: number
  /** Number of SMS the operator will bill for. */
  segments: number
  /** Units still free before the next segment starts. */
  remaining: number
  /** Capacity of the current segmentation, for showing "45/70". */
  capacity: number
}

/**
 * Counts by code point rather than by `String.length`.
 *
 * Bangla is inside the BMP so its characters are one UTF-16 unit each, but an
 * emoji in an owner-written template is a surrogate pair, and `.length` would
 * bill it as two characters while the operator bills one.
 */
export function measureSms(text: string): SmsCost {
  let encoding: SmsEncoding = 'gsm7'
  let length = 0

  for (const char of text) {
    if (GSM_BASIC.includes(char)) {
      length += 1
      continue
    }
    if (GSM_EXTENDED.includes(char)) {
      length += 2
      continue
    }
    // Anything else — every Bangla character lands here — makes the whole
    // message UCS-2. Once that happens the septet tally is meaningless, so we
    // stop counting and start again below.
    encoding = 'ucs2'
    break
  }

  if (encoding === 'ucs2') {
    length = [...text].length
  }

  const limit = LIMITS[encoding]
  const segments =
    length === 0
      ? 0
      : length <= limit.single
        ? 1
        : Math.ceil(length / limit.multi)
  const capacity = segments <= 1 ? limit.single : limit.multi * segments

  return {
    encoding,
    length,
    segments,
    remaining: Math.max(0, capacity - length),
    capacity,
  }
}

/** What a send of `count` identical-cost messages will draw from the balance. */
export function creditCost(text: string, recipients: number): number {
  return measureSms(text).segments * recipients
}
