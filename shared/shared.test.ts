import { describe, expect, it, test } from 'vitest'

import { bwrapProjectDir, describeValue, leanVersionCompare, toolchainHasModules } from './shared.ts'

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

test('bwrapProjectDir', () => {
  expect(bwrapProjectDir('abc')).toBe('/workspace/abc/')
})

test('describeValue', () => {
  expect(describeValue(null)).toBe('null')
  expect(describeValue({})).toBe('object')
  expect(describeValue([])).toBe('array')
  expect(describeValue(true)).toBe('boolean')
})
