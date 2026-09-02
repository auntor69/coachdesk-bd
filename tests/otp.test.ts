import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  OTP_COOLDOWN_SECONDS,
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_PER_IP_PER_HOUR,
  OTP_PER_PHONE_PER_HOUR,
  OTP_TTL_SECONDS,
  generateOtp,
  hashOtp,
  otpSmsBody,
  readIssueOutcome,
  readTypedOtp,
  readVerifyOutcome,
} from '../src/lib/auth/otp.ts'
import { measureSms } from '../src/lib/sms/encoding.ts'

test('section 5.4 numbers, and the one relation between them', () => {
  assert.equal(OTP_LENGTH, 6)
  assert.equal(OTP_TTL_SECONDS, 300)
  assert.equal(OTP_COOLDOWN_SECONDS, 60)
  assert.equal(OTP_MAX_ATTEMPTS, 5)

  // A code has to outlive its own cooldown. The other way round, the only thing a
  // visitor could do with a code that has expired is wait for permission to ask for
  // another one, which is a signup nobody finishes.
  assert.ok(OTP_TTL_SECONDS > OTP_COOLDOWN_SECONDS)

  // Enough resends to survive a lost message, and fewer than the shared-IP bucket.
  assert.ok(OTP_PER_PHONE_PER_HOUR >= 3)
  assert.ok(OTP_PER_IP_PER_HOUR > OTP_PER_PHONE_PER_HOUR)
})

test('a code is six digits, zeros included', () => {
  let sawLeadingZero = false

  for (let i = 0; i < 5000; i++) {
    const code = generateOtp()
    assert.match(code, /^\d{6}$/)
    if (code.startsWith('0')) sawLeadingZero = true
  }

  // A tenth of the space starts with a zero. Never seeing one in five thousand draws
  // means the generator is picking from 100000-999999 and the space is 900,000 wide.
  assert.ok(sawLeadingZero, 'codes starting with 0 are never generated')
})

test('the hash binds the number and the purpose, not just the code', () => {
  const digest = hashOtp('+8801712345678', 'signup', '123456')

  assert.match(digest, /^[0-9a-f]{64}$/)
  assert.equal(
    digest,
    createHash('sha256').update('+8801712345678:signup:123456').digest('hex'),
  )

  // Same code, different number: a row lifted from one signup cannot be replayed.
  assert.notEqual(digest, hashOtp('+8801812345678', 'signup', '123456'))
  assert.notEqual(digest, hashOtp('+8801712345678', 'signup', '123457'))

  assert.equal(digest, hashOtp('+8801712345678', 'signup', '123456'))
})

test('what the visitor typed', () => {
  assert.equal(readTypedOtp('123456'), '123456')
  assert.equal(readTypedOtp(' 123 456 '), '123456')
  assert.equal(readTypedOtp('123-456'), '123456')

  // Read off the screen and typed back on a Bangla keyboard.
  assert.equal(readTypedOtp('১২৩৪৫৬'), '123456')
  assert.equal(readTypedOtp('০১২৩৪৫'), '012345')

  for (const bad of ['', '12345', '1234567', 'abcdef', '12345a', null, undefined]) {
    assert.equal(readTypedOtp(bad), null, `accepted: ${String(bad)}`)
  }
})

test('the message is one segment', () => {
  const body = otpSmsBody('123456')
  const cost = measureSms(body)

  assert.match(body, /123456/)
  assert.match(body, /5 minutes/)
  assert.equal(cost.encoding, 'gsm7')
  assert.equal(cost.segments, 1)
})

