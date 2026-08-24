/**
 * A `"use server"` file may export nothing but async functions.
 *
 * Everything exported from one becomes a callable HTTP endpoint, so Next refuses to
 * build a module that exports an array, an object, a class or a plain function. It
 * refuses while collecting page data — after typechecking, after linting, and only
 * for the pages that import the file — which is why `export const STUDENT_STATUSES`
 * sat on main through two commits with `tsc --noEmit`, eslint and the whole test
 * gate green while `next build` died on the first page that touched it.
 *
 * That is the gap this closes. `next build` is not in the gate and should not be:
 * on Windows it fights the dev server for the .next lock, so a check that runs
 * during ordinary work has to be a file scan. This is that scan, and it is the same
 * rule Next enforces, stated where a person can read it.
 *
 * Type exports are fine and are the common case — an `ActionState` next to the
 * action that returns it is worth more than the separate file it would otherwise
 * live in. They are erased before any of this matters.
 *
 * ONLY A MODULE-LEVEL DIRECTIVE COUNTS. `'use server'` inside a function body marks
 * that one function and says nothing about the module's other exports, so a file is
 * only in scope here when the directive is its first statement.
 *
 * Run: node scripts/check-server-exports.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOT = process.cwd()

function sourceFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(path))
    else if (/\.tsx?$/.test(entry.name)) out.push(path)
  }
  return out
}

/**
 * Whether the module's *first statement* is the directive.
 *
 * Leading comments and blank lines are stepped over, because a licence header or a
 * docstring above the directive is legal and common. Anything else ends the search:
 * a directive that is not the first statement is not a directive at all, and V8
 * treats it as a stray expression.
 */
function isServerModule(src) {
  for (const raw of src.split('\n')) {
    const line = raw.trim()
    if (line === '') continue
    if (line.startsWith('//')) continue
    if (line.startsWith('/*') || line.startsWith('*') || line.startsWith('*/')) continue
    return /^['"]use server['"];?$/.test(line)
  }
  return false
}

/**
 * The text of a top-level export statement, up to whatever ends it.
 *
 * A window rather than a parse, and bounded by the next top-level statement: a
 * signature can run over several lines — `export const send = async (\n  a,\n) =>`
 * — and the `async` that makes it legal is often not on the line the `export` is on.
 */
function statementAt(lines, index) {
  const out = [lines[index]]
  for (let i = index + 1; i < lines.length; i++) {
    const line = lines[i]
    // A new top-level statement, or the closing brace of this one.
    if (/^\S/.test(line) && !/^\s/.test(line)) {
      out.push(line)
      break
    }
    out.push(line)
    if (out.length > 6) break
  }
  return out.join('\n')
}

/**
 * Why this export cannot live in a `"use server"` file, or null if it can.
 *
 * Ordered from the most specific to the least, so `export async function` is
 * cleared before `export function` is refused.
 */
function whyRefused(statement) {
  const head = statement.split('\n')[0]

  // Erased before the runtime ever sees the module.
  if (/^export\s+(type|interface)\b/.test(head)) return null
  if (/^export\s+\{[^}]*\}\s*from\b/.test(statement.replace(/\n/g, ' '))) {
    // A re-export of types only is erased with them; anything else is a value
    // crossing the boundary under a name this file did not define.
    const inside = /\{([^}]*)\}/.exec(statement.replace(/\n/g, ' '))?.[1] ?? ''
    const specifiers = inside.split(',').map((s) => s.trim()).filter(Boolean)
    if (specifiers.every((s) => s.startsWith('type '))) return null
    return 're-exports a value; only async functions may leave a "use server" file'
  }
  if (/^export\s+type\s*\{/.test(head)) return null

  if (/^export\s+async\s+function\b/.test(head)) return null
  if (/^export\s+default\s+async\s+function\b/.test(head)) return null

  if (/^export\s+function\b/.test(head)) {
    return 'a plain function; a server action has to be async'
  }
  if (/^export\s+class\b/.test(head)) return 'a class'
  if (/^export\s+\*/.test(head)) return 'a wildcard re-export'
  if (/^export\s+(let|var)\b/.test(head)) {
    return 'a reassignable binding; only async functions may be exported'
  }

  if (/^export\s+const\b/.test(head)) {
    // `export const send = async (…) => {}` is a legal action. Anything else —
    // an array, an object, a number, a non-async arrow — is not.
    if (/=\s*async\s*(\(|function\b)/.test(statement)) return null
    return 'a value, not an async function'
  }

  if (/^export\s+default\b/.test(head)) {
    if (/=?\s*async\s*(\(|function\b)/.test(statement)) return null
    return 'a default export that is not an async function'
  }

  // An `export` this script does not recognise. Refused rather than waved through:
  // the whole point is that the build refuses it somewhere nobody is looking.
  return 'an export this check does not recognise — see the note at the top'
}

const problems = []
let modules = 0
let exports = 0

for (const file of sourceFiles(join(ROOT, 'src'))) {
  const src = readFileSync(file, 'utf8')
  if (!src.includes('use server')) continue
  if (!isServerModule(src)) continue

  modules++
  const where = relative(ROOT, file).split(sep).join('/')
  const lines = src.split('\n')

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('export')) continue
    exports++

    const why = whyRefused(statementAt(lines, i))
    if (why) {
      problems.push({ where, line: i + 1, what: lines[i].trim(), why })
    }
  }
}

if (modules === 0) {
  console.error('check-server-exports: found no "use server" modules at all.')
  console.error('Either the directive moved or this script stopped recognising it.')
  process.exit(1)
}

if (problems.length > 0) {
  console.error(
    `\n${problems.length} export${problems.length === 1 ? '' : 's'} from a `
      + '"use server" file that next build will refuse:\n',
  )
  for (const p of problems) {
    console.error(`  ${p.where}:${p.line}`)
    console.error(`      ${p.what}`)
    console.error(`      ${p.why}`)
  }
  console.error(
    '\nEverything exported from a "use server" file becomes a public endpoint, so'
      + '\nonly async functions may leave one. Move the value to a plain module —'
      + '\nsrc/lib/students/status.ts is the pattern — and import it from both'
      + '\nsides. Types are erased and may stay.\n',
  )
  process.exit(1)
}

console.log(
  `check-server-exports: ${exports} exports across ${modules} "use server" `
    + 'modules, all async functions or types.',
)
