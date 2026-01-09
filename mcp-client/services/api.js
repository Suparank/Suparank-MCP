/**
 * Suparank MCP - API Service
 *
 * HTTP request utilities with retry and timeout handling
 */

import { log } from '../utils/logging.js'

/**
 * Fetch with timeout - prevents hanging requests
 * @param {string} url - URL to fetch
 * @param {object} options - Fetch options
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<Response>}
 */
export async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    })
    return response
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Fetch with retry - handles transient failures
 * @param {string} url - URL to fetch
 * @param {object} options - Fetch options
 * @param {number} maxRetries - Maximum retry attempts
 * @param {number} timeoutMs - Timeout per request in milliseconds
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, options = {}, maxRetries = 3, timeoutMs = 30000) {
  let lastError

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, options, timeoutMs)

      // Retry on 5xx errors or rate limiting
      if (response.status >= 500 || response.status === 429) {
        const retryAfter = response.headers.get('retry-after')
        const delay = retryAfter ? parseInt(retryAfter) * 1000 : Math.pow(2, attempt) * 1000

        if (attempt < maxRetries) {
          log(`Request failed (${response.status}), retrying in ${delay}ms... (attempt ${attempt}/${maxRetries})`)
          await new Promise(resolve => setTimeout(resolve, delay))
          continue
        }
      }

      return response
    } catch (error) {
      lastError = error

      // Don't retry on abort (timeout)
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeoutMs}ms: ${url}`)
      }

      // Retry on network errors
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000
        log(`Network error, retrying in ${delay}ms... (attempt ${attempt}/${maxRetries}): ${error.message}`)
        await new Promise(resolve => setTimeout(resolve, delay))
        continue
      }
    }
  }

  throw lastError || new Error(`Request failed after ${maxRetries} attempts: ${url}`)
}

/**
 * Make an authenticated request to the Suparank API
 * @param {string} apiUrl - Base API URL
 * @param {string} apiKey - API key
 * @param {string} endpoint - API endpoint
 * @param {object} options - Additional fetch options
 * @returns {Promise<Response>}
 */
export async function apiRequest(apiUrl, apiKey, endpoint, options = {}) {
  const url = `${apiUrl}${endpoint}`

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    ...options.headers
  }

  return fetchWithRetry(url, {
    ...options,
    headers
  })
}
