import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { formatDate } from '@/lib/bd/time'
import { readerLocale } from '@/lib/i18n/server'
import { copyFor, policyBySlug, policyHref, POLICIES } from '@/lib/legal/policies'
import { legalShell } from '@/lib/legal/shell'

/**
 * One document — MASTERPLAN.md §14.1, build-order step 25a.
 *
 * ONE DYNAMIC ROUTE RATHER THAN SEVEN FILES, because the seven differ in nothing but their
 * content. Seven page files would be seven copies of this file's header, its metadata
 * function and its version line, and the copy that drifts is always the one nobody re-reads
 * — which on a page like this is the version. `policyBySlug` returning null is what makes the
 * dynamic segment safe: `/legal/anything-at-all` is a URL a scanner tries within the hour, and
 * it gets a 404 rather than a crash or a blank document.
 *
 * THE SLUG IS CHECKED AGAINST THE WRITTEN PAGES AND NOT AGAINST A DATABASE. Nothing about these
 * documents is per-tenant and nothing is stored — the words live in `lib/legal/policies.ts`,
 * which is why a page can be edited by changing a string and why there is no cache to
 * invalidate. What is stored per tenant is the *acceptance* of a version (§14.1's
 * `policy_acceptances`), and that is read by the screens that need it rather than here.
 *
 * A GENUINELY PUBLIC PAGE. No session, no cookie beyond the language one, and `src/proxy.ts`
 * lists `/legal` among the routes that never redirect to the login form. That matters more
 * than it looks: the signup checkbox links here before an account exists, and the recharge
 * screen's non-refundable line links here for an owner whose balance has already run dry —
 * the one state in which a login wall would be exactly the wrong answer.
 */
export async function generateMetadata({
  params,
}: PageProps<'/legal/[kind]'>): Promise<Metadata> {
  const { kind } = await params
  const doc = policyBySlug(kind)
  if (!doc) return { title: 'CoachDesk' }

  const locale = await readerLocale()
  const copy = copyFor(doc, locale)

  return {
    title: `${copy.title} — CoachDesk`,
    description: copy.lead,
  }
}

export default async function PolicyPage({ params }: PageProps<'/legal/[kind]'>) {
  const { kind } = await params
  const doc = policyBySlug(kind)
  if (!doc) notFound()

  const locale = await readerLocale()
  const words = legalShell(locale)
  const copy = copyFor(doc, locale)

  // The other six, so a reader who arrived from a link can read the neighbouring page without
  // going back through the index. The current one is dropped rather than marked: a link to
  // where you already are is a control that does nothing.
  const others = POLICIES.filter((p) => p.kind !== doc.kind)

  return (
    <article>
      <Link
        href="/legal"
        className="text-sm font-medium text-brand-700 underline decoration-line underline-offset-4"
      >
        ← {words.allPolicies}
      </Link>

      <h1 className="mt-3 text-2xl font-bold text-ink">{copy.title}</h1>

      {/*
        THE VERSION, IN THE READER'S OWN DIGITS AND ON EVERY PAGE. §14.1 stores a version per
        acceptance, and a version nobody can read on the page itself is a number only the
        database knows — this line is what makes "I agreed to the version you showed me" a
        sentence a customer can check.
      */}
      <p className="mt-1 text-sm text-ink-faint">
        {words.effectiveFrom} {formatDate(doc.version, locale)}
      </p>

      <p className="mt-4 text-lg text-ink-soft">{copy.lead}</p>

      <div className="mt-6 flex flex-col gap-6">
        {copy.sections.map((section) => (
          <section key={section.heading} className="rounded-2xl border border-line bg-white p-5">
            <h2 className="font-semibold text-ink">{section.heading}</h2>
            <div className="mt-2 flex flex-col gap-2">
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph} className="text-ink-soft leading-relaxed">
                  {paragraph}
                </p>
              ))}
            </div>
          </section>
        ))}
      </div>

      <nav className="mt-8 border-t border-line pt-4">
        <p className="text-sm font-semibold text-ink">{words.allPolicies}</p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {others.map((other) => (
            <Link
              key={other.kind}
              href={policyHref(other.slug)}
              className="text-sm text-ink-soft underline decoration-line underline-offset-4
                hover:text-brand-700"
            >
              {copyFor(other, locale).title}
            </Link>
          ))}
        </div>
      </nav>
    </article>
  )
}
