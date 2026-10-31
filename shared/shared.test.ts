import { describe, expect, it, test } from 'vitest'

import { describeValue, findSuitableAlphaNumName, leanVersionCompare, toolchainHasModules } from './shared.ts'

describe('leanVersionCompare', () => {
  it('should throw on non-lean version numbers', () => {
    expect(() => leanVersionCompare('v4.3.1', 'hello')).toThrow()
    expect(() => leanVersionCompare('v3.0.0', 'v5.0.0')).toThrow()
    expect(() => leanVersionCompare('v4.4.4.', 'v5.0.0')).toThrow()
    expect(() => leanVersionCompare('4.4.4', 'v5.0.0')).toThrow()
  })

  it('should handle semver-style ordering', () => {
    expect(leanVersionCompare('v4.1.3', 'v4.1.4')).toBeLessThan(0)
    expect(leanVersionCompare('v4.1.4', 'v4.1.3')).toBeGreaterThan(0)
    expect(leanVersionCompare('v4.1.11', 'v4.1.4')).toBeGreaterThan(0)
    expect(leanVersionCompare('v4.1.4', 'v4.1.11')).toBeLessThan(0)
    expect(leanVersionCompare('v4.11.9', 'v4.3.0')).toBeGreaterThan(0)
    expect(leanVersionCompare('v4.4.4', 'v4.4.4')).toBe(0)
  })

  it('should handle release candidates', () => {
    expect(leanVersionCompare('v4.1.3', 'v4.1.4-rc1')).toBeLessThan(0)
    expect(leanVersionCompare('v4.1.3-rc1', 'v4.1.3')).toBeLessThan(0)
    expect(leanVersionCompare('v4.1.9', 'v4.1.9-rc1')).toBeGreaterThan(0)
    expect(leanVersionCompare('v4.1.3-rc5', 'v4.1.3-rc1')).toBeGreaterThan(0)
    expect(leanVersionCompare('v4.1.3-rc9', 'v4.1.3-rc11')).toBeLessThan(0)
    expect(leanVersionCompare('v4.4.4-rc4', 'v4.4.4-rc4')).toBe(0)
  })
})

test('toolchainHasModules', () => {
  expect(toolchainHasModules('lean4')).toBe(false)
  expect(toolchainHasModules('leanprover/lean4:v4.1.0')).toBe(false)
  expect(toolchainHasModules('leanprover/lean4:v4.99.0')).toBe(true)
  expect(toolchainHasModules('leanprover/lean4-nightly:nightly-1900-01-01')).toBe(false)
  expect(toolchainHasModules('leanprover/lean4-nightly:nightly-2027-01-01')).toBe(true)
})

test('describeValue', () => {
  expect(describeValue(null)).toBe('null')
  expect(describeValue({})).toBe('object')
  expect(describeValue([])).toBe('array')
  expect(describeValue(true)).toBe('boolean')
})

describe('findSuitableAlphaNumName', () => {
  it('should let acceptable identifiers through', async () => {
    expect(await findSuitableAlphaNumName('abc', async () => true)).toBe('abc')
    expect(await findSuitableAlphaNumName('ab_12_-', async () => true)).toBe('ab_12_-')
    expect(await findSuitableAlphaNumName('0x123-', async () => true)).toBe('0x123-')
  })

  it('should add numeric postfixes to collisions', async () => {
    expect(await findSuitableAlphaNumName('abc', async c => c !== 'abc')).toBe('abc1')
    expect(await findSuitableAlphaNumName('abc', async c => c !== 'abc' && c !== 'abc1')).toBe('abc2')
    expect(await findSuitableAlphaNumName('0x123', async c => c !== '0x123')).toBe('0x1')
    expect(await findSuitableAlphaNumName('123test', async c => c !== '123test')).toBe('123test1')
  })

  it('should truncate unacceptable characters', async () => {
    expect(await findSuitableAlphaNumName('abc@example.com', async () => true)).toBe('abc')
  })

  it('should anonymize candidates that start with unacceptable characters', async () => {
    expect(await findSuitableAlphaNumName('../root', async () => true)).toBe('anon')
    expect(await findSuitableAlphaNumName('../root', async c => c !== 'anon')).toBe('anon1')
    expect(await findSuitableAlphaNumName('../root', async c => c.length >= 6)).toBe('anon10')
  })

  it('should truncate overlong names', async () => {
    expect(
      await findSuitableAlphaNumName(
        'a23456789012345678902234567890323456789042345678905234567890623456789072345678908234567890923456789xxx',
        async () => true,
      ),
    ).toBe('a23456789012345678902234567890323456789042345678905234567890623456789072345678908234567890923456789x')
  })

  it('should fill in gaps between names', async () => {
    expect(
      await findSuitableAlphaNumName('fred3', async a => ['fred', 'fred1', 'fred3', 'fred4'].every(b => a !== b)),
    ).toBe('fred2')
  })

  it('should accept non-conflicting numeric identifiers', async () => {
    expect(await findSuitableAlphaNumName('123', async () => true)).toBe('123')
    expect(await findSuitableAlphaNumName('0xabc', async () => true)).toBe('0xabc')
  })

  it('should turn conflicting numeric identifiers into "anon" identifiers', async () => {
    expect(await findSuitableAlphaNumName('123', async c => c !== '123' && c !== 'anon')).toBe('anon1')
  })

  it('should trim long names to keep them under 100 characters', async () => {
    expect(
      await findSuitableAlphaNumName(
        'a234567890123456789022345678903234567890423456789052345678906234567890723456789082345678909234abcde',
        async c => c.endsWith('100'),
      ),
    ).toBe('a234567890123456789022345678903234567890423456789052345678906234567890723456789082345678909234abc100')
  })

  it('should fall back to the "anon" prefix for a test that rejects most inputs', async () => {
    expect(await findSuitableAlphaNumName('test', async c => !/^test/.test(c))).toMatch(/^anon/)
  })

  it('should throw if there are no suitable names', async () => {
    await expect(findSuitableAlphaNumName('test', async () => false)).rejects.toThrow()
  })
})
