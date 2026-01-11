/**
 * Suparank MCP - Project Service
 *
 * Fetch and manage project configuration from the Suparank API
 */

import { log } from '../utils/logging.js'
import { fetchWithRetry } from './api.js'
import { apiUrl, apiKey, projectSlug } from '../config.js'

/**
 * Fetch project configuration from the Suparank API
 * @returns {Promise<object>} Project object with config
 */
export async function fetchProjectConfig() {
  try {
    const response = await fetchWithRetry(`${apiUrl}/projects/${projectSlug}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    }, 3, 15000) // 3 retries, 15s timeout

    if (!response.ok) {
      const error = await response.text()

      if (response.status === 401) {
        throw new Error(`Invalid or expired API key. Please create a new one in the dashboard.`)
      }

      throw new Error(`Failed to fetch project: ${error}`)
    }

    const data = await response.json()
    return data.project
  } catch (error) {
    log('Error fetching project config:', error.message)
    throw error
  }
}
