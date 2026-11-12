import { afterEach, describe, expect, it, test, vi } from 'vitest'

import { describeValue, findSuitableLabelName, leanVersionCompare, toolchainHasModules } from './shared.ts'

afterEach(() => vi.restoreAllMocks())

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

describe('findSuitableLabelName', () => {
  it('should let acceptable identifiers through', async () => {
    expect(await findSuitableLabelName('abc', async () => true)).toBe('abc')
    expect(await findSuitableLabelName('0x123', async () => true)).toBe('0x123')
    expect(await findSuitableLabelName('0-123', async () => true)).toBe('0-123')
  })

  it('should replace non-alphanumeric characters with hyphens', async () => {
    expect(await findSuitableLabelName('foo__bar', async () => true)).toBe('foo--bar')
    expect(await findSuitableLabelName('xyz?0', async () => true)).toBe('xyz-0')
    expect(await findSuitableLabelName('abc@example.com', async () => true)).toBe('abc-example-com')
  })

  it('should remove leading and trailing hyphens', async () => {
    expect(await findSuitableLabelName('---foo---', async () => true)).toBe('foo')
    expect(await findSuitableLabelName('---foo--1-', async () => true)).toBe('foo--1')
    expect(await findSuitableLabelName('xyz?', async () => true)).toBe('xyz')
    expect(await findSuitableLabelName('a?', async () => true)).toBe('a')
    expect(await findSuitableLabelName('a + b = c', async () => true)).toBe('a---b---c')
    expect(
      await findSuitableLabelName(
        'x--------------------------------------------------------------------------------------',
        async () => true,
      ),
    ).toBe('x')
  })

  it('should add numeric postfixes for disallowed names', async () => {
    expect(await findSuitableLabelName('abc', async c => c !== 'abc')).toBe('abc-1')
    expect(await findSuitableLabelName('abc', async c => c !== 'abc' && c !== 'abc-1')).toBe('abc-2')
    expect(await findSuitableLabelName('abc', async c => c.length > 5)).toBe('abc-10')
    expect(await findSuitableLabelName('abc-7', async c => c.length > 6)).toBe('abc-7-1')
    expect(await findSuitableLabelName('123', async c => c.length > 5 && !c.endsWith('0'))).toBe('123-11')
  })

  it('should truncate overlong names', async () => {
    expect(
      await findSuitableLabelName('123456789012345678901234567890123456789012345678901234567890123', async () => true),
    ).toBe('123456789012345678901234567890123456789012345678901234567890123')
    expect(
      await findSuitableLabelName(
        '123456789012345678901234567890123456789012345678901234567890123------',
        async () => true,
      ),
    ).toBe('123456789012345678901234567890123456789012345678901234567890123')
    expect(
      await findSuitableLabelName(
        '------123456789012345678901234567890123456789012345678901234567890123',
        async () => true,
      ),
    ).toBe('123456789012345678901234567890123456789012345678901234567890123')
    expect(
      await findSuitableLabelName('1234567890123456789012345678901234567890123456789012345678901234', async () => true),
    ).toBe('123456789012345678901234567890123456789012345678901234567890123')
    expect(
      await findSuitableLabelName('123456789012345678901234567890123456789012345678901234567890---4', async () => true),
    ).toBe('123456789012345678901234567890123456789012345678901234567890')
    expect(
      await findSuitableLabelName('123456789012345678901234567890123456789012345678901234567890123', async c =>
        c.endsWith('71'),
      ),
    ).toBe('12345678901234567890123456789012345678901234567890123456789-71')
  })

  it('should fill in gaps between names', async () => {
    expect(
      await findSuitableLabelName('fred', async a => ['fred', 'fred-1', 'fred-3', 'fred-4'].every(b => a !== b)),
    ).toBe('fred-2')
  })

  it('should turn totally disallowed identifiers into "user"', async () => {
    expect(await findSuitableLabelName('----', async () => true)).toBe('user')
    expect(await findSuitableLabelName('!@#$%', async c => c !== 'user')).toBe('user-1')
  })

  it('should fall back to "user-<random>" identifiers', async () => {
    expect(await findSuitableLabelName('foo', async c => !c.startsWith('foo'))).toMatch(/^user-[0-9]+$/)
    vi.spyOn(Math, 'random').mockReturnValue(0.000007)
    expect(await findSuitableLabelName('foo', async c => !c.startsWith('foo'))).toBe('user-7')
    vi.spyOn(Math, 'random').mockReturnValue(0)
    expect(await findSuitableLabelName('foo', async c => !c.startsWith('foo'))).toBe('user-0')
    vi.spyOn(Math, 'random').mockReturnValue(0.9)
    expect(await findSuitableLabelName('foo', async c => !c.startsWith('foo'))).toBe('user-900000')
  })

  it('should throw if forced', async () => {
    await expect(findSuitableLabelName('user', async c => !c.startsWith('user'))).rejects.toThrow()
  })
})
