import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  deleteVerdict,
  figuresVerdict,
  type ExamEditFacts,
} from '../src/lib/exams/edit.ts'

/** An exam nothing depends on yet, overridden one fact at a time. */
function facts(over: Partial<ExamEditFacts> = {}): ExamEditFacts {
  return {
    markCount: 0,
    highestMark: null,
    noticeCount: 0,
    smsSent: false,
    ...over,
  }
}

test('an exam nobody has marked and nobody was told about can go', () => {
  assert.equal(deleteVerdict(facts()), 'ok')
})

test('marks hold an exam, and that is the one a teacher will meet', () => {
  assert.equal(deleteVerdict(facts({ markCount: 1, highestMark: 12 })), 'marked')

  // A sheet of nothing but absences is still a sheet somebody filled in.
  assert.equal(deleteVerdict(facts({ markCount: 3, highestMark: null })), 'marked')
})

test('a family already told outranks the marks under it', () => {
  // Both are true of the same exam; the sentence the teacher reads should be the one
  // about the messages, because clearing the sheet will not unsend them.
  assert.equal(
    deleteVerdict(facts({ markCount: 8, highestMark: 40, noticeCount: 2 })),
    'told',
  )
})

test('a metered send outranks everything', () => {
  assert.equal(
    deleteVerdict(
      facts({ markCount: 8, highestMark: 40, noticeCount: 2, smsSent: true }),
    ),
    'sent',
  )

  // And on its own, which is what an exam sent before anybody tapped through looks
  // like: the gate reads saved marks, so the marks are there, but no notice row is.
  assert.equal(deleteVerdict(facts({ markCount: 8, highestMark: 40, smsSent: true })), 'sent')
})

test('the figures may move while nothing has been sent', () => {
  assert.equal(
    figuresVerdict(facts(), { total: 50, pass: null }, { total: 100, pass: 33 }),
    'ok',
  )
})

test('a total cannot drop under a mark already entered', () => {
  // The failure this exists for: 78/100 becomes 78/50 and every percentage built
  // from it reads 156%. Nothing in the database stops it — the trigger guards
  // writes to the marks, not to the exam.
  assert.equal(
    figuresVerdict(
      facts({ markCount: 4, highestMark: 78 }),
      { total: 100, pass: null },
      { total: 50, pass: null },
    ),
    'belowMark',
  )

  // Exactly the highest mark is fine: 78 out of 78 is a full paper, not an error.
  assert.equal(
    figuresVerdict(
      facts({ markCount: 4, highestMark: 78 }),
      { total: 100, pass: null },
      { total: 78, pass: null },
    ),
    'ok',
  )

  // Raising it is always fine, and so is lowering it on a sheet with no mark on it.
  assert.equal(
    figuresVerdict(
      facts({ markCount: 4, highestMark: 78 }),
      { total: 100, pass: null },
      { total: 200, pass: null },
    ),
    'ok',
  )
  assert.equal(
    figuresVerdict(
      facts({ markCount: 4, highestMark: null }),
      { total: 100, pass: null },
      { total: 20, pass: null },
    ),
    'ok',
  )
})

test('a metered send freezes both figures', () => {
  assert.equal(
    figuresVerdict(
      facts({ markCount: 8, highestMark: 30, smsSent: true }),
      { total: 40, pass: null },
      { total: 100, pass: null },
    ),
    'sent',
  )

  // The pass mark too, though no message quotes it: it decides the word "passed" on
  // the printed report, and that report is read next to the message.
  assert.equal(
    figuresVerdict(
      facts({ markCount: 8, highestMark: 30, smsSent: true }),
      { total: 40, pass: null },
      { total: 40, pass: 20 },
    ),
    'sent',
  )
})

test('an unchanged figure is never refused, whatever has been sent', () => {
  // A teacher fixing a spelling on a sent exam re-submits the same numbers. Refusing
  // that would make the typo permanent, which is the bug this file was written for.
  assert.equal(
    figuresVerdict(
      facts({ markCount: 8, highestMark: 30, noticeCount: 8, smsSent: true }),
      { total: 40, pass: 15 },
      { total: 40, pass: 15 },
    ),
    'ok',
  )

  // Including the case where the marks already exceed a total nobody is changing —
  // an exam that arrived in that state is not repaired by blocking the title.
  assert.equal(
    figuresVerdict(
      facts({ markCount: 8, highestMark: 90 }),
      { total: 40, pass: null },
      { total: 40, pass: null },
    ),
    'ok',
  )
})

test('a pass mark being cleared is a change, and null is not zero', () => {
  assert.equal(
    figuresVerdict(
      facts({ smsSent: true }),
      { total: 40, pass: 15 },
      { total: 40, pass: null },
    ),
    'sent',
  )

  // Nothing sent, so clearing it is simply allowed — the point of the pair above is
  // that null and a number are different answers, not that either is refused.
  assert.equal(
    figuresVerdict(facts(), { total: 40, pass: 15 }, { total: 40, pass: null }),
    'ok',
  )
})
