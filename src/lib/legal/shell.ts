/**
 * The furniture around the seven documents: the index's heading, the version line, the footer.
 *
 * ITS OWN FILE RATHER THAN THE DICTIONARIES, and the reason is that it is read by one route
 * group and nothing else. `lib/i18n` carries every string the signed-in app draws, and a group
 * added to it has to hold its own against `Dictionary`'s shape across two files; §14.1's pages
 * are a public corner of the product whose entire vocabulary is these few lines, so they live
 * beside the policies they frame.
 *
 * `contact` is a function of the number rather than a sentence with the number typed into it,
 * so that changing `SUPPORT_PHONE` cannot leave a second, older number on the same page —
 * which is the drift §14.1 names when it asks for one real number.
 */
import type { Locale } from '@/lib/i18n/locale'

export type LegalShell = {
  title: string
  lead: string
  effectiveFrom: string
  allPolicies: string
  read: string
  backToSignIn: string
  contact: (phone: string) => string
}

const SHELL: Record<Locale, LegalShell> = {
  bn: {
    title: 'নীতিমালা',
    lead: 'টাকা পাঠানোর আগে যা জানা দরকার — বাংলায়, প্রতিদিনের ভাষায় লেখা।',
    effectiveFrom: 'সর্বশেষ হালনাগাদ',
    allPolicies: 'সব নীতিমালা',
    read: 'পড়ুন',
    backToSignIn: 'লগইনে ফিরুন',
    contact: (phone) => `যেকোনো প্রশ্নে ${phone} — ফোন বা হোয়াটসঅ্যাপ।`,
  },
  en: {
    title: 'Policies',
    lead: 'What you need to know before you send money, in plain language.',
    effectiveFrom: 'Last updated',
    allPolicies: 'All policies',
    read: 'Read',
    backToSignIn: 'Back to sign in',
    contact: (phone) => `Any question: ${phone}, by call or WhatsApp.`,
  },
}

/** The words for one reader. Total: two languages, no third case to handle. */
export function legalShell(locale: Locale): LegalShell {
  return locale === 'en' ? SHELL.en : SHELL.bn
}
