import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { legalShell } from '../src/lib/legal/shell.ts'
import {
  copyFor,
  currentVersions,
  POLICIES,
  POLICY_KINDS,
  POLICY_SLUGS,
  policyBySlug,
  policyFor,
  policyHref,
  RECHARGE_POLICIES,
  SIGNUP_POLICIES,
  SUPPORT_PHONE,
  type PolicyCopy,
} from '../src/lib/legal/policies.ts'
import { pendingAcceptances } from '../src/lib/legal/reask.ts'
import { LOCALES } from '../src/lib/i18n/locale.ts'

/**
 * Step 25a: the pages that must exist before the first taka (MASTERPLAN.md §14.1).
 *
 * WHAT THIS FILE IS FOR, in one line: these seven documents are the only part of the product
 * that is *prose*, and prose is the one thing `tsc` cannot check. §14.1 asks for particular
 * promises to be in particular pages — the balance is non-refundable and never expires, the
 * bonus is credit and not cash, verification is by hand inside a stated window, guardian
 * numbers are for this centre's own communication, no student record goes to an AI provider —
 * and every one of those is a sentence that can be deleted by somebody tidying up. The
 * consequences are not a broken screen: they are the first dispute, lost, against nothing
 * written.
 *
 * IT ALSO GUARDS THE MIGRATION, from the other side. `POLICIES` and
 * `20260811000085_policy_acceptances.sql` both name seven kinds, and a kind renamed in one and
 * not the other is an acceptance row that can never be written for a page that exists — or a
 * page nobody can agree to. Nothing in `tsc` connects a TypeScript union to a Postgres enum,
 * so this file reads the `.sql` and compares.
 *
 * AND IT GUARDS THE TWO PLACES CONSENT IS TAKEN. Three regexes over `(auth)/actions.ts`,
 * `settings/billing/actions.ts` and the two forms, because "recorded at signup and at the first
 * recharge" is a claim about wiring, and wiring is exactly what a later refactor rewrites
 * without noticing. Those are the only brittle assertions here; everything else asserts an
 * exported value.
 */

const ROOT = path.join(import.meta.dirname, '..')
const read = (...parts: string[]) => readFileSync(path.join(ROOT, ...parts), 'utf8')

const MIGRATION = read('supabase', 'migrations', '20260811000085_policy_acceptances.sql')
const PROXY = read('src', 'proxy.ts')
const SIGNUP_ACTION = read('src', 'app', '(auth)', 'actions.ts')
const SIGNUP_FORM = read('src', 'app', '(auth)', 'signup-form.tsx')
const PLAN_ACTION = read('src', 'app', '(app)', 'settings', 'billing', 'actions.ts')
// The recharge card moved under billing with the plan screen's demolition (§16.1 step 27);
// it is the same two files, and the same non-refundable line must still be there.
const RECHARGE_FORM = read(
  'src',
  'app',
  '(app)',
  'settings',
  'billing',
  'recharge-form.tsx',
)
const RECHARGE_PANEL = read(
  'src',
  'app',
  '(app)',
  'settings',
  'billing',
  'recharge-panel.tsx',
)
const POLICY_PAGE = read('src', 'app', '(legal)', 'legal', '[kind]', 'page.tsx')

/** Everything a reader sees, flattened — so a rule cannot be hidden in a paragraph. */
function allText(copy: PolicyCopy): string {
  return [
    copy.title,
    copy.lead,
    ...copy.sections.flatMap((s) => [s.heading, ...s.paragraphs]),
  ].join('\n')
}

/* -------------------------------------------------------------------------- */
/* The seven documents                                                         */
/* -------------------------------------------------------------------------- */

test('§14.1 — exactly the seven pages, each with an address and a version', () => {
  assert.equal(POLICIES.length, 7)
  assert.equal(new Set(POLICIES.map((p) => p.kind)).size, 7)
  assert.deepEqual(
    POLICIES.map((p) => p.kind),
    [...POLICY_KINDS],
  )

  for (const doc of POLICIES) {
    assert.equal(doc.slug, POLICY_SLUGS[doc.kind])
    assert.equal(policyHref(doc.slug), `/legal/${doc.slug}`)
    // The version is what `policy_acceptances` stores, and a version that is not a date is a
    // version a migration's own check constraint would refuse at the door.
    assert.match(doc.version, /^\d{4}-\d{2}-\d{2}$/)
    assert.equal(policyFor(doc.kind), doc)
    assert.equal(policyBySlug(doc.slug), doc)
  }

  // A slug nobody wrote is a 404 and not a crash, which is the whole reason the page can take
  // a dynamic segment. `/legal/anything` is a URL a scanner tries within the hour.
  assert.equal(policyBySlug('nope'), null)
})

