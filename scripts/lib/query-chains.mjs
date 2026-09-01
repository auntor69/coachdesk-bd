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
 * Index just past the `)` matching the `(` at `open`, honouring strings and comments.
 *
 * A `.eq('a', foo(bar))` must not end the chain early, and a `'` inside a
 * template literal must not swallow the rest of the file.
 *
 * COMMENTS ARE SKIPPED, and that is not tidiness. An apostrophe inside one —
 * `createStudent's own insert`, above a column in an `.insert({ … })` payload — used to
 * open a quote that ran until the next `'` anywhere in the file. Where it landed decided
 * whether this returned the real closing paren, a wrong one, or -1, and both gates read
 * the answer: check-scoping saw a chain cut off before its `coaching_center_id` and
 * called a filtered query unfiltered, and a chain run long is the quieter half — one
 * query's filter vouching for the next one's missing filter. Editing a comment three
 * hundred lines away moved the verdict, which is the signature of the bug.
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
    if (c === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i)
      if (nl === -1) return -1
      i = nl
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i + 2)
      if (close === -1) return -1
      i = close + 1
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
 * The whole builder chain starting at a `.from(...)` call, and the methods on it.
 *
 * Walks method calls one at a time, tracking depth so a `.eq('a', foo(bar))`
 * does not end the chain early, and stops as soon as what follows a balanced
 * call is not another `.method(`. That is what makes the answer exact rather
 * than a fixed window of characters — two queries in one `Promise.all` sit a
 * few lines apart, and a window would let the second one's filter vouch for the
 * first.
 *
 * `methods` are the names at the top of the chain and nothing nested inside an
 * argument, which is the difference between "this query reads rows" and "this call
 * has a `.select(` somewhere in a callback it was handed".
 */
function walkChain(src, start) {
  let i = start
  const end = src.length
  const methods = []

  while (i < end) {
    // Expect `.name(`, possibly after whitespace and comments.
    while (i < end && /\s/.test(src[i])) i++
    if (src.startsWith('//', i)) {
      i = src.indexOf('\n', i)
      if (i === -1) return { end, methods }
      continue
    }
    if (src.startsWith('/*', i)) {
      const close = src.indexOf('*/', i)
      if (close === -1) return { end, methods }
      i = close + 2
      continue
    }
    if (src[i] !== '.') break

    const open = src.indexOf('(', i)
    if (open === -1) break
    const name = src.slice(i, open)
    if (!/^\.\s*\w+\s*$/.test(name)) break

    const close = balancedEnd(src, open)
    if (close === -1) break
    methods.push(name.slice(1).trim())
    i = close
  }

  return { end: i, methods }
}

export function chainFrom(src, start) {
  return src.slice(start, walkChain(src, start).end)
}

/** The top-level method names of a chain `chainFrom` returned. */
export function chainMethods(chain) {
  return walkChain(chain, 0).methods
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
 * Comments blanked to spaces, with every offset and line number left where it was.
 *
 * For the checks that must not be fooled by prose. `queriesIn` is deliberately not
 * given this — a `// scoped-by:` note lives inside a chain sometimes, and check-scoping
 * reads it from the chain text — so this is used only where a comment mentioning a query
 * would be read as one.
 */
export function maskComments(src) {
  const out = src.split('')
  let quote = null
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    // Outside a string too, because a regex literal escapes its slashes: the raw
    // `\/\/` of /https?:\/\// is not a comment, and reading it as one would blank the
    // rest of a real line.
    if (c === '\\') {
      i++
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c
      continue
    }
    if (c === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i)
      const end = nl === -1 ? src.length : nl
      out.fill(' ', i, end)
      i = end - 1
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      const at = src.indexOf('*/', i + 2)
      const end = at === -1 ? src.length : at + 2
      for (let j = i; j < end; j++) if (src[j] !== '\n') out[j] = ' '
      i = end - 1
      continue
    }
  }
  return out.join('')
}

/** Reading or writing rows. A chain with none of these is not a query. */
const ROW_METHODS = new Set(['select', 'insert', 'update', 'upsert', 'delete'])

/**
 * Every `.from(...)` that reads or writes rows and does not name its relation in quotes.
 *
 * The hole this closes: `queriesIn` matches a quoted table name, so a `.from(table)`
 * with a variable in it is not a query check-scoping got wrong — it is a query
 * check-scoping never saw, and the gate reported one fewer than it had and said all was
 * well. Found the honest way, by writing five such queries and noticing the count.
 *
 * Two things keep this off code that is not a query at all. The chain must go on to
 * `.select`/`.insert`/`.update`/`.upsert`/`.delete` at its top level, which is what
 * `Array.from({ length: 12 }, …).map(…)` and the dictionary's own `t.from(…)` do not do.
 * And `Array` is refused by name as well, because that call will never be a query and a
 * future `.select` inside one of its callbacks should not start looking like one.
 */
export function dynamicQueriesIn(src) {
  const out = []
  for (const match of src.matchAll(/([\w$]*)(\s*\.\s*from\()/g)) {
    const receiver = match[1]
    if (receiver === 'Array') continue

    const open = match.index + match[0].length - 1
    const close = balancedEnd(src, open)
    if (close === -1) continue

    const argument = src.slice(open + 1, close - 1).trim()
    // What `queriesIn` can already read. Single quotes only, because that is the
    // regex it uses, and a double-quoted name would be just as invisible.
    if (/^'\w+'$/.test(argument)) continue

    const dot = match.index + receiver.length
    const chain = chainFrom(src, dot)
    if (!chainMethods(chain).some((method) => ROW_METHODS.has(method))) continue

    out.push({ argument, offset: dot, line: lineOf(src, dot) })
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
