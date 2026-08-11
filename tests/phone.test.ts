import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeBdMobile,
  isValidBdMobile,
  formatBdMobile,
  toAsciiDigits,
  phoneToLoginEmail,
  loginEmailToPhone,
  isPhoneLoginEmail,
} from '../src/lib/bd/phone.ts'

test('accepts the shapes people actually type', () => {
  const expected = '+8801712345678'
  for (const input of [
    '01712345678',
    '017 1234 5678',
    '017-1234-5678',
    '+8801712345678',
    '8801712345678',
    '+880 1712 345678',
    '1712345678', // missing leading zero
    ' 01712345678 ',
    '(017) 1234-5678',
  ]) {
    assert.equal(normalizeBdMobile(input), expected, `failed on: ${input}`)
  }
})

test('handles Bangla numerals from a Bangla keyboard', () => {
  assert.equal(toAsciiDigits('০১৭১২৩৪৫৬৭৮'), '01712345678')
  assert.equal(normalizeBdMobile('০১৭১২৩৪৫৬৭৮'), '+8801712345678')
})

test('accepts every live operator prefix', () => {
  // Teletalk, Airtel, Banglalink, GP, Robi.
  for (const prefix of ['013', '014', '015', '016', '017', '018', '019']) {
    const number = `${prefix}12345678`
    assert.ok(isValidBdMobile(number), `rejected valid prefix ${prefix}`)
  }
})

test('rejects what is not a BD mobile', () => {
  for (const input of [
    '',
    null,
    undefined,
    '0212345678', // Dhaka landline
    '01012345678', // no operator uses 010
    '01112345678', // nor 011
    '01212345678', // nor 012
    '0171234567', // one digit short
    '017123456789', // one digit long
    'abcdefghijk',
    '+911712345678', // Indian number
    '00000000000',
  ]) {
    assert.equal(normalizeBdMobile(input), null, `wrongly accepted: ${input}`)
  }
})

test('normalisation is idempotent', () => {
  const once = normalizeBdMobile('01712345678')!
  assert.equal(normalizeBdMobile(once), once)
})

test('displays numbers the way Bangladeshis read them', () => {
  assert.equal(formatBdMobile('+8801712345678'), '01712345678')
  assert.equal(formatBdMobile(null), '')
})

test('phone maps to a stable synthetic login address and back', () => {
  const email = phoneToLoginEmail('01712345678')
  assert.equal(email, '8801712345678@phone.coachdesk.invalid')
  assert.ok(isPhoneLoginEmail(email))
  assert.equal(loginEmailToPhone(email!), '+8801712345678')

  // Every way of typing one number must reach the same account, or a teacher
  // who types their number differently would silently create a second account.
  assert.equal(phoneToLoginEmail('017 1234 5678'), email)
  assert.equal(phoneToLoginEmail('+8801712345678'), email)
  assert.equal(phoneToLoginEmail('০১৭১২৩৪৫৬৭৮'), email)
})

test('a real email is never mistaken for a phone login', () => {
  assert.equal(isPhoneLoginEmail('owner@gmail.com'), false)
  assert.equal(loginEmailToPhone('owner@gmail.com'), null)
  assert.equal(phoneToLoginEmail('not a number'), null)
})
