import type { Metadata } from 'next'
import Link from 'next/link'

import { formatDate } from '@/lib/bd/time'
import { readerLocale } from '@/lib/i18n/server'
import { copyFor, POLICIES, policyHref } from '@/lib/legal/policies'
import { legalShell } from '@/lib/legal/shell'

/**
 * Every policy, in the order they are read — MASTERPLAN.md §14.1.
 *
 * THE ORDER IS THE MONEY FIRST, and it is the same order `POLICIES` is written in: the
 * prepaid terms, then refunds, then the contract, then the two pages a parent or a founder
 * asks about. §14.1's own table does the same thing, for the reason the section gives — the
 * balance is non-refundable, and the first taka must not arrive against nothing written.
 *
 * NO SESSION IS READ and none is needed. This is a public page by design; everything it
 * draws is a constant, and the reader's language comes from `readerLocale`, which is the
 * cookie for somebody who has never signed in.
 */
export const metadata: Metadata = {
  title: 'নীতিমালা — CoachDesk',
  description:
    'প্রিপেইড বিলিং শর্তাবলি, টাকা ফেরত, ব্যবহারের শর্ত, গোপনীয়তা ও নিরাপত্তা — বাংলায়।',
}

export default async function LegalIndexPage() {
  const locale = await readerLocale()
  const words = legalShell(locale)

  return (
    <>
      <h1 className="text-2xl font-bold text-ink">{words.title}</h1>
      <p className="mt-2 text-ink-soft">{words.lead}</p>

      {/*
        A LIST OF LINKS AND NOT SEVEN CARDS. These are documents, and the one thing a reader
        does here is choose one; seven bordered boxes would read as seven products. Each row
        carries the page's own title, its lead sentence and the date its wording last changed,
        because the version is the part of a terms page a dispute is actually about.
      */}
      <ul className="mt-6 flex flex-col divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
        {POLICIES.map((doc) => {
          const copy = copyFor(doc, locale)

          return (
            <li key={doc.kind}>
              <Link
                href={policyHref(doc.slug)}
                className="flex flex-col gap-1 p-4 transition-colors hover:bg-surface-alt sm:p-5"
              >
                <span className="font-semibold text-ink">{copy.title}</span>
                <span className="text-sm text-ink-soft">{copy.lead}</span>
                <span className="text-xs text-ink-faint">
                  {words.effectiveFrom} {formatDate(doc.version, locale)}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </>
  )
}
