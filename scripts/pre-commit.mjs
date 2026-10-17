#!/usr/bin/env node
// ------------------------------------------------------------------
// Missing-keys guard: blocks any commit from landing with env vars
// left at their placeholder values.
// ------------------------------------------------------------------
//
// ESM, because the extension is `.mjs` and an `.mjs` file has no `require`: every commit
// this was wired into died on `require is not defined` before it checked a single key, and
// a guard that always fails is a guard everybody learns to bypass with `--no-verify`.

import { existsSync, readFileSync } from 'node:fs'

const TARGETS = new Map([
  ['NEXT_PUBLIC_SUPABASE_URL', 'https://your-project.supabase.co'],
  ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'your-anon-key'],
  ['SUPABASE_SERVICE_ROLE_KEY', 'your-service-role-key'],
])

function main() {
  // Only meaningful inside a real project checkout.
  if (!existsSync('./.git') && !existsSync('../.git')) {
    console.log('no .git here — skipping key check')
    process.exit(0)
  }

  const checked = []
  for (const [name, placeholder] of TARGETS) {
    checked.push(name)
    const dotenv = ['.env.local', '.env'].find((f) => existsSync(f))
    let value = ''
    if (dotenv) {
      const text = readFileSync(dotenv, 'utf8')
      const m = new RegExp(`^\\s*${escapeRegExp(name)}\\s*=\\s*(.+)$`, 'm')
      const hit = text.match(m)
      if (hit) value = hit[1].trim()
    }
    if (!value || value === placeholder || value.startsWith('your-')) {
      console.error(
        `COMMIT BLOCKED: ${name} is still at its placeholder value.`,
      )
      console.error(`  file   : ${dotenv || '(not found)'}`)
      console.error(`  set it : freebuff-env set .env.local '{"${name}":"<real value>"}' --restart`)
      console.error(`  never  : paste the real value into this script or print it here.`)
      process.exit(1)
    }
  }

  console.log(`keys checked: ${checked.join(', ')}`)
  process.exit(0)
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

main()
