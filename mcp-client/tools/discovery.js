/**
 * Suparank MCP - Tool Discovery
 *
 * Functions for discovering and filtering available tools
 * based on configuration and credentials
 */

import { TOOLS, ACTION_TOOLS, ORCHESTRATOR_TOOLS, VISIBLE_TOOLS } from './definitions.js'
import { hasCredential } from '../services/credentials.js'

/**
 * Get tools to show in ListToolsRequestSchema
 * Only returns visible tools, with action tools marked as disabled if no credentials
 * @returns {Array} Array of tool definitions for MCP clients
 */
export function getAvailableTools() {
  const tools = []

  // Add visible TOOLS (keyword_research only from main tools)
  for (const tool of TOOLS) {
    if (VISIBLE_TOOLS.includes(tool.name)) {
      tools.push({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
      })
    }
  }

  // Add visible orchestrator tools
  for (const tool of ORCHESTRATOR_TOOLS) {
    if (VISIBLE_TOOLS.includes(tool.name)) {
      tools.push({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
      })
    }
  }

  // Add visible action tools (only if credentials are configured)
  for (const tool of ACTION_TOOLS) {
    if (VISIBLE_TOOLS.includes(tool.name)) {
      if (hasCredential(tool.requiresCredential)) {
        tools.push({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema
        })
      } else {
        // Add disabled version with note
        tools.push({
          name: tool.name,
          description: `[DISABLED - requires ${tool.requiresCredential} credentials] ${tool.description}`,
          inputSchema: tool.inputSchema
        })
      }
    }
  }

  return tools
}

/**
 * Get ALL tools (visible + hidden) for tool execution
 * This is used by CallToolRequestSchema to find tools by name
 * @returns {Array} Array of all tool definitions
 */
export function getAllTools() {
  const tools = [...TOOLS]

  // Add all orchestrator tools
  for (const tool of ORCHESTRATOR_TOOLS) {
    tools.push({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    })
  }

  // Add all action tools
  for (const tool of ACTION_TOOLS) {
    tools.push({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      requiresCredential: tool.requiresCredential
    })
  }

  return tools
}

/**
 * Find a tool by name across all tool arrays
 * @param {string} name - Tool name to find
 * @returns {object|null} Tool definition or null
 */
export function findTool(name) {
  // Check backend tools
  const backendTool = TOOLS.find(t => t.name === name)
  if (backendTool) return { ...backendTool, type: 'backend' }

  // Check orchestrator tools
  const orchestratorTool = ORCHESTRATOR_TOOLS.find(t => t.name === name)
  if (orchestratorTool) return { ...orchestratorTool, type: 'orchestrator' }

  // Check action tools
  const actionTool = ACTION_TOOLS.find(t => t.name === name)
  if (actionTool) return { ...actionTool, type: 'action' }

  return null
}

/**
 * Check if a tool name exists
 * @param {string} name - Tool name to check
 * @returns {boolean} Whether the tool exists
 */
export function toolExists(name) {
  return findTool(name) !== null
}

/**
 * Get the tool type (backend, orchestrator, action)
 * @param {string} name - Tool name
 * @returns {string|null} Tool type or null
 */
export function getToolType(name) {
  const tool = findTool(name)
  return tool ? tool.type : null
}