test('issuing: every answer the function is willing to believe', () => {
  assert.deepEqual(readIssueOutcome({ ok: true, expiresIn: 300 }), {
    ok: true,
    expiresIn: 300,
  })

  // A success that forgot to say how long falls back to the policy rather than to
  // zero, which would draw an expiry countdown that had already finished.
  assert.deepEqual(readIssueOutcome({ ok: true }), {
    ok: true,
    expiresIn: OTP_TTL_SECONDS,
  })

  assert.deepEqual(readIssueOutcome({ ok: false, reason: 'cooldown', wait: 43 }), {
    ok: false,
    reason: 'cooldown',
    wait: 43,
  })

  // Rounded up and floored at one second, so the countdown never opens at zero.
  assert.deepEqual(readIssueOutcome({ ok: false, reason: 'cooldown', wait: 0.2 }), {
    ok: false,
    reason: 'cooldown',
    wait: 1,
  })

  assert.deepEqual(readIssueOutcome({ ok: false, reason: 'cooldown' }), {
    ok: false,
    reason: 'cooldown',
    wait: OTP_COOLDOWN_SECONDS,
  })

  for (const reason of ['phone_limit', 'ip_limit'] as const) {
    assert.deepEqual(readIssueOutcome({ ok: false, reason }), { ok: false, reason })
  }
})

test('issuing: anything unreadable is a refusal', () => {
  for (const payload of [
    null,
    undefined,
    'ok',
    42,
    [],
    {},
    { ok: 'true' },
    { ok: 1 },
    { ok: false },
    { ok: false, reason: 'something new' },
  ]) {
    assert.deepEqual(
      readIssueOutcome(payload),
      { ok: false, reason: 'unknown' },
      `believed: ${JSON.stringify(payload) ?? String(payload)}`,
    )
  }
})

test('verifying: only a literal true is a pass', () => {
  assert.deepEqual(readVerifyOutcome({ ok: true }), { ok: true })

  // The whole point of the parser. Every one of these is a stranger being handed
  // somebody else's phone number if `ok` is read as truthy instead of as true.
  for (const payload of [
    { ok: 'true' },
    { ok: 1 },
    { ok: 'yes' },
    { ok: {} },
    { ok: [] },
    { verified: true },
  ]) {
    const outcome = readVerifyOutcome(payload)
    assert.equal(outcome.ok, false, `passed: ${JSON.stringify(payload)}`)
  }
})

test('verifying: the tries that are left', () => {
  assert.deepEqual(readVerifyOutcome({ ok: false, reason: 'wrong', left: 3 }), {
    ok: false,
    reason: 'wrong',
    left: 3,
  })

  // Never a negative number on a screen that says "N tries left".
  for (const left of [-1, undefined, 'two']) {
    assert.deepEqual(readVerifyOutcome({ ok: false, reason: 'wrong', left }), {
      ok: false,
      reason: 'wrong',
      left: 0,
    })
  }

  for (const reason of ['none', 'expired', 'burned'] as const) {
    assert.deepEqual(readVerifyOutcome({ ok: false, reason }), { ok: false, reason })
  }

  for (const payload of [null, undefined, 'none', [], {}, { reason: 'nope' }]) {
    assert.deepEqual(readVerifyOutcome(payload), { ok: false, reason: 'unknown' })
  }
})

/**
 * The gate itself cannot be imported here — otp-gate.ts is 'server-only' — so it is read
 * as text. Only one thing about it is worth holding structurally, and this is it.
 */
test('the development override cannot be on in production', () => {
  const gate = readFileSync(
    path.join(import.meta.dirname, '..', 'src', 'lib', 'auth', 'otp-gate.ts'),
    'utf8',
  )

  // OTP_DEV_TRANSPORT turns the gate on without a gateway, which means the code goes to
  // a server log. On a deployment that is signup broken for a real owner, so the NODE_ENV
  // clause is the whole safety of the variable. Vercel sets production for previews too.
  assert.match(gate, /process\.env\.NODE_ENV !== 'production'/)
  assert.match(gate, /process\.env\.OTP_DEV_TRANSPORT === '1'/)

  // And nothing may turn the gate off. Every path to a false answer has to be the absence
  // of a transport, never the presence of a variable saying to skip the check.
  const decision = /export function phoneGateOn\(\): boolean \{([^}]*)\}/.exec(gate)
  assert.ok(decision, 'phoneGateOn is no longer a one-expression function')
  assert.equal(
    decision[1].trim(),
    'return smsProviderConfigured() || devTransportOn()',
    'the gate now decides something other than "is there a transport"',
  )
})