test('every page says something in both languages, and says the same amount', () => {
  for (const doc of POLICIES) {
    for (const locale of LOCALES) {
      const copy = copyFor(doc, locale)
      assert.ok(copy.title.length > 3, `${doc.kind}/${locale} title`)
      assert.ok(copy.lead.length > 30, `${doc.kind}/${locale} lead`)
      assert.ok(copy.sections.length >= 4, `${doc.kind}/${locale} has too few sections`)

      for (const section of copy.sections) {
        assert.ok(section.heading.length > 3, `${doc.kind}/${locale} heading`)
        assert.ok(section.paragraphs.length > 0, `${doc.kind}/${locale} empty section`)
        for (const paragraph of section.paragraphs) {
          // A real sentence and not a placeholder. "TODO" is the one thing this file has to
          // catch that nothing else will: an unfinished legal page renders perfectly.
          assert.ok(paragraph.length > 40, `${doc.kind}/${locale}: "${paragraph}"`)
          assert.ok(!/TODO|lorem|XXX/i.test(paragraph), `${doc.kind}/${locale} placeholder`)
        }
      }
    }

    // Section for section and paragraph for paragraph. A translation that loses a clause is
    // the failure a bilingual terms page is most likely to have, and the one a reader of only
    // one language can never report.
    assert.equal(doc.bn.sections.length, doc.en.sections.length, `${doc.kind} sections`)
    for (let i = 0; i < doc.bn.sections.length; i++) {
      assert.equal(
        doc.bn.sections[i]!.paragraphs.length,
        doc.en.sections[i]!.paragraphs.length,
        `${doc.kind} §${i + 1}`,
      )
    }
  }
})

test('§14.1 — nothing claims a standard or a certification we have not been audited against', () => {
  for (const doc of POLICIES) {
    for (const locale of LOCALES) {
      const text = allText(copyFor(doc, locale))
      for (const claim of ['GDPR', 'ISO', 'SOC 2', 'PCI', 'HIPAA', 'জিডিপিআর', 'আইএসও']) {
        assert.ok(
          !text.includes(claim),
          `${doc.kind}/${locale} names ${claim} — §14.1 forbids the claim, and naming the ` +
            'framework in a disclaimer invites it to be read as one',
        )
      }
    }
  }

  // …and the positive half, because the rule is about saying what we do not claim rather
  // than saying nothing: both languages say so in the privacy page.
  assert.match(allText(policyFor('privacy').bn), /সার্টিফিকেশন/)
  assert.match(allText(policyFor('privacy').en), /certification/i)
})

test('the promises §14.1 asks each page to make are actually in it', () => {
  /**
   * One row per promise, as tokens that must appear in the page's own language.
   *
   * Written as plain substrings rather than regexes on purpose: these are the sentences a
   * dispute reads, and a test that can be satisfied by a synonym is a test that would pass on
   * a page that had stopped making the promise.
   */
  const required: Record<string, { bn: string[]; en: string[] }> = {
    prepaid_billing: {
      bn: ['ফেরতযোগ্য নয়', 'মেয়াদ', 'প্রতিদিন', 'এক দিনের দাম', 'এক কর্মদিবস', 'নগদ নয়'],
      en: ['not refundable', 'expire', 'day', "day's price", 'one working day', 'not cash'],
    },
    refunds: {
      bn: ['ফেরত দেওয়া হয় না', 'সমন্বয়'],
      en: ['not refundable', 'adjust'],
    },
    terms: {
      bn: ['১৮'],
      en: ['18'],
    },
    privacy: {
      bn: ['এআই', 'এনক্রিপ্ট', 'নাবালক'],
      en: ['AI provider', 'encrypted', 'minors'],
    },
    acceptable_use: {
      bn: ['অভিভাবকের', 'বিজ্ঞাপন'],
      en: ['guardian', 'advertising'],
    },
    deletion: {
      bn: ['এক্সপোর্ট', 'সাত দিনের'],
      en: ['export', 'seven working days'],
    },
    security: {
      bn: [SUPPORT_PHONE, 'পিন'],
      en: [SUPPORT_PHONE, 'PIN'],
    },
  }

  for (const doc of POLICIES) {
    const want = required[doc.kind]
    assert.ok(want, `no promise list for ${doc.kind}`)
    const bn = allText(doc.bn)
    const en = allText(doc.en)
    for (const token of want.bn) assert.ok(bn.includes(token), `${doc.kind}/bn misses ${token}`)
    for (const token of want.en) assert.ok(en.includes(token), `${doc.kind}/en misses ${token}`)
  }

  // The one number a customer can call (§14.1), in both languages of the page that exists to
  // give it, and only there — a second number on any other page is the drift that rule names.
  const others = POLICIES.filter((p) => p.kind !== 'security')
  for (const doc of others) {
    for (const locale of LOCALES) {
      const text = allText(copyFor(doc, locale))
      const numbers = text.match(/01\d{9}|\+8801\d{9}/g) ?? []
      for (const found of numbers) {
        assert.equal(found, SUPPORT_PHONE, `${doc.kind}/${locale} shows ${found}`)
      }
    }
  }
})

