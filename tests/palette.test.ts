/**
 * One green, one red, one amber — the only three colours in this app that mean anything.
 *
 * WHY THIS FILE EXISTS. `present`, `absent` and `late` are the trio §3.7 and the register
 * were built on: a child who came, a child who did not, a child who came late. Every other
 * screen says its own version of the same three facts with the same three names — a paid
 * invoice and a failed action are `absent`; a trial running out and a notice that is not
 * live are `late` — which is what makes "red means something went wrong" true across
 * eleven screens rather than true on one of them.
 *
 * A screen that reaches into Tailwind's own palette instead is not styling, it is a second
 * definition. `text-red-700` is #b91c1c beside `text-absent`'s #dc2626: two reds a shade
 * apart, drawn side by side on the founder panel, reading as two different kinds of wrong
 * — and nothing on that screen tells a reader which is which. That is where this was found
 * (see the notes in founder/page.tsx and founder/money/page.tsx), and the sweep that
 * followed it is what the first test below now holds in place: the amber on the SMS screen
 * and the two notices over the attendance register were the same defect, and each had
 * already been given whatever shade of amber the person writing it had in mind.
 *
 * WHAT IS DELIBERATELY NOT BANNED. `white`, `black`, `transparent`, `current` and the
 * `inherit` default: each has one meaning everywhere and none of them is a warning, which
 * is the whole of what the tokens are for. `brand` is this app's own ramp and is the
 * colour of the product rather than of a fact, so `bg-brand-50` stays where it is.
 *
 * AND THE GATE IS ON THE CODE, NOT ON THE PROSE. Both files that made this change explain
 * it by naming the class they removed, and a rule that fails on its own explanation is a
 * rule somebody deletes. Comments come off before anything is matched.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.join(import.meta.dirname, '..')

/** CRLF out, because a `\n` anchor in a CRLF file silently matches nothing. */
const read = (...parts: string[]) =>
  readFileSync(path.join(ROOT, ...parts), 'utf8').replaceAll('\r\n', '\n')

/**
 * Tailwind's own named colours, which are the ones this app has a token for instead.
 *
 * `grey` is here with `gray` because both spellings resolve in Tailwind, and a ban that
 * caught one of two spellings is a ban somebody would work around by accident.
 */
const PALETTE = [
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
  'slate',
  'gray',
  'grey',
  'zinc',
  'neutral',
  'stone',
]

/**
 * The utilities a colour can arrive through. Every one of them takes a `-<colour>-<shade>`
 * in Tailwind, and the list is spelled out rather than written as `\w+` so that a class
 * like `min-w-[26rem]` or `shadow-lg` cannot be read as a colour by a future reader of
 * this file.
 */
const UTILITIES = [
  'bg',
  'text',
  'border',
  'divide',
  'ring',
  'outline',
  'decoration',
  'placeholder',
  'accent',
  'caret',
  'fill',
  'stroke',
  'from',
  'via',
  'to',
  'shadow',
]

/**
 * `<utility>-<colour>` with no digits required, because `border-amber` and `bg-red` are
 * valid Tailwind too — the 500 is the default shade and writing it out is optional.
 *
 * The variant chain in front (`hover:`, `lg:`, `print:`) is part of the match rather than a
 * boundary, because `hover:bg-red-500` is exactly the shape this is looking for and a
 * `(?<![\w-])` anchor alone would miss it.
 */
const BANNED = new RegExp(
  String.raw`(?<![\w-])(?:[a-z][a-z0-9-]*:)*(?:${UTILITIES.join('|')})-(?:${PALETTE.join(
    '|',
  )})(?:-[0-9]{1,3})?(?![\w-])`,
  'g',
)

/**
 * An invented colour, which is the same defect with the shade chosen by hand:
 * `bg-[#dc2626]`, `text-[rgb(220,38,38)]`. Only colour-shaped arbitrary values, so the
 * layout ones the codebase does use — `max-w-[12rem]`, `min-w-[26rem]` — stay legal.
 */
const ARBITRARY = new RegExp(
  String.raw`(?<![\w-])(?:${UTILITIES.join('|')})-\[(?:#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\()`,
  'g',
)

/** `.ts` and `.tsx` under src, which is every file a class name can be written in. */
function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(full))
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) out.push(full)
  }
  return out
}

