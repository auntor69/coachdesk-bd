/**
 * The ways money changes hands, in the order every screen offers them.
 *
 * ONE LIST, BECAUSE THERE WERE FIVE AND THEY DRIFTED. 20260811000041 added `card` to
 * the enum and named six places in the TypeScript that had to follow: three
 * `Record<PaymentMethod, string>` label maps, which are compile errors and were caught,
 * and three runtime lists, which are not and were fixed by hand. It missed a seventh —
 * `REGISTER_METHODS` in ./register.ts — and the consequence was the quiet kind: a card
 * payment counted in the collection register's total and appearing in none of the lines
 * of its by-method breakdown, so the breakdown stopped adding up to the figure above it
 * on the one screen in the product whose entire purpose is to be checked against a
 * wallet statement.
 *
 * A comment in a migration asking future readers to remember four files is not a
 * mechanism. This is: one array, one compile-time exhaustiveness check, and every list
 * that used to be typed out by hand now reads from here. The next value added to the
 * enum breaks the build in exactly one place, and that place is a list to add a word to.
 *
 * NOT IN method-picker.tsx, which is where the longest of those lists lived. That file
 * is `'use client'`, and a server-side module importing from a client component to get a
 * constant is backwards — `./register.ts` is unit-tested under `node --test`, which
 * knows nothing about React. A plain module both can read is the shape that works, the
 * same call ../students/status.ts made about its own list.
 *
 * Relative import with the extension, like every other unit-tested module here: these
 * tests resolve neither tsconfig paths nor extensionless specifiers.
 */
import type { PaymentMethod } from '../supabase/types.ts'

/**
 * Cash first, then the three wallets, then the bank, the card machine, and the
 * catch-all.
 *
 * THE ORDER IS THE COLLECTION FORM'S, and it is load-bearing in two places: the chips a
 * receptionist taps with a parent in front of them are read left to right in frequency
 * order, and the breakdown at the foot of a printed register is a fixed set of lines so
 * that two months held side by side have their figures in the same places.
 *
 * `other` stays last because it is the answer when the truth is not on the list, and
 * `card` immediately before it because that is where the enum puts it — 20260811000041
 * inserted the value `before 'other'` precisely so a picker built by reading the enum in
 * order would need no separate instruction.
 *
 * `as const satisfies` catches a value that is not a method. What it does not catch is
 * the other direction — a widened enum leaves this list valid and one method missing —
 * which is what `ALL_METHODS_LISTED` below is for.
 */
export const PAYMENT_METHODS = [
  'cash',
  'bkash',
  'nagad',
  'rocket',
  'bank_transfer',
  'card',
  'other',
] as const satisfies readonly PaymentMethod[]

/** Whatever the list above left out. `never` while it is complete. */
type Unlisted = Exclude<PaymentMethod, (typeof PAYMENT_METHODS)[number]>

/**
 * Nothing at runtime, and a compile error the moment `Unlisted` stops being `never`.
 *
 * This is the whole mechanism. A migration that adds a wallet to `payment_method`
 * regenerates src/lib/supabase/types.ts, and the next `tsc --noEmit` fails here — in a
 * file whose next line is the list to add the wallet to — instead of in none of the five
 * places that used to hold a copy of it.
 *
 * Exported rather than left a floating `const` so it is not an unused binding, and so
 * the error names something greppable.
 */
export const ALL_METHODS_LISTED: Unlisted extends never ? true : Unlisted = true