test('the shell is written in both languages and names the same number', () => {
  for (const locale of LOCALES) {
    const words = legalShell(locale)
    assert.ok(words.title.length > 2)
    assert.ok(words.lead.length > 20)
    assert.ok(words.effectiveFrom.length > 3)
    assert.ok(words.allPolicies.length > 3)
    // The contact sentence is built from the number rather than typed beside it, so these two
    // cannot disagree — which is the whole reason it is a function.
    assert.ok(words.contact(SUPPORT_PHONE).includes(SUPPORT_PHONE))
  }
})

/* -------------------------------------------------------------------------- */
/* The migration, from the other side                                          */
/* -------------------------------------------------------------------------- */

test('the enum in the migration is exactly the kinds in this module', () => {
  const body = MIGRATION.slice(
    MIGRATION.indexOf('create type public.policy_kind as enum'),
    MIGRATION.indexOf(');', MIGRATION.indexOf('create type public.policy_kind as enum')),
  )
  const fromSql = [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!)

  assert.deepEqual(fromSql, [...POLICY_KINDS])
})

test('the table can hold one acceptance per person, policy and version — and nothing else', () => {
  // Two partial unique indexes rather than one constraint, because `coaching_center_id` is
  // null on every signup acceptance and Postgres treats nulls as distinct in a unique index.
  assert.match(MIGRATION, /create unique index policy_acceptances_center_version/)
  assert.match(MIGRATION, /where coaching_center_id is not null;/)
  assert.match(MIGRATION, /create unique index policy_acceptances_platform_version/)
  assert.match(MIGRATION, /where coaching_center_id is null;/)

  // Append-only from the app's side: a consent that can be edited is not a record of consent.
  assert.match(MIGRATION, /alter table public\.policy_acceptances enable row level security;/)
  assert.match(MIGRATION, /create policy policy_acceptances_self_read/)
  assert.match(MIGRATION, /using \(profile_id = auth\.uid\(\)\)/)
  assert.match(MIGRATION, /create policy policy_acceptances_self_insert/)
  // Two questions in the `with check`: whose consent it is, and — when a centre is named —
  // whether they were actually acting for it. Without the second, anybody signed in could
  // record "I agreed while acting for another centre": their own consent, and a lie about the
  // context that an audit would read as fact. Null stays allowed; every signup row is null.
  assert.match(MIGRATION, /and \(coaching_center_id is null or app\.is_member\(coaching_center_id\)\)/)

  // The suite that proves it, in its own script for the reason test-recharge.mjs has one.
  const legalSuite = read('scripts', 'test-legal.mjs')
  assert.match(legalSuite, /from '\.\/lib\/pg-harness\.mjs'/)
  assert.match(legalSuite, /the same wording agreed to twice is refused|is one row, not two/)
  assert.match(MIGRATION, /revoke update, delete, truncate on public\.policy_acceptances/)
  assert.match(MIGRATION, /revoke all on public\.policy_acceptances from anon, public;/)

  // Nothing about a child is in this table (§14.1): no name, no phone, no student.
  for (const forbidden of ['student_id', 'guardian', 'phone', 'name text']) {
    assert.ok(
      !MIGRATION.includes(forbidden),
      `policy_acceptances must not carry ${forbidden}`,
    )
  }
})

/* -------------------------------------------------------------------------- */
/* When consent is asked for and taken                                         */
/* -------------------------------------------------------------------------- */

