import Link from 'next/link'

import { pageRole, getSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { dict, localName, DEFAULT_LOCALE } from '@/lib/i18n'
import { examTypeDeleteVerdict, type ExamTypeUse } from '@/lib/settings/retire'
import { readExamTypeUses } from '@/lib/settings/usage'
import {
  createExamType,
  renameExamType,
  setExamTypeActive,
  deleteExamType,
} from '../actions'
import { QuickAdd } from '../quick-add'
import { SettingsListRow } from '../list-row'

/** getSession, not pageRole — see the note on teach/page.tsx's own. */
export async function generateMetadata() {
  const session = await getSession()
  const locale = session?.locale ?? DEFAULT_LOCALE
  return { title: `${dict(locale).settings.examTypes.title} — CoachDesk` }
}

/**
 * Exam types, per centre.
 *
 * Every centre names its assessments differently — সাপ্তাহিক পরীক্ষা, মডেল টেস্ট,
 * ডেইলি ভাইভা — and the name ends up in the SMS parents read. No plan limit
 * here: it costs us nothing and constraining it would only make the app feel
 * like it belongs to us rather than to them.
 *
 * Which is also why the name has to be correctable, and why a kind is turned off
 * rather than removed once it has been used: the name on this list is the name on
 * every exam ever held under it, including the ones already read by a guardian.
 * There is no cap, so no reason to refuse the off switch — the only refusal here is
 * a removal that would strip the kind off exams that were actually sat.
 */
export default async function ExamTypesPage() {
  const session = await pageRole('manager')
  const supabase = await createClient()
  const locale = session.locale
  const d = dict(locale)
  const t = d.settings.examTypes
  const e = t.errors

  const [{ data: examTypes }, uses] = await Promise.all([
    supabase
      .from('exam_types')
      .select('id, name, name_bn, active')
      .eq('coaching_center_id', session.active.centerId)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    // Counted once for the whole list, by the same reader the delete action uses.
    readExamTypeUses(supabase, session.active.centerId),
  ])

  const rows = examTypes ?? []

  /**
   * Why a kind cannot be removed, or null when no exam was held as it.
   *
   * `null` for the whole map means the count did not run, and nothing is claimed:
   * no row shows a number it does not have, and the removal refuses in the action's
   * own words rather than going ahead on a zero nobody counted.
   */
  function removeReason(use: ExamTypeUse | null): string | null {
    if (!use) return e.checkFailed
    switch (examTypeDeleteVerdict(use)) {
      case 'exams':
        return e.deleteExams(use.examCount)
      case 'ok':
        return null
    }
  }

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
        <p className="mt-1 text-ink-soft">{t.subtitle}</p>
      </div>

      {rows.length > 0 && (
        <ul className="flex flex-col gap-2">
          {rows.map((type) => {
            const primary = localName(type, locale)
            const use = uses ? (uses.get(type.id) ?? { examCount: 0 }) : null
            return (
              <SettingsListRow
                key={type.id}
                id={type.id}
                idField="examTypeId"
                name={primary}
                nameBn={type.name_bn ?? ''}
                otherName={locale === 'en' ? type.name_bn : type.name}
                active={type.active}
                count={use ? use.examCount : null}
                countNoun={t.exams(use?.examCount ?? 0)}
                blockedReason={removeReason(use)}
                // Nothing to refuse either way: no plan counts exam kinds, and a
                // kind that leaves the picker takes nothing with it.
                offBlockedReason={null}
                onBlockedReason={null}
                rename={renameExamType}
                setActive={setExamTypeActive}
                remove={deleteExamType}
                nameLabel={t.nameLabel}
                placeholder="Weekly Test"
                placeholderBn="সাপ্তাহিক পরীক্ষা"
                t={d.settingsListRow}
                common={d.common}
              />
            )
          })}
        </ul>
      )}

      <QuickAdd
        action={createExamType}
        common={d.common}
        label={t.nameLabel}
        placeholder="Weekly Test"
        placeholderBn="সাপ্তাহিক পরীক্ষা"
      />
    </div>
  )
}
