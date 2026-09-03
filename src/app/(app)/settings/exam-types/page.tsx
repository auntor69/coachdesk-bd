import Link from 'next/link'

import { Card } from '@/components/ui'
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
 *
 * A LIST AND A RAIL FROM `xl`, and the same rail as the subject screen because it is
 * the same form. The arithmetic is written out there.
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

  /*
   * No cap on exam kinds, so nothing here was claiming a number. What an unread list
   * drew was worse in one specific way: nothing at all above the add box, on a screen
   * whose whole content is names an owner typed. সাপ্তাহিক পরীক্ষা gets typed a
   * second time, and now there are two kinds with one name across the exam history.
   *
   * The add box goes with it. A form over a list that failed to load is how the
   * duplicate gets made.
   */
  if (examTypes === null) {
    return (
      <div className="flex max-w-2xl flex-col gap-5">
        <Link
          href="/settings"
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← {d.settings.hub.title}
        </Link>
        <h1 className="text-xl font-bold text-ink lg:text-2xl">{t.title}</h1>
        <Card className="border-late/30 bg-late/5">
          <p className="font-medium text-ink">{d.settings.listUnreadable}</p>
        </Card>
      </div>
    )
  }

  const rows = examTypes

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
    <div className="flex flex-col gap-5 xl:grid xl:grid-cols-12 xl:items-start xl:gap-6">
      <div className="min-w-0 xl:col-span-12">
        <Link
          href="/settings"
          className="inline-flex min-h-tap items-center text-ink-soft hover:text-ink"
        >
          ← {d.settings.hub.title}
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink lg:text-2xl">{t.title}</h1>
        <p className="mt-1 text-ink-soft">{t.subtitle}</p>
      </div>

      {rows.length > 0 && (
        <ul className="flex flex-col gap-2 xl:col-span-7">
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

      {/* The rail, sticky past a long list and last on a phone, for the reasons the
          subject screen's own carries. No cap card to swap for: a centre may name as
          many kinds of exam as it holds. */}
      <div className="xl:sticky xl:top-8 xl:col-span-5">
        <QuickAdd
          action={createExamType}
          common={d.common}
          label={t.nameLabel}
          placeholder="Weekly Test"
          placeholderBn="সাপ্তাহিক পরীক্ষা"
        />
      </div>
    </div>
  )
}
