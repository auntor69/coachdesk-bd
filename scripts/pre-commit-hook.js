#!/usr/bin/env node
// ------------------------------------------------------------------
// Pre-commit hook: checks that no environment placeholder values are
// present before a commit lands.
// ------------------------------------------------------------------
//
// This hook runs the script in scripts/pre-commit.mjs. If the script
// exits non-zero, the commit is aborted. Add it with:
//
//   git config core.hooksPath scripts
//
// After that, every `git commit` runs this automatically.
//
// The hook itself is allowed to commit — it checks only the worktree
// files that are about to be committed, which keeps the hook from
// blocking the very commit that introduces it.
'use strict'

const { execSync } = require('node:child_process')
const path = require('node:path')

// The hook lives in scripts/, so this file is two levels above the
// project root when invoked by core.hooksPath scripts.
const root = path.resolve(__dirname, '..')

// Allow the hook file and the pre-commit script itself to be committed.
const allowListed = new Set([
  path.relative(root, __filename),
  'scripts/pre-commit.mjs',
  'scripts/pre-commit.mjs.map',
])

try {
  // Files staged for commit, as paths relative to the repo root.
  const staged = execSync('git diff --cached --name-only --diff-filter=ACMR', {
    cwd: root,
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .filter(Boolean)

  let blocked = false
  for (const entry of staged) {
    const rel = entry.replace(/\\/g, '/')
    if (allowListed.has(rel)) continue

    const candidate = path.join(root, rel)
    if (!fs.existsSync(candidate)) continue

    const text = fs.readFileSync(candidate, 'utf8')
    if (
      text.includes('https://your-project.supabase.co') ||
      text.includes("your-anon-key") ||
      text.includes("your-service-role-key")
    ) {
      console.error(
        `COMMIT BLOCKED by pre-commit hook:\n` +
          `  ${rel} contains a placeholder env value.\n` +
          `  Remove the placeholder or set the real value in .env.local.`,
      )
      blocked = true
    }
  }

  if (blocked) {
    console.error(`run:  freebuff-env set .env.local '{"NEXT_PUBLIC_SUPABASE_URL":"<real>","NEXT_PUBLIC_SUPABASE_ANON_KEY":"<real>","SUPABASE_SERVICE_ROLE_KEY":"<real>"}' --restart`)
    process.exit(1)
  }

  // Also run the standalone check for any .env file that is itself staged.
  if (staged.includes('.env') || staged.includes('.env.local')) {
    execSync(`node "${path.join(root, 'scripts', 'pre-commit.mjs')}"`, {
      cwd: root,
      encoding: 'utf8',
    })
  }

  console.log('pre-commit hook passed')
} catch (error) {
  console.error(error.message || error)
  process.exit(error.status || 1)
}
