/**
 * Every source file in this repository is text, and has to stay text.
 *
 * WHY A TEST AND NOT A STYLE NOTE. One NUL byte inside a string literal is invisible —
 * nobody chooses to type one, and no editor shows it — and it changes what every tool in
 * the toolchain does with the file that holds it:
 *
 *   * `git diff` stops showing the change and prints "Binary files … differ" instead, so
 *     the file is unreviewable in every pull request that touches it. `git log --numstat`
 *     reports it as `-  -`, which is why the change that carried it in is a commit nobody
 *     can see the contents of.
 *   * `grep` and `rg` skip it, silently, with no marker in the output. A repository-wide
 *     search for a query that forgot its centre filter, or an audit for a rule that must
 *     hold everywhere, answers as though the file did not exist.
 *
 * THAT IS NOT HYPOTHETICAL HERE. `src/lib/finance/branch-money.ts` — the §8.3 branch
 * comparison table, which is money — carried one for weeks inside the sentinel key that
 * stands for head office. Every diff of it was binary, and the two greps above had never
 * read a line of it. The key still needs a value no branch id can be; it is written
 * `'\u0000hq'` now, the escape rather than the byte, which is the same string at runtime
 * and a file a diff can print.
 *
 * The rule is about control characters rather than about NUL alone, because they are all
 * the same accident: a paste that carried a stray byte. Tab, newline and carriage return
 * are how text is laid out and are deliberately allowed; a form feed or a vertical tab in
 * a `.ts` file is a paste, not a layout.
 *
 * Deliberately not a lint rule. ESLint's `no-control-regex` police a regex, not a file,
 * and this has to fail on the bytes — before anything parses them.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.join(import.meta.dirname, '..')

/** Everything that is text in this repository, including the prose and the SQL. */
const ROOTS = ['src', 'supabase', 'tests', 'scripts', 'public', 'docs'] as const

const TEXT_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.sql', '.css', '.json', '.md', '.html', '.txt', '.svg',
] as const

/**
 * Every file under a root, folders and all.
 *
 * `node_modules` and `.next` are skipped by name rather than by being absent: a checkout
 * that has run `npm install` must not turn this test red because a dependency ships a
 * control byte, and neither must a build directory — neither is a file anybody reviews.
 */
function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') {
      continue
    }
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (TEXT_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) out.push(full)
  }
  return out
}

/** The offset of the first byte that is not text, and what it is, or null. */
function firstControlByte(bytes: Buffer): { at: number; byte: number } | null {
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i]
    const layout = byte === 0x09 || byte === 0x0a || byte === 0x0d
    if (layout) continue
    // C0 controls, and DEL, which is the one that hides above them.
    if (byte < 0x20 || byte === 0x7f) return { at: i, byte }
  }
  return null
}

test('no source file in the repository carries a control byte', () => {
  const offences: string[] = []

  for (const root of ROOTS) {
    for (const file of walk(path.join(ROOT, root))) {
      const bytes = readFileSync(file)
      const found = firstControlByte(bytes)
      if (!found) continue

      // The line matters more than the offset: this is read by a person, and a person
      // has a line number in an editor. Counted on the bytes before it rather than on a
      // decoded string, because a control byte is exactly the thing a decoder is
      // allowed to mangle.
      const line = bytes.subarray(0, found.at).toString('latin1').split('\n').length
      offences.push(
        `${path.relative(ROOT, file)}:${line} has 0x${found.byte.toString(16).padStart(2, '0')}`,
      )
    }
  }

  assert.deepEqual(offences, [], `write it as an escape – git calls these files binary`)
})

test('the walk actually reads the files it is claiming to police', () => {
  // The failure this guards is the one every "scan the repo" test has: a root renamed or
  // a filter that stopped matching, leaving a rule that passes because it looks at
  // nothing. One file that must be here is enough for a floor.
  const files = walk(path.join(ROOT, 'src'))
  assert.ok(files.length > 100, `only ${files.length} files under src`)
  assert.ok(files.some((file) => file.endsWith('branch-money.ts')))
  assert.deepEqual(firstControlByte(Buffer.from('a\tb\nc')), null)
  assert.deepEqual(firstControlByte(Buffer.from('a\u0000b')), { at: 1, byte: 0 })
  assert.deepEqual(firstControlByte(Buffer.from('a\u007fb')), { at: 1, byte: 0x7f })
})
