/**
 * Suparank MCP - Backend Tool Handler
 *
 * Executes tools via the Suparank API backend
 */

import { log } from '../utils/logging.js'
import { apiUrl, apiKey, projectSlug } from '../config.js'

/**
 * Call a tool on the Suparank backend API
 * @param {string} toolName - Name of the tool to execute
 * @param {object} args - Tool arguments
 * @returns {Promise<object>} Tool result from backend
 */
export async function callBackendTool(toolName, args) {
  try {
    const response = await fetch(`${apiUrl}/tools/${projectSlug}/${toolName}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ arguments: args })
    })

    if (!response.ok) {
      const error = await response.text()

      if (response.status === 401) {
        throw new Error(`Invalid or expired API key. Please create a new one in the dashboard.`)
      }

      throw new Error(`Tool execution failed: ${error}`)
    }

    const result = await response.json()
    return result
  } catch (error) {
    log('Error calling tool:', error.message)
    throw error
  }
}
