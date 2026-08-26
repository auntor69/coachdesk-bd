/**
 * Reading Supabase query chains out of the app's source, for the checks that need to.
 *
 * Two gates parse the same thing for different reasons. `check-scoping.mjs` wants the
 * filters on every `.from()` so it can insist each one names `coaching_center_id`;
 * `check-embeds.mjs` wants the `.select()` argument so it can ask live PostgREST
 * whether the shape still resolves. Both need to know where a builder chain starts
 * and stops, and getting that wrong is quiet in opposite directions — a chain read
 * too long lets one query's filter vouch for the next, and one read too short reports
 * a filter that is plainly there.
 *
 * So it is written once. It lives in scripts/ and not src/ because it parses the app
 * rather than running inside it, and it is plain .mjs for the same reason every other
 * script here is: these run under bare node, before and outside the build.
 */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Every .ts and .tsx under a directory, recursively. */
export function sourceFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(path))
    else if (/\.tsx?$/.test(entry.name)) out.push(path)
  }
  return out
}

/**
 * Index just past the `)` matching the `(` at `open`, honouring strings.
 *
 * A `.eq('a', foo(bar))` must not end the chain early, and a `'` inside a
 * template literal must not swallow the rest of the file.
 */
export function balancedEnd(src, open) {
  let depth = 0
  let quote = null
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c
      continue
    }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') {
      depth--
      if (depth === 0) return i + 1
    }
  }
  return -1
}

/**
 * The whole builder chain starting at a `.from(...)` call.
 *
 * Walks method calls one at a time, tracking depth so a `.eq('a', foo(bar))`
 * does not end the chain early, and stops as soon as what follows a balanced
 * call is not another `.method(`. That is what makes the answer exact rather
 * than a fixed window of characters — two queries in one `Promise.all` sit a
 * few lines apart, and a window would let the second one's filter vouch for the
 * first.
 */
export function chainFrom(src, start) {
  let i = start
  const end = src.length

  while (i < end) {
    // Expect `.name(`, possibly after whitespace and comments.
    while (i < end && /\s/.test(src[i])) i++
    if (src.startsWith('//', i)) {
      i = src.indexOf('\n', i)
      if (i === -1) return src.slice(start, end)
      continue
    }
    if (src.startsWith('/*', i)) {
      const close = src.indexOf('*/', i)
      if (close === -1) return src.slice(start, end)
      i = close + 2
      continue
    }
    if (src[i] !== '.') break

    const open = src.indexOf('(', i)
    if (open === -1) break
    if (!/^\.\s*\w+\s*$/.test(src.slice(i, open))) break

    const close = balancedEnd(src, open)
    if (close === -1) break
    i = close
  }

  return src.slice(start, i)
}

/** 1-based line number of a character offset, for a message a person can act on. */
export function lineOf(src, offset) {
  return src.slice(0, offset).split('\n').length
}

/** Every `.from('relation')` in a file, with the chain hanging off it. */
export function queriesIn(src) {
  const out = []
  for (const match of src.matchAll(/\.from\(\s*'([\w]+)'\s*\)/g)) {
    out.push({
      relation: match[1],
      offset: match.index,
      line: lineOf(src, match.index),
      chain: chainFrom(src, match.index),
    })
  }
  return out
}

/**
 * The first argument of a chain's `.select(...)`, as written, or null if it has none.
 *
 * The first `.select(`, because a chain has at most one that matters:
 * `.insert(...).select('id')` is the only shape with a select after something else,
 * and it is still the only select. The first *argument*, because the second is
 * `{ count: 'exact', head: true }` and it is not part of the column list.
 *
 * Returned unparsed — whether it is a string literal or an identifier is the
 * caller's problem, and the two need resolving differently.
 */
export function selectArg(chain) {
  const at = chain.indexOf('.select(')
  if (at === -1) return null
  const open = at + '.select'.length
  const close = balancedEnd(chain, open)
  if (close === -1) return null
  return firstArg(chain.slice(open + 1, close - 1))
}

/** Text up to the first top-level comma, ignoring commas inside quotes or brackets. */
function firstArg(text) {
  let depth = 0
  let quote = null
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c
      continue
    }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (c === ',' && depth === 0) return text.slice(0, i).trim()
  }
  return text.trim()
}

/**
 * A quoted column list, unquoted and with its whitespace flattened.
 *
 * Backticks count: the long selects in this app are template literals wrapped over
 * four or five lines, and they are exactly the ones with embeds in them. What is
 * refused is a template with `${}` in it, because the column list then depends on a
 * value this script cannot know, and a half-resolved list handed to PostgREST would
 * fail for the wrong reason. Returns null for that and for an identifier.
 *
 * The flattening matters more than it looks. These lists are wrapped across lines in
 * the source and PostgREST does not care, so `subjects (name)` and `subjects(name)`
 * and a newline in the middle are the same query — and a checker that compared them
 * as text would report a difference nobody can see.
 */
export function literalSelect(arg) {
  if (!arg) return null
  const match = /^(['"`])([\s\S]*)\1$/.exec(arg)
  if (!match) return null
  if (match[1] === '`' && match[2].includes('${')) return null
  return normalizeSelect(match[2])
}

/** One space between tokens, none hugging a bracket. */
export function normalizeSelect(select) {
  return select
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim()
}