test('the five kinds somebody accepts, and the two nobody is asked about', () => {
  assert.deepEqual([...SIGNUP_POLICIES], ['terms', 'privacy', 'acceptable_use'])
  assert.deepEqual([...RECHARGE_POLICIES], ['prepaid_billing', 'refunds'])

  const accepted = [...SIGNUP_POLICIES, ...RECHARGE_POLICIES]
  // Disjoint, because a person is not asked for the money terms at the door and not asked for
  // the contract again at the first recharge.
  assert.equal(new Set(accepted).size, accepted.length)

  // `deletion` and `security` are statements of what we do with a request and how to reach a
  // human. A checkbox on either would be consent theatre, and would teach a reader to tick
  // without reading — which is what makes the other five worthless.
  for (const kind of ['deletion', 'security'] as const) {
    assert.ok(!accepted.includes(kind as never))
  }
  for (const kind of accepted) assert.ok(POLICY_KINDS.includes(kind))
})

test('the re-ask rule: current versions ask nothing, a stale one asks, an unreadable one is silent', () => {
  const versions = currentVersions()
  assert.deepEqual([...RECHARGE_POLICIES].map((k) => versions[k]), [
    policyFor('prepaid_billing').version,
    policyFor('refunds').version,
  ])

  const current = Object.fromEntries(RECHARGE_POLICIES.map((k) => [k, versions[k]]))
  assert.deepEqual(pendingAcceptances(RECHARGE_POLICIES, current), [])

  // One document re-worded: only that one is asked about again, which is why versions are per
  // policy and not one number for the site.
  const stale = { ...current, refunds: '2026-01-01' }
  assert.deepEqual(pendingAcceptances(RECHARGE_POLICIES, stale), ['refunds'])

  // Nothing recorded at all: everything is asked for, in the order given.
  assert.deepEqual(pendingAcceptances(RECHARGE_POLICIES, {}), [...RECHARGE_POLICIES])

  // The read did not arrive. Asking again would be a claim about a record we do not hold, and
  // on a flaky connection it would be the same claim on every screen.
  assert.deepEqual(pendingAcceptances(RECHARGE_POLICIES, null), [])

  // A kind with no page is a typo, not a policy nobody has to agree to.
  assert.throws(() => pendingAcceptances(['nope' as never], {}), /No policy version/)
})

test('signup refuses without the tick and records the three documents after the code', () => {
  assert.match(SIGNUP_FORM, /name="agree"/)
  assert.match(SIGNUP_FORM, /required/)
  assert.match(SIGNUP_ACTION, /const agreed = formData\.get\('agree'\) === 'on'/)
  assert.match(SIGNUP_ACTION, /field: 'agree'/)
  // Written inside the branch that has just proved the address, and never at step one — there
  // is no profile to name there, and a row written then is the forgeable flag §5.4 refuses.
  assert.match(SIGNUP_ACTION, /recordAcceptance\(confirmed\.id, null, SIGNUP_POLICIES\)/)
  assert.match(SIGNUP_ACTION, /recordAcceptance\(data\.session\.user\.id, null, SIGNUP_POLICIES\)/)
})

test('the recharge refuses without the tick, records it, and links the two pages', () => {
  assert.match(PLAN_ACTION, /== 'on'/)
  assert.match(PLAN_ACTION, /t\.agreeRequired/)
  assert.match(
    PLAN_ACTION,
    /recordAcceptance\(session\.userId, session\.active\.centerId, RECHARGE_POLICIES\)/,
  )

  assert.match(RECHARGE_FORM, /name="agree"/)
  assert.match(RECHARGE_FORM, /termsHref/)
  assert.match(RECHARGE_FORM, /refundsHref/)
  assert.match(RECHARGE_FORM, /words\.agreeChanged/)

  // §14.1: "the recharge screen's non-refundable line has to link somewhere". The line and the
  // link are one paragraph, and the link's text is the policy's own title.
  assert.match(RECHARGE_PANEL, /words\.nonRefundable/)
  assert.match(RECHARGE_PANEL, /policyHref\(terms\.slug\)/)
  assert.match(RECHARGE_PANEL, /copyFor\(terms, locale\)\.title/)
  assert.match(RECHARGE_PANEL, /pendingAcceptances\(RECHARGE_POLICIES, accepted\)/)
})

test('the pages are public, and a slug nobody wrote is a 404', () => {
  // Behind a session check, the recharge screen's non-refundable line would be unreachable in
  // exactly the state that makes it matter — a centre whose balance has already run out.
  assert.match(PROXY, /PUBLIC_ROUTES = \[[^\]]*'\/legal'/)

  assert.match(POLICY_PAGE, /notFound\(\)/)
  // Nothing about a tenant is read to render a document: the words are constants.
  assert.ok(!/getSession|requireCenter|supabase/.test(POLICY_PAGE))
})
