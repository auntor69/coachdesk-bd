import Link from 'next/link'

import { Card } from '@/components/ui'
import { pageRole, getSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { dict, localName, DEFAULT_LOCALE } from '@/lib/i18n'
import { planName } from '@/lib/plans'
import { subjectDeleteVerdict, subjectOffVerdict } from '@/lib/settings/retire'
import type { SubjectUse } from '@/lib/settings/retire'
import { emptySubjectUse, readSubjectUses } from '@/lib/settings/usage'
import {
  createSubject,
  renameSubject,
  setSubjectActive,
  deleteSubject,
} from '../actions'
import { QuickAdd } from '../quick-add'
import { SettingsListRow } from '../list-row'

/** getSession, not pageRole — see the note on teach/page.tsx's own. */
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
 *
 * Which also means the owner is the one who mistypes them, and for a long time
 * that was permanent: the list could only be added to. So each row now carries the
 * three repairs, and which of them is offered depends on what the centre has
 * already built on top of the subject — see `lib/settings/retire.ts`, which the
 * actions behind the buttons call again.
 */
export default async function SubjectsPage() {
  const session = await pageRole('manager')
  const supabase = await createClient()
  const locale = session.locale
  const d = dict(locale)
  const t = d.settings.subjects
  const e = t.errors

  const [{ data: subjects }, uses] = await Promise.all([
    supabase
      .from('subjects')
      .select('id, name, name_bn, active')
      .eq('coaching_center_id', session.active.centerId)
      .order('name', { ascending: true }),
    // What points at each of them, counted once for the whole list rather than
    // four queries per row. The same reader both actions use.
    readSubjectUses(supabase, session.active.centerId),
  ])

  const rows = subjects ?? []
  const activeCount = rows.filter((s) => s.active).length
  const limit = session.plan.maxSubjects
  const atCap = limit !== null && activeCount >= limit
  // Built where `limit` is still narrowed to a number, and used twice: as the card
  // under the list, and as the reason a subject cannot be switched back on.
  const capSentence = limit === null ? null : t.cap(planName(session.plan, locale), limit)

  /**
   * Why a subject cannot be removed, or null when nothing points at it.
   *
   * The action's own sentence, in the action's own words, so the panel explains a
   * refusal exactly as the refusal would arrive. Written out case by case rather
   * than as a chain of ternaries so that a fourth `SubjectDeleteVerdict` is a type
   * error here instead of a delete button that quietly starts appearing.
   *
   * `null` for the whole map means a count did not run: nothing is claimed and
   * both repairs refuse, because a zero we invented is how a subject half the
   * timetable teaches would get deleted.
   */
  function removeReason(use: SubjectUse | null): string | null {
    if (!use) return e.checkFailed
    switch (subjectDeleteVerdict(use)) {
      case 'batches':
        return e.deleteBatches(use.batchCount)
      case 'enrolments':
        return e.deleteEnrolments(use.enrolmentCount)
      case 'exams':
        return e.deleteExams(use.examCount)
      case 'ok':
        return null
    }
  }

  /** Why it cannot be turned off, or null. */
  function offReason(use: SubjectUse | null): string | null {
    if (!use) return e.checkFailed
    switch (subjectOffVerdict(use)) {
      case 'liveBatches':
        return e.offLiveBatches(use.liveBatchCount)
      case 'ok':
        return null
    }
  }

  // Turning one back on is an addition as far as the plan is concerned, and the
  // sentence that says so already exists: it names the plan and its number, which
  // an owner deciding what to do next needs and `errors.planLimit` deliberately
  // does not say.
  const onReason = atCap ? capSentence : null

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
            const use = uses ? (uses.get(subject.id) ?? emptySubjectUse()) : null
            return (
              <SettingsListRow
                key={subject.id}
                id={subject.id}
                idField="subjectId"
                name={primary}
                nameBn={subject.name_bn ?? ''}
                otherName={locale === 'en' ? subject.name_bn : subject.name}
                active={subject.active}
                count={use ? use.batchCount : null}
                countNoun={t.batches(use?.batchCount ?? 0)}
                blockedReason={removeReason(use)}
                offBlockedReason={offReason(use)}
                onBlockedReason={onReason}
                rename={renameSubject}
                setActive={setSubjectActive}
                remove={deleteSubject}
                nameLabel={t.nameLabel}
                placeholder="Mathematics"
                placeholderBn="গণিত"
                t={d.settingsListRow}
                common={d.common}
              />
            )
          })}
        </ul>
      )}

      {atCap ? (
        <Card>
          <p className="font-medium text-ink">{t.capTitle}</p>
          <p className="mt-1 text-sm text-ink-soft">{capSentence}</p>
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
