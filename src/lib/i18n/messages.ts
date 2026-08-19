/**
 * The two sentences that quote a number the code enforces.
 *
 * Both are `{n}` templates in the dictionaries, filled here from the constant the
 * check actually reads, so moving a limit moves the message with it. That is the
 * whole reason this file exists: a form that refuses at eight characters while
 * telling the reader six is somebody who cannot sign up and cannot tell why.
 *
 * Server-side only in practice — every caller is a Server Action — which is why
 * pulling the dictionaries in here is free. The constants themselves live in
 * import-free modules (`../limits.ts`, `../auth/password.ts`) precisely so the
 * browser forms can read them without dragging both languages along.
 *
 * `digits` on both numbers: they sit inside a sentence, so they follow the
 * sentence's script — ৮০ in Bangla, 80 in English. Money, marks and headcounts
 * stay ASCII in both languages because those get read off against a register.
 */

import { MAX_NAME } from '../limits.ts'
import { MIN_PASSWORD } from '../auth/password.ts'
import { digits } from '../bd/time.ts'
import { dict } from './index.ts'
import { fill } from './fill.ts'
import type { Locale } from './locale.ts'

/** Every name an owner types is capped the same way. See `MAX_NAME`. */
export function nameTooLong(locale: Locale): string {
  return fill(dict(locale).common.nameTooLong, { n: digits(MAX_NAME, locale) })
}

/** Signing yourself up, and an owner issuing a teacher their first password. */
export function passwordTooShort(locale: Locale): string {
  return fill(dict(locale).common.passwordTooShort, {
    n: digits(MIN_PASSWORD, locale),
  })
}
