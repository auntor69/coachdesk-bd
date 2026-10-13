/**
 * The one thing an account signs in with, and how to say it (MASTERPLAN §5.3).
 *
 * THE THIRD SHAPE IS WHY THIS FILE EXISTS. The login field has held three kinds of value
 * since §5.4's rewrite — a number, a username a centre minted for a teacher who has none,
 * or the real email address somebody signed themselves up with — and `/account` was
 * written back when there were two. It asked `session.phone || !session.username`, so an
 * email account, which has neither of the other two, took the *number* branch: the card
 * printed `formatBdMobile(null)`, which is the empty string, under the heading "Login
 * number" — and under that, a hint telling the owner of the account to ask the owner of
 * the account to change it.
 *
 * The password form below it failed the same way and less visibly: it built the login
 * address from a number or a username only, so the one thing that screen exists for
 * answered "The password could not be changed. Please try again." — a sentence that blames
 * the reader — for every account the app's own signup creates, which is every account an
 * owner makes for themselves. Nobody can change their own password and the screen says so
 * in the language of a temporary glitch.
 *
 * SO THE QUESTION IS ASKED ONCE, HERE, and both callers ask it. A screen that prints the
 * identifier and an action that signs in with it cannot disagree about which identifier it
 * is, and neither of them can spell the question with two branches again — the shape of
 * the mistake is what is being removed, not just its consequence. `loginEmailFor` is still
 * the only thing that turns an identifier into the address that signs somebody in; this
 * file only decides which identifier is handed to it.
 *
 * EXACTLY ONE OF THE THREE IS SET, and the session is what guarantees it. A real address
 * means a self-serve signup and a null for both of the others, because "real" is decided
 * by the login domain rather than by a column. A number or a username means a synthetic
 * address, and a username login is minted with no phone metadata at all (see
 * `createUsernameLogin`), so a username account has no number that could outrank it. The
 * order below is therefore a preference only in a state nothing can produce — and it is
 * the order the old screen used, so no account that exists reads differently than it did.
 */
import { formatBdMobile } from '../bd/phone.ts'
import { loginEmailFor } from '../bd/username.ts'
import type { T } from '../i18n/index.ts'
import type { Session } from './session.ts'

/**
 * The three fields this asks about, named the way the session names them.
 *
 * Sliced off `Session` rather than re-declared, so a rename in one shows up as a compile
 * error here. A type-only import, so a test can load this file without loading `next/headers`.
 */
export type LoginFields = Pick<Session, 'phone' | 'username' | 'email'>

export type LoginIdentifier =
  | { kind: 'phone'; value: string }
  | { kind: 'username'; value: string }
  | { kind: 'email'; value: string }

/**
 * Which identifier this session holds. Null for a session holding none of the three, which
 * the session itself cannot produce: `email` is null exactly when the login address is one
 * of the two synthetic ones, so a signed-in account with no number, no username and no
 * address is a bug rather than a person. The screen draws no card rather than an empty one,
 * and the password action refuses rather than probing an address it does not have.
 */
export function loginIdentifierOf(who: LoginFields): LoginIdentifier | null {
  if (who.phone) return { kind: 'phone', value: who.phone }
  if (who.username) return { kind: 'username', value: who.username }
  if (who.email) return { kind: 'email', value: who.email }
  return null
}

/**
 * The address that signs this account in — the same dispatch the login screen runs
 * (`loginEmailFor`), applied to the identifier the session actually holds, which is what
 * makes the password form's "current password" check agree with the login it verifies.
 */
export function loginAddressOf(who: LoginFields): string | null {
  const identifier = loginIdentifierOf(who)
  return identifier ? loginEmailFor(identifier.value) : null
}

/**
 * Ready to print: the label, the value as the reader reads it, and one honest sentence
 * about changing it. `numeric` is the phone case, and it is the tabular-figures class
 * rather than a rule about digits — an email address is not a number and has to wrap on a
 * 320px phone, which the phone's eleven digits never do.
 */
export type LoginIdentity = {
  label: string
  value: string
  hint: string
  numeric: boolean
}

/**
 * The words for each kind, keyed by the union rather than switched over.
 *
 * Keyed, so a fourth kind added to `LoginIdentifier` — the fourth thing a login field may
 * hold — does not compile until somebody decides what the card says about it. That is the
 * bug being fixed, stated as a type: three shapes, two branches, and an account the screen
 * had no words for. A `switch` nobody checks for totality would have let the next one
 * through in exactly the same way.
 */
const WORDS: Record<
  LoginIdentifier['kind'],
  (value: string, t: T<'account'>) => LoginIdentity
> = {
  phone: (value, t) => ({
    label: t.phoneLabel,
    value: formatBdMobile(value),
    hint: t.phoneHint,
    numeric: true,
  }),
  username: (value, t) => ({
    label: t.usernameLabel,
    value,
    hint: t.usernameHint,
    numeric: false,
  }),
  email: (value, t) => ({
    label: t.emailLabel,
    value,
    hint: t.emailHint,
    numeric: false,
  }),
}

/** The words for the identifier this session holds, or nothing to print at all. */
export function describeLoginIdentifier(
  who: LoginFields,
  t: T<'account'>,
): LoginIdentity | null {
  const identifier = loginIdentifierOf(who)
  if (!identifier) return null
  return WORDS[identifier.kind](identifier.value, t)
}