const FILES = sourceFiles(path.join(ROOT, 'src')).map((file) => ({
  path: path.relative(ROOT, file).replaceAll('\\', '/'),
  // Prose off: the two files that explain the ban name the class they removed, and a rule
  // its own explanation trips is a rule the next person works around.
  code: readFileSync(file, 'utf8')
    .replaceAll('\r\n', '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, ''),
}))

test('the detector catches the palette and leaves the tokens, and their own words, alone', () => {
  // The four shapes the sweep actually found, and the variants a future screen would use.
  for (const offender of [
    'className="text-red-700"',
    'hover:bg-amber-50',
    'border border-red-200 bg-red-50',
    'lg:border-amber-300',
    'divide-rose-300',
    'bg-[#dc2626]',
    'text-[rgb(220,38,38)]',
  ]) {
    assert.ok(
      new RegExp(BANNED).test(offender) || new RegExp(ARBITRARY).test(offender),
      `not caught: ${offender}`,
    )
  }

  // And the other direction, which is what makes this a rule rather than a regex: the
  // semantic three, the brand ramp, and the words for "no colour" all survive it.
  for (const kept of [
    'text-absent',
    'border-late/40 bg-late/5',
    'bg-present',
    'border-absent/30',
    'bg-brand-50 text-brand-800',
    'text-ink-soft',
    'bg-surface-alt border-line',
    'font-semibold text-white',
    'bg-white',
    'min-w-[26rem]',
    'max-w-[12rem]',
    'shadow-lg',
    'text-2xl',
  ]) {
    assert.ok(!new RegExp(BANNED).test(kept), `wrongly banned: ${kept}`)
    assert.ok(!new RegExp(ARBITRARY).test(kept), `wrongly banned: ${kept}`)
  }
})

test('no screen, component or helper names a colour of its own', () => {
  // The sweep, held in place. A new chip in `bg-amber-100` fails here rather than being
  // noticed by whoever looks at that screen next to the one it disagrees with.
  const offenders = FILES.filter(
    (f) => new RegExp(BANNED).test(f.code) || new RegExp(ARBITRARY).test(f.code),
  ).map((f) => f.path)

  assert.deepEqual(offenders, [], `named a colour instead of a token: ${offenders.join(', ')}`)
})

test('the palette is one green, one red, one amber, and the ink beside them', () => {
  // The other half of the ban: the tokens a screen is allowed to use are a closed set, and
  // it is declared in one place. A fourth semantic colour is a real design decision — it
  // needs a word, an icon and a screen that means it — and this is where that decision has
  // to be written down rather than being made by whoever added the class.
  // In the order the file declares them: the ramp, then the three the register reads by,
  // then the ink. Sorted rather than listed in `@theme`'s own order would put `brand-100`
  // above `brand-50` — the same trap that makes an alphabetised migration list wrong.
  const css = read('src', 'app', 'globals.css')
  const declared = [...css.matchAll(/--color-([a-z0-9-]+)\s*:/g)].map((m) => m[1])

  assert.deepEqual(declared, [
    'brand-50',
    'brand-100',
    'brand-200',
    'brand-300',
    'brand-400',
    'brand-500',
    'brand-600',
    'brand-700',
    'brand-800',
    'brand-900',
    'present',
    'absent',
    'late',
    'ink',
    'ink-soft',
    'ink-faint',
    'surface',
    'surface-alt',
    'line',
  ])

  // And the one pair the ban depends on being distinguishable is stated where both are
  // declared: absent and late are the two the app says "wrong" and "not yet urgent" in.
  assert.match(css, /--color-absent: #[0-9a-f]{6};/)
  assert.match(css, /--color-late: #[0-9a-f]{6};/)
})

/**
 * WCAG 2.1 relative luminance, and the contrast ratio two colours make with it.
 *
 * The arithmetic rather than an eyeball, because the token that failed this was invisible
 * to every screen review it went through: `ink-faint` was #9ca3af, which looks like a
 * perfectly ordinary light grey on white and measures 2.54:1 — under AA's 4.5:1 for text
 * below 18pt, and this token is nav group headings, hints and the login screen's "forgot"
 * line rather than decoration. On a mid-range Android in a bright room, which is the device
 * MASTERPLAN's whole interface section is written for, it is the difference between faint
 * and absent.
 */
function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16)
  const [r, g, b] = [value >> 16, (value >> 8) & 0xff, value & 0xff]
    .map((channel) => channel / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (high + 0.05) / (low + 0.05)
}

test('every ink is readable on every surface it is drawn on', () => {
  const css = read('src', 'app', 'globals.css')
  const token = (name: string) => {
    const found = css.match(new RegExp('--color-' + name + ': (#[0-9a-f]{6});'))
    assert.ok(found, 'no such token: ' + name)
    return found[1]
  }

  // The three inks against the three backgrounds they are actually set on: the page, a
  // card, and the brand-tinted panel the dashboard's headline figure uses. `line` is a
  // border and is not text, so it is not here.
  for (const ink of ['ink', 'ink-soft', 'ink-faint']) {
    for (const surface of ['surface', 'surface-alt', 'brand-50']) {
      const ratio = contrast(token(ink), token(surface))
      assert.ok(
        ratio >= 4.5,
        ink + ' on ' + surface + ' is ' + ratio.toFixed(2) + ':1, under AA 4.5:1',
      )
    }
  }

  // And the hierarchy those three names carry survives being legible: the faint ink has to
  // stay a clear step lighter than the soft one, or "faint" becomes a third word for the
  // same grey and the sheet has two inks rather than three.
  const onWhite = ['ink', 'ink-soft', 'ink-faint'].map((ink) =>
    contrast(token(ink), token('surface')),
  )
  assert.ok(onWhite[0] > onWhite[1], 'soft must be lighter than ink')
  assert.ok(onWhite[1] > onWhite[2], 'faint must be lighter than soft')
})
