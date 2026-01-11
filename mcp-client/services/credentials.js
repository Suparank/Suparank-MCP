/**
 * Suparank MCP - Credentials Service
 *
 * Local credentials management for CMS and API integrations
 */

import * as fs from 'fs'
import { getCredentialsFilePath } from '../utils/paths.js'
import { log } from '../utils/logging.js'

// Cached credentials
let localCredentials = null

/**
 * Load local credentials from ~/.suparank/credentials.json
 * @returns {object|null} Credentials object or null
 */
export function loadCredentials() {
  if (localCredentials !== null) {
    return localCredentials
  }

  const credentialsPath = getCredentialsFilePath()

  try {
    if (fs.existsSync(credentialsPath)) {
      const content = fs.readFileSync(credentialsPath, 'utf-8')
      localCredentials = JSON.parse(content)
      log(`Loaded credentials from ${credentialsPath}`)

      // Log which integrations are configured (without exposing keys)
      const configured = []
      if (localCredentials.wordpress?.secret_key || localCredentials.wordpress?.app_password) {
        configured.push('WordPress')
      }
      if (localCredentials.ghost?.admin_api_key) {
        configured.push('Ghost')
      }
      if (localCredentials.image_provider && localCredentials[localCredentials.image_provider]?.api_key) {
        configured.push(`Images (${localCredentials.image_provider})`)
      }
      if (localCredentials.webhooks && Object.values(localCredentials.webhooks).some(Boolean)) {
        configured.push('Webhooks')
      }
      if (localCredentials.external_mcps?.length) {
        configured.push(`External MCPs (${localCredentials.external_mcps.length})`)
      }

      if (configured.length > 0) {
        log(`Configured integrations: ${configured.join(', ')}`)
      }

      return localCredentials
    }
  } catch (error) {
    log(`Warning: Could not load credentials: ${error.message}`)
  }

  localCredentials = {}
  return localCredentials
}

/**
 * Get the current credentials object
 * @returns {object} Credentials object
 */
export function getCredentials() {
  if (localCredentials === null) {
    loadCredentials()
  }
  return localCredentials || {}
}

/**
 * Check if a specific credential type is available
 * @param {string} type - Credential type (wordpress, ghost, fal, gemini, wiro, image, webhooks)
 * @returns {boolean} Whether the credential is available
 */
export function hasCredential(type) {
  const creds = getCredentials()

  switch (type) {
    case 'wordpress':
      return !!(creds.wordpress?.secret_key || creds.wordpress?.app_password)
    case 'ghost':
      return !!creds.ghost?.admin_api_key
    case 'fal':
      return !!creds.fal?.api_key
    case 'gemini':
      return !!creds.gemini?.api_key
    case 'wiro':
      return !!creds.wiro?.api_key
    case 'image':
      const provider = creds.image_provider
      return provider && hasCredential(provider)
    case 'webhooks':
      return !!(creds.webhooks && Object.values(creds.webhooks).some(Boolean))
    default:
      return false
  }
}

/**
 * Get the configured image provider
 * @returns {string|null} Image provider name or null
 */
export function getImageProvider() {
  const creds = getCredentials()
  return creds.image_provider || null
}

/**
 * Get configuration for a specific provider
 * @param {string} provider - Provider name
 * @returns {object|null} Provider config or null
 */
export function getProviderConfig(provider) {
  const creds = getCredentials()
  return creds[provider] || null
}

/**
 * Clear cached credentials (for testing)
 */
export function clearCredentialsCache() {
  localCredentials = null
}

/**
 * Get list of external MCPs configured
 * @returns {Array} Array of external MCP configurations
 */
export function getExternalMCPs() {
  const creds = getCredentials()
  return creds?.external_mcps || []
}

/**
 * Get composition hints for a specific tool
 * @param {string} toolName - Tool name to get hints for
 * @returns {string|null} Composition hints or null
 */
export function getCompositionHints(toolName) {
  const creds = getCredentials()
  if (!creds?.tool_instructions) return null

  const instruction = creds.tool_instructions.find(t => t.tool_name === toolName)
  return instruction?.composition_hints || null
}
