'use client'

/**
 * The teacher list, with each teacher's permissions editable in place.
 *
 * Permissions are per-teacher rather than per-role because real centres are not
 * tidy: one senior teacher collects fees and edits the roster, another only marks
 * attendance. Collapsed behind a summary, because on a phone five checkboxes per
 * teacher would bury the list itself — and reading the list is the common case,
 * editing is the rare one.
 */
import { useActionState } from 'react'

import { Alert } from '@/components/ui'
import { formatBdMobile } from '@/lib/bd/phone'
import { saveTeacherPermissions, toggleTeacherActive, type ActionState } from '../actions'

export type TeacherRow = {
  id: string
  name: string
  phone: string | null
  active: boolean
  hasLogin: boolean
  subjects: string[]
  batchCount: number
  permissions: Record<string, boolean>
}

/** Same five as the add form, same order, same labels. */
const PERMISSIONS = [
  { name: 'can_manage_exams', label: 'পরীক্ষা ও নম্বর' },
  { name: 'can_send_sms', label: 'অভিভাবককে SMS' },
  { name: 'can_manage_students', label: 'শিক্ষার্থী যোগ ও সম্পাদনা' },
  { name: 'can_manage_batches', label: 'ব্যাচ তৈরি ও বদল' },
  { name: 'can_view_fees', label: 'ফি দেখা' },
] as const

/** The short summary line under each name. */
function grantedLabels(permissions: Record<string, boolean>): string[] {
  return PERMISSIONS.filter((p) => permissions[p.name]).map((p) => p.label)
}

export function TeacherList({ teachers }: { teachers: TeacherRow[] }) {
  const [permState, permAction, permPending] = useActionState<ActionState, FormData>(
    saveTeacherPermissions,
    null,
  )
  const [activeState, activeAction, activePending] = useActionState<
    ActionState,
    FormData
  >(toggleTeacherActive, null)

  const error = permState?.error || activeState?.error
  const ok = permState?.ok || activeState?.ok

  return (
    <section className="flex flex-col gap-2">
      {error && <Alert>{error}</Alert>}
      {ok && (
        <p role="status" className="text-sm font-medium text-brand-700">
          {ok}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {teachers.map((teacher) => {
          const granted = grantedLabels(teacher.permissions)

          return (
            <li
              key={teacher.id}
              className="rounded-xl border border-line bg-white px-4 py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">
                    {teacher.name}
                    {!teacher.active && (
                      <span className="ml-2 text-sm text-ink-faint">বন্ধ</span>
                    )}
                  </p>
                  {teacher.subjects.length > 0 && (
                    <p className="truncate text-sm text-ink-soft">
                      {teacher.subjects.join(' · ')}
                    </p>
                  )}
                  <p className="text-sm text-ink-faint">
                    <span className="num">{teacher.batchCount}</span> ব্যাচ
                    {granted.length > 0 && ` · ${granted.join(', ')}`}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  {teacher.phone && (
                    <p className="num text-sm text-ink-soft">
                      {formatBdMobile(teacher.phone)}
                    </p>
                  )}
                  {!teacher.hasLogin && <p className="text-xs text-late">লগইন নেই</p>}
                </div>
              </div>

              <details className="mt-2 border-t border-line pt-2">
                <summary className="min-h-tap cursor-pointer text-sm font-medium text-brand-700">
                  অনুমতি বদলান
                </summary>

                <form action={permAction} className="mt-2 flex flex-col gap-2">
                  <input type="hidden" name="teacherId" value={teacher.id} />
                  {PERMISSIONS.map((permission) => (
                    <label
                      key={permission.name}
                      className="flex min-h-tap cursor-pointer items-center gap-3"
                    >
                      <input
                        type="checkbox"
                        name={permission.name}
                        defaultChecked={teacher.permissions[permission.name] ?? false}
                        className="h-5 w-5 shrink-0 accent-brand-600"
                      />
                      <span className="text-ink">{permission.label}</span>
                    </label>
                  ))}
                  <button
                    type="submit"
                    disabled={permPending}
                    className="min-h-tap self-start rounded-lg border-2 border-brand-500
                      bg-brand-50 px-4 text-sm font-semibold text-brand-700
                      disabled:opacity-50"
                  >
                    {permPending ? 'সেভ হচ্ছে…' : 'অনুমতি সেভ করুন'}
                  </button>
                </form>

                <form
                  action={activeAction}
                  className="mt-3 border-t border-line pt-3"
                >
                  <input type="hidden" name="teacherId" value={teacher.id} />
                  <input
                    type="hidden"
                    name="active"
                    value={teacher.active ? 'false' : 'true'}
                  />
                  <p className="mb-2 text-sm text-ink-soft">
                    {teacher.active
                      ? 'বন্ধ করলে তিনি আর তাঁর ব্যাচ, শিক্ষার্থী বা অভিভাবকের নম্বর দেখতে পাবেন না। আগের হাজিরা আর নম্বর মুছে যাবে না।'
                      : 'চালু করলে তিনি আবার তাঁর ব্যাচের হাজিরা ও নম্বর দিতে পারবেন।'}
                  </p>
                  <button
                    type="submit"
                    disabled={activePending}
                    className={`min-h-tap rounded-lg border-2 px-4 text-sm font-semibold
                      disabled:opacity-50 ${
                        teacher.active
                          ? 'border-absent/40 bg-absent/5 text-absent'
                          : 'border-brand-500 bg-brand-50 text-brand-700'
                      }`}
                  >
                    {teacher.active ? 'শিক্ষককে বন্ধ করুন' : 'আবার চালু করুন'}
                  </button>
                </form>
              </details>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
