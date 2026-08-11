import Link from 'next/link'

import { Card } from '@/components/ui'
import { requireRole } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { createSubject } from '../actions'
import { QuickAdd } from '../quick-add'

export const metadata = { title: 'বিষয় — CoachDesk' }

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
          ← সেটিংস
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink">বিষয়</h1>
        <p className="mt-1 text-ink-soft">
          {limit === null ? (
            <>
              <span className="num">{activeCount}</span>টি বিষয়
            </>
          ) : (
            <>
              <span className="num">{activeCount}</span>/
              <span className="num">{limit}</span>টি বিষয় ব্যবহার হয়েছে
            </>
          )}
        </p>
      </div>

      {rows.length > 0 && (
        <ul className="flex flex-col gap-2">
          {rows.map((subject) => (
            <li
              key={subject.id}
              className="flex items-center justify-between gap-3 rounded-xl
                border border-line bg-white px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-ink">
                  {subject.name_bn || subject.name}
                </p>
                {subject.name_bn && (
                  <p className="truncate text-sm text-ink-faint">{subject.name}</p>
                )}
              </div>
              <span className="shrink-0 text-sm text-ink-soft">
                <span className="num">{(subject.batches ?? []).length}</span> ব্যাচ
              </span>
            </li>
          ))}
        </ul>
      )}

      {limit !== null && activeCount >= limit ? (
        <Card>
          <p className="font-medium text-ink">এই প্ল্যানে আর বিষয় যোগ করা যাবে না</p>
          <p className="mt-1 text-sm text-ink-soft">
            ফ্রি প্ল্যানে <span className="num">{limit}</span>টি বিষয়। সব ফিচার খোলা
            থাকে — শুধু সংখ্যার সীমা।
          </p>
        </Card>
      ) : (
        <QuickAdd
          action={createSubject}
          label="বিষয়ের নাম"
          hint="যেমন Mathematics — তালিকায় বাংলা নামটাই দেখানো হবে"
          placeholder="Mathematics"
          placeholderBn="গণিত"
        />
      )}
    </div>
  )
}
