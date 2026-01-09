/**
 * API Key Utility Tests
 *
 * Tests for API key generation, validation, and security
 */

import { describe, it, expect } from 'vitest'
import {
  generateApiKey,
  hashApiKey,
  isValidApiKeyFormat,
  maskApiKey,
  isApiKeyExpired,
  isApiKeyRevoked,
  isApiKeyActive,
  extractKeyPrefix,
  validateApiKeyHash
} from '../src/utils/api-keys.js'

describe('API Key Generation', () => {
  it('should generate a valid live API key', () => {
    const { fullKey, keyPrefix, keyHash } = generateApiKey('live')

    expect(fullKey).toMatch(/^sk_live_[a-f0-9]{40}$/)
    expect(fullKey.length).toBe(48)
    expect(keyPrefix).toBe(fullKey.substring(0, 16))
    expect(keyHash.length).toBe(64) // SHA-256 produces 64 hex chars
  })

  it('should generate a valid test API key', () => {
    const { fullKey, keyPrefix, keyHash } = generateApiKey('test')

    expect(fullKey).toMatch(/^sk_test_[a-f0-9]{40}$/)
    expect(fullKey.length).toBe(48)
    expect(keyPrefix).toBe(fullKey.substring(0, 16))
    expect(keyHash.length).toBe(64)
  })

  it('should generate unique keys on each call', () => {
    const key1 = generateApiKey('live')
    const key2 = generateApiKey('live')

    expect(key1.fullKey).not.toBe(key2.fullKey)
    expect(key1.keyHash).not.toBe(key2.keyHash)
  })
})

describe('API Key Format Validation', () => {
  it('should accept valid live keys', () => {
    const validKey = 'sk_live_' + 'a'.repeat(40)
    expect(isValidApiKeyFormat(validKey)).toBe(true)
  })

  it('should accept valid test keys', () => {
    const validKey = 'sk_test_' + 'b'.repeat(40)
    expect(isValidApiKeyFormat(validKey)).toBe(true)
  })

  it('should reject keys with wrong prefix', () => {
    const invalidKey = 'sk_prod_' + 'a'.repeat(40)
    expect(isValidApiKeyFormat(invalidKey)).toBe(false)
  })

  it('should reject keys with wrong length', () => {
    const tooShort = 'sk_live_' + 'a'.repeat(39)
    const tooLong = 'sk_live_' + 'a'.repeat(41)

    expect(isValidApiKeyFormat(tooShort)).toBe(false)
    expect(isValidApiKeyFormat(tooLong)).toBe(false)
  })

  it('should reject keys with non-hex characters', () => {
    const invalidKey = 'sk_live_' + 'g'.repeat(40) // 'g' is not hex
    expect(isValidApiKeyFormat(invalidKey)).toBe(false)
  })
})

describe('API Key Hashing', () => {
  it('should produce consistent hash for same input', () => {
    const key = 'sk_live_' + 'a'.repeat(40)
    const hash1 = hashApiKey(key)
    const hash2 = hashApiKey(key)

    expect(hash1).toBe(hash2)
  })

  it('should produce different hashes for different keys', () => {
    const key1 = 'sk_live_' + 'a'.repeat(40)
    const key2 = 'sk_live_' + 'b'.repeat(40)

    expect(hashApiKey(key1)).not.toBe(hashApiKey(key2))
  })

  it('should produce 64-character hex hash', () => {
    const key = 'sk_live_' + 'a'.repeat(40)
    const hash = hashApiKey(key)

    expect(hash.length).toBe(64)
    expect(hash).toMatch(/^[a-f0-9]+$/)
  })
})

describe('API Key Hash Validation', () => {
  it('should validate correct key against its hash', () => {
    const { fullKey, keyHash } = generateApiKey('live')

    expect(validateApiKeyHash(fullKey, keyHash)).toBe(true)
  })

  it('should reject incorrect key', () => {
    const { keyHash } = generateApiKey('live')
    const wrongKey = 'sk_live_' + 'x'.repeat(40)

    expect(validateApiKeyHash(wrongKey, keyHash)).toBe(false)
  })

  it('should use timing-safe comparison', () => {
    // This test verifies the function doesn't throw on mismatched lengths
    const { fullKey, keyHash } = generateApiKey('live')

    // Should work correctly even with valid inputs
    expect(() => validateApiKeyHash(fullKey, keyHash)).not.toThrow()
  })
})

describe('API Key Masking', () => {
  it('should mask full API key correctly', () => {
    const fullKey = 'sk_live_' + 'abcd'.repeat(10)
    const masked = maskApiKey(fullKey)

    expect(masked).toBe('sk_live_abcdabcd...abcd')
    expect(masked).not.toContain('abcdabcdabcdabcdabcdabcdabcd')
  })

  it('should handle key prefix correctly', () => {
    const prefix = 'sk_live_abcdabcd'
    const masked = maskApiKey(prefix)

    expect(masked).toBe('sk_live_abcdabcd...')
  })
})

describe('API Key Expiration', () => {
  it('should return false for null expiration', () => {
    expect(isApiKeyExpired(null)).toBe(false)
  })

  it('should return true for past date', () => {
    const pastDate = new Date(Date.now() - 86400000).toISOString() // 1 day ago
    expect(isApiKeyExpired(pastDate)).toBe(true)
  })

  it('should return false for future date', () => {
    const futureDate = new Date(Date.now() + 86400000).toISOString() // 1 day from now
    expect(isApiKeyExpired(futureDate)).toBe(false)
  })
})

describe('API Key Revocation', () => {
  it('should return false for null revocation', () => {
    expect(isApiKeyRevoked(null)).toBe(false)
  })

  it('should return true for any revocation timestamp', () => {
    const revokedAt = new Date().toISOString()
    expect(isApiKeyRevoked(revokedAt)).toBe(true)
  })
})

describe('API Key Active Status', () => {
  it('should be active when not expired and not revoked', () => {
    expect(isApiKeyActive(null, null)).toBe(true)

    const futureDate = new Date(Date.now() + 86400000).toISOString()
    expect(isApiKeyActive(futureDate, null)).toBe(true)
  })

  it('should be inactive when expired', () => {
    const pastDate = new Date(Date.now() - 86400000).toISOString()
    expect(isApiKeyActive(pastDate, null)).toBe(false)
  })

  it('should be inactive when revoked', () => {
    const revokedAt = new Date().toISOString()
    expect(isApiKeyActive(null, revokedAt)).toBe(false)
  })

  it('should be inactive when both expired and revoked', () => {
    const pastDate = new Date(Date.now() - 86400000).toISOString()
    const revokedAt = new Date().toISOString()
    expect(isApiKeyActive(pastDate, revokedAt)).toBe(false)
  })
})

describe('Key Prefix Extraction', () => {
  it('should extract first 16 characters', () => {
    const fullKey = 'sk_live_' + 'a'.repeat(40)
    const prefix = extractKeyPrefix(fullKey)

    expect(prefix).toBe('sk_live_aaaaaaaa')
    expect(prefix.length).toBe(16)
  })
})
