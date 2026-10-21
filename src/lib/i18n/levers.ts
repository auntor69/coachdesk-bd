/**
 * The words on the founder's two levers — MASTERPLAN §11.7, build-order step 26.
 *
 * WHY THIS IS A MODULE AND NOT SIX KEYS IN THE DICTIONARIES. `en.ts` and `bn.ts` are 266 KB
 * and 547 KB, and the tooling that edits this repository can write the first hundred
 * kilobytes of a file and no further — the same limitation `./recharge.ts` records, measured
 * the same way: a one-line patch at `founder.money` in `en.ts` (line 5,021) is silently
 * dropped while the same patch near the top lands. The alternative to a small module is a
 * partially rewritten dictionary, which is the one file here where a half-applied edit takes
 * every screen down at once.
 *
 * WHAT IS IN IT, AND WHY THERE ARE TWO GROUPS. The `labels` are strings, because the
 * founder's page hands the whole money group to a client component and a group with a
 * function in it cannot cross that boundary at all — React refuses to serialise it, which is
 * the defect §21 records for `RechargeWords`. The `receipts` are functions, because each
 * carries a figure: they are composed on the server after the write, from the numbers the
 * database answered with, exactly as `creditSaved` and `purchaseConfirmed` are in the
 * dictionary's `founder` group.
 *
 * `reaches` IS THE ONE TEMPLATE IN THE LABELS, and it is deliberate: it is the only sentence
 * here that has to change after the page has rendered, because a founder typing 30 days
 * should read the date it reaches before the tap rather than after it. It crosses as a
 * template with `{date}` and is filled in the browser by `lib/i18n/fill.ts` — the same
 * arrangement the reminder worklist's counter uses, and the same reason.
 *
 * Composed with `+` rather than template literals, deliberately: this file is written
 * through the same tooling that could not patch the dictionaries, and a plain concatenation
 * survives being moved into either of them by hand later.
 */

import type { Locale } from './locale.ts'

/**
 * The labels the founder's forms draw. Strings only — see the note above.
 *
 * The static refusals live here too rather than in the dictionary for the same reason the
 * labels do, and the Server Action reads them from the same place the component does, so a
 * sentence cannot exist in two languages' worth of one file and one of the other.
 */
export type LeverLabels = {
  grantTitle: string
  grantHint: string
  days: string
  daysHint: string
  /** `{date}` is filled in the browser — see the note at the top. */
  reaches: string
  grant: string
  granting: string
  adjustTitle: string
  adjustHint: string
  adjustAmount: string
  adjustAmountHint: string
  reason: string
  reasonHint: string
  adjust: string
  adjusting: string
  badDays: string
  badAdjust: string
  overdraw: string
  noReason: string
  failed: string
  /**
   * The balance and the line could not be read, so neither lever is drawn. Said out loud
   * rather than drawn with a blank beside it: a grant worked out from a line nobody has is
   * a date nobody can predict, and the founder would be granting it blind.
   */
  unreadable: string
}

/**
 * The sentences that carry a figure, composed on the server: two receipts and the line
 * above the forms.
 *
 * `holding` is what makes the levers legible — a founder about to move a balance should see
 * what the balance is and how far the days already reach, and both figures are formatted
 * where the locale is known rather than in the browser.
 */
export type LeverSentences = {
  holding: (balance: string, date: string) => string
  adjusted: (amount: string, balance: string) => string
  grantedDays: (days: string, date: string) => string
}

type LeverWords = {
  labels: LeverLabels
  sentences: LeverSentences
}

/**
 * Both languages, keyed by locale, in one object — the shape `rechargeWords` uses.
 *
 * Bangla first in the file for the reason the dictionaries are: this product is read in
 * Bangla and translated into English, and a sentence written in the second language first is
 * a sentence written for the wrong reader.
 */
