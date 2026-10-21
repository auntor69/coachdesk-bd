import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { readSubjectUses, readExamTypeUses } from '../src/lib/settings/usage.ts'
import { PAGE_SIZE } from '../src/lib/supabase/page.ts'

const ROOT = path.join(import.meta.dirname, '..')
const read = (...parts: string[]) =>
  readFileSync(path.join(ROOT, ...parts), 'utf8').replaceAll('\r\n', '\n')

const EXAMS_ACTIONS = read('src', 'app', '(app)', 'exams', 'actions.ts')
const FEES_ACTIONS = read('src', 'app', '(app)', 'fees', 'actions.ts')
const SETTINGS_ACTIONS = read('src', 'app', '(app)', 'settings', 'actions.ts')
const STAFF_ACTIONS = read('src', 'app', '(app)', 'settings', 'staff', 'actions.ts')
const RESULT_DISPATCH = read('src', 'lib', 'sms', 'result-dispatch.ts')
const ATTENDANCE_ROSTER = read('src', 'app', '(app)', 'teach', '[batchId]', 'attendance-roster.tsx')

function actionSlice(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`)
  assert.ok(start >= 0, `${name} exists`)
  const after = source.indexOf('\nexport async function ', start + 1)
  return after < 0 ? source.slice(start) : source.slice(start, after)
}

test('DATA-01b: saveMarks checks clearError when deleting cleared exam_results', () => {
  const body = actionSlice(EXAMS_ACTIONS, 'saveMarks')
  assert.ok(body.includes('const { error: clearError } = await supabase'))
  assert.ok(body.includes('if (clearError) return { ok: false, error: t.errors.saveFailed }'))
})

test('DATA-01b: settings/actions checks errors on all secondary writes', () => {
  const updateBatch = actionSlice(SETTINGS_ACTIONS, 'updateBatch')
  assert.ok(updateBatch.includes('const { error: subjectSyncError } = await supabase'))
  assert.ok(updateBatch.includes('if (subjectSyncError) return { error: t.batches.errors.saveFailed }'))

  const createStudent = actionSlice(SETTINGS_ACTIONS, 'createStudent')
  assert.ok(createStudent.includes("const { error: guardianError } = await supabase.from('guardians').insert("))
  assert.ok(createStudent.includes('if (guardianError) {'))

  const updateStudent = actionSlice(SETTINGS_ACTIONS, 'updateStudent')
  assert.ok(updateStudent.includes('const { data: touched, error: touchError } = await supabase'))
  assert.ok(updateStudent.includes('if (touchError) return { error: t.students.errors.saveFailed }'))
  assert.ok(updateStudent.includes("const { error: guardianInsertError } = await supabase.from('guardians').insert("))
  assert.ok(updateStudent.includes('if (guardianInsertError) return { error: t.students.errors.saveFailed }'))
  assert.ok(updateStudent.includes('const { error: endError } = await supabase'))
  assert.ok(updateStudent.includes('if (endError) enrolFailure = enrolFailure ?? endError'))

  const updateTeacher = actionSlice(SETTINGS_ACTIONS, 'updateTeacher')
  assert.ok(updateTeacher.includes('const { error: clearSubjectsError } = await supabase'))
  assert.ok(updateTeacher.includes('if (clearSubjectsError) return { error: t.errors.saveFailed }'))
  assert.ok(updateTeacher.includes("const { error: insertSubjectsError } = await supabase.from('teacher_subjects').insert("))
  assert.ok(updateTeacher.includes('if (insertSubjectsError) return { error: t.errors.saveFailed }'))

  const toggleTeacher = actionSlice(SETTINGS_ACTIONS, 'toggleTeacherActive')
  assert.ok(toggleTeacher.includes('const { error: memberError } = active'))
  assert.ok(toggleTeacher.includes('if (memberError) return { error: t.errors.changeFailed }'))

  const giveLogin = actionSlice(SETTINGS_ACTIONS, 'giveTeacherLogin')
  assert.ok(giveLogin.includes("const { error: memberError } = await supabase.from('center_members').upsert("))
  assert.ok(giveLogin.includes('if (memberError) return { error: t.teachers.errors.loginFailed }'))
})

test('DATA-01b: staff/actions verifies row count on update and revalidates /payroll', () => {
  const save = actionSlice(STAFF_ACTIONS, 'saveEmployee')
  assert.ok(save.includes(".select('id')"))
  assert.ok(save.includes('if (error || !saved || saved.length === 0) return { error: t.errors.saveFailed }'))
  assert.ok(save.includes("revalidatePath('/payroll')"))

  const setActive = actionSlice(STAFF_ACTIONS, 'setEmployeeActive')
  assert.equal(setActive.split(".select('id')").length - 1, 2)
  assert.equal(
    setActive.split('if (error || !saved || saved.length === 0) return { error: t.errors.changeFailed }').length - 1,
    2,
  )
  assert.equal(setActive.split("revalidatePath('/payroll')").length - 1, 2)
})

test('FUNC-03: createBatch, updateBatch, and recordPayment enforce MAX_TAKA', () => {
  const createBatch = actionSlice(SETTINGS_ACTIONS, 'createBatch')
  assert.ok(createBatch.includes('monthlyFee > MAX_TAKA'))

  const updateBatch = actionSlice(SETTINGS_ACTIONS, 'updateBatch')
  assert.ok(updateBatch.includes('monthlyFee > MAX_TAKA'))

  const recordPayment = actionSlice(FEES_ACTIONS, 'recordPayment')
  assert.ok(recordPayment.includes('if (amount === null || amount > MAX_TAKA) return { error: t.errors.amountUnreadable }'))
})

test('FUNC-01: planResultSms selects enrollment status and counts only active enrollments toward withoutMarks', () => {
  const body = actionSlice(RESULT_DISPATCH, 'planResultSms')
  assert.match(body, /enrollments \(\s+id,\s+status,\s+students \(/)
  assert.ok(body.includes("if (!enrollment?.status || enrollment.status === 'active') {"))
  assert.ok(body.includes('withoutMarks: Math.max(0, rosterSize - activeResultCount),'))
})

test('FUNC-02: readSubjectUses and readExamTypeUses page past PAGE_SIZE via pageOrNull', async () => {
  const totalEnrolments = PAGE_SIZE + 250
  const enrolmentRows = Array.from({ length: totalEnrolments }, () => ({ subject_id: 'sub-1' }))
  const examRows = Array.from({ length: PAGE_SIZE + 10 }, () => ({
    subject_id: 'sub-1',
    exam_type_id: 'kind-1',
  }))
  const batchRows = [{ subject_id: 'sub-1', active: true }]

  const fakeSupabase = {
    from(table: string) {
      const source =
        table === 'batches' ? batchRows : table === 'enrollments' ? enrolmentRows : examRows
      return {
        select() {
          return {
            eq() {
              return {
                order() {
                  return {
                    range: async (from: number, to: number) => ({
                      data: source.slice(from, Math.min(to + 1, from + PAGE_SIZE)),
                      error: null,
                    }),
                  }
                },
              }
            },
          }
        },
      }
    },
  }

  const subjectUses = await readSubjectUses(fakeSupabase as never, 'c1')
  assert.ok(subjectUses)
  assert.deepEqual(subjectUses.get('sub-1'), {
    batchCount: 1,
    liveBatchCount: 1,
    enrolmentCount: totalEnrolments,
    examCount: PAGE_SIZE + 10,
  })

  const examTypeUses = await readExamTypeUses(fakeSupabase as never, 'c1')
  assert.ok(examTypeUses)
  assert.deepEqual(examTypeUses.get('kind-1'), {
    examCount: PAGE_SIZE + 10,
  })
})

test('FUNC-04: attendance-roster persists note in draft and updateStudent revalidates student profile', () => {
  assert.ok(ATTENDANCE_ROSTER.includes("const savedNote = typeof draft?.__note === 'string' ? draft.__note : null"))
  assert.ok(ATTENDANCE_ROSTER.includes('writeDraft(draftKey, { ...(latest.current ?? marks), __note: value })'))
  assert.ok(ATTENDANCE_ROSTER.includes('value={currentNote}'))

  const updateStudent = actionSlice(SETTINGS_ACTIONS, 'updateStudent')
  assert.ok(updateStudent.includes('revalidatePath(`/students/${studentId}`)'))
})

