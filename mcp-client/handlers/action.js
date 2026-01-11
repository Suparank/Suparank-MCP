/**
 * Suparank MCP - Action Tool Handler
 *
 * Dispatches action tools that run locally using credentials
 */

import {
  executeImageGeneration,
  executeWordPressPublish,
  executeGhostPublish,
  executeSendWebhook
} from '../publishers/index.js'

/**
 * Execute an action tool locally using credentials
 * @param {string} toolName - Name of the action tool
 * @param {object} args - Tool arguments
 * @returns {Promise<object>} MCP response
 */
export async function executeActionTool(toolName, args) {
  switch (toolName) {
    case 'generate_image':
      return await executeImageGeneration(args)
    case 'publish_wordpress':
      return await executeWordPressPublish(args)
    case 'publish_ghost':
      return await executeGhostPublish(args)
    case 'send_webhook':
      return await executeSendWebhook(args)
    default:
      throw new Error(`Unknown action tool: ${toolName}`)
  }
}