const WORDS: Record<Locale, LeverWords> = {
  bn: {
    labels: {
      grantTitle: 'দিন দিয়ে দিন',
      grantHint:
        'টাকা নয় — দিন। ঈদের ছুটি, ভুলের ক্ষমা, কয়েক সপ্তাহের শুভেচ্ছা। কোনো টাকা কাটা হবে '
        + 'না, ব্যালেন্সও বদলাবে না, তাই এই দিন অন্য কোথাও খরচ করা যায় না। কেন্দ্রের '
        + 'ব্যালেন্সে টাকা থাকলে এই দিনগুলো শেষ হওয়ার আগে সেই টাকা খরচ হবে না।',
      days: 'কত দিন',
      daysHint: 'পূর্ণ সংখ্যা, এক বছর পর্যন্ত। দিন শুরু হয় আজ থেকে।',
      reaches: '{date} পর্যন্ত চলবে',
      grant: 'দিন যোগ করুন',
      granting: 'যোগ করা হচ্ছে…',
      adjustTitle: 'ব্যালেন্স বদলান',
      adjustHint:
        'টাকা যোগ বা টাকা কাটা। যা খরচ হয়ে গেছে তা টাকা হিসেবে ফেরত দেওয়া হয়, আর সেই টাকা '
        + 'ওরা যেকোনো কাজে ব্যবহার করতে পারে।',
      adjustAmount: 'অঙ্ক',
      adjustAmountHint: 'পূর্ণ সংখ্যা লিখুন। মাইনাস চিহ্ন দিলে টাকা কাটা যাবে।',
      reason: 'কেন',
      reasonHint: 'লিখতেই হবে। ওদের নিজের হিসেবের পাতায় এটাই লেখা থাকবে।',
      adjust: 'ব্যালেন্সে লাগান',
      adjusting: 'লাগানো হচ্ছে…',
      badDays: 'এক বছর পর্যন্ত পূর্ণ সংখ্যক দিন লিখুন।',
      badAdjust: 'টাকার অঙ্ক লিখুন, শূন্য নয়। মাইনাস চিহ্ন দিলে টাকা কাটা যাবে।',
      overdraw: 'ওদের কাছে এত টাকা নেই। ব্যালেন্স শূন্যের নিচে যায় না।',
      noReason: 'কারণ লিখুন। শিক্ষার্থীর হিসেবের পাতায় এটাই লেখা থাকবে, পরে আর যোগ করা যাবে না।',
      failed: 'লেখা যায়নি। আবার চেষ্টা করুন।',
      unreadable: 'ব্যালেন্স আর পরিশোধের তারিখ পড়া গেল না, তাই এই দুটি কাজ দেখানো হচ্ছে না।',
    },
    sentences: {
      holding: (balance, date) =>
        'ব্যালেন্সে ' + balance + ' · ' + date + ' পর্যন্ত পরিশোধিত',
      adjusted: (amount, balance) => amount + ' লাগানো হয়েছে। এখন আছে ' + balance + '।',
      grantedDays: (days, date) => days + ' দিন দেওয়া হয়েছে — ' + date + ' পর্যন্ত চলবে।',
    },
  },
  en: {
    labels: {
      grantTitle: 'Give them days',
      grantHint:
        'Days, not money — a closure, an apology, a few weeks of goodwill. Nothing is '
        + 'charged and the balance does not move, so these days cannot be spent on anything '
        + 'else. If the centre holds a balance, it is not spent until these days run out.',
      days: 'How many days',
      daysHint: 'A whole number, up to a year. Days run from today.',
      reaches: 'Covers them to {date}',
      grant: 'Give the days',
      granting: 'Giving…',
      adjustTitle: 'Move the balance',
      adjustHint:
        'Money on, or money off. What is already burned comes back as taka, which they can '
        + 'spend on anything.',
      adjustAmount: 'Amount',
      adjustAmountHint: 'A whole figure. Use a minus sign to take money off.',
      reason: 'Why',
      reasonHint: 'Required. It goes into their own history as written.',
      adjust: 'Apply to the balance',
      adjusting: 'Applying…',
      badDays: 'Enter a whole number of days, up to a year.',
      badAdjust: 'Enter an amount in taka, and not zero. A minus sign takes money off.',
      overdraw: 'That is more than they hold. A balance never goes below nothing.',
      noReason:
        'Say why. The customer reads this in their own history, and nobody can add it later.',
      failed: 'Could not save it. Try again.',
      unreadable:
        'The balance and the line could not be read, so neither lever is drawn here.',
    },
    sentences: {
      holding: (balance, date) =>
        balance + ' in the balance · paid to ' + date,
      adjusted: (amount, balance) => amount + ' applied. They now hold ' + balance + '.',
      grantedDays: (days, date) => days + ' days granted — covers them to ' + date + '.',
    },
  },
}

/** The string leaves, for the client component and for a refusal in words. */
export function leverLabels(locale: Locale): LeverLabels {
  return WORDS[locale].labels
}

/** The three sentences, for the server that composes them. */
export function leverSentences(locale: Locale): LeverSentences {
  return WORDS[locale].sentences
}
