import Link from 'next/link'

import { Card } from '@/components/ui'
import { requireRole, getSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { dict, localName, DEFAULT_LOCALE } from '@/lib/i18n'
import { planName } from '@/lib/plans'
import { createSubject } from '../actions'
import { QuickAdd } from '../quick-add'

/** getSession, not requireRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  const locale = session?.locale ?? DEFAULT_LOCALE
  return { title: `${dict(locale).settings.subjects.title} — CoachDesk` }
}

/**
 * A centre's own subject list.
 *
 * Not an enum, because "গণিত ২য় পত্র" and "স্পোকেন ইংলিশ" are real subjects at
 * real centres and neither belongs in a migration. The whole point of the
 * product being customizable is that the owner never waits on us for this.
 */
export default async function SubjectsPage() {
  const session = await requireRole('manager')
  const supabase = await createClient()
  const locale = session.locale
  const d = dict(locale)
  const t = d.settings.subjects

  const { data: subjects } = await supabase
    .from('subjects')
    .select('id, name, name_bn, subject_kind, active, batches (id)')
    .order('name', { ascending: true })

  const rows = subjects ?? []
  const activeCount = rows.filter((s) => s.active).length
  const limit = session.plan.maxSubjects

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href="/settings"
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← {d.settings.hub.title}
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink">{t.title}</h1>
        <p className="mt-1 text-ink-soft">
          {limit === null ? t.count(activeCount) : t.used(activeCount, limit)}
        </p>
      </div>

      {rows.length > 0 && (
        <ul className="flex flex-col gap-2">
          {rows.map((subject) => {
            // The reader's own name first, the other one under it when the owner
            // typed both. Not `name_bn || name`, which showed a Bangla subject
            // name to an English reader and put the English one in the small grey
            // line below it.
            const primary = localName(subject, locale)
            const other = locale === 'en' ? subject.name_bn : subject.name
            const batchCount = (subject.batches ?? []).length
            return (
              <li
                key={subject.id}
                className="flex items-center justify-between gap-3 rounded-xl
                  border border-line bg-white px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">{primary}</p>
                  {other && other !== primary && (
                    <p className="truncate text-sm text-ink-faint">{other}</p>
                  )}
                </div>
                <span className="shrink-0 text-sm text-ink-soft">
                  <span className="num">{batchCount}</span> {t.batches(batchCount)}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {limit !== null && activeCount >= limit ? (
        <Card>
          <p className="font-medium text-ink">{t.capTitle}</p>
          <p className="mt-1 text-sm text-ink-soft">
            {t.cap(planName(session.plan, locale), limit)}
          </p>
        </Card>
      ) : (
        <QuickAdd
          action={createSubject}
          common={d.common}
          label={t.nameLabel}
          hint={t.nameHint}
          placeholder="Mathematics"
          placeholderBn="গণিত"
        />
      )}
    </div>
  )
}
