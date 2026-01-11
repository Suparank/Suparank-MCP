/**
 * Suparank MCP - Server Entry Point
 *
 * MCP server setup with stdio transport.
 * Handles tool listing and execution.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  InitializeRequestSchema
} from '@modelcontextprotocol/sdk/types.js'

import { log, progress } from './utils/logging.js'
import { projectSlug, apiUrl } from './config.js'

// Services
import {
  loadCredentials,
  hasCredential,
  getCredentials,
  getExternalMCPs,
  getCompositionHints
} from './services/credentials.js'
import { restoreSession } from './services/session-state.js'
import { incrementStat } from './services/stats.js'
import { fetchProjectConfig } from './services/project.js'

// Tools
import {
  ORCHESTRATOR_TOOLS,
  ACTION_TOOLS,
  getAvailableTools
} from './tools/index.js'

// Handlers
import {
  callBackendTool,
  executeActionTool,
  executeOrchestratorTool
} from './handlers/index.js'

/**
 * Main server entry point
 */
export async function main() {
  log(`Starting MCP client for project: ${projectSlug}`)
  log(`API URL: ${apiUrl}`)

  // Load local credentials
  const credentials = loadCredentials()
  if (credentials) {
    const configured = []
    if (hasCredential('wordpress')) configured.push('wordpress')
    if (hasCredential('ghost')) configured.push('ghost')
    if (hasCredential('image')) {
      const creds = getCredentials()
      configured.push(`image:${creds.image_provider}`)
    }
    if (hasCredential('webhooks')) configured.push('webhooks')

    const externalMcps = getExternalMCPs()
    if (externalMcps.length > 0) {
      configured.push(`mcps:${externalMcps.map(m => m.name).join(',')}`)
    }

    if (configured.length > 0) {
      log(`Configured integrations: ${configured.join(', ')}`)
    }
  }

  // Restore session state from previous run
  if (restoreSession()) {
    progress('Session', 'Restored previous workflow state')
  }

  // Fetch project configuration
  progress('Init', 'Connecting to platform...')
  let project
  try {
    project = await fetchProjectConfig()
    progress('Init', `Connected to project: ${project.name}`)
  } catch (error) {
    log('Failed to load project config. Exiting.')
    process.exit(1)
  }

  // Create MCP server
  const server = new Server(
    {
      name: 'suparank',
      version: '1.0.0'
    },
    {
      capabilities: {
        tools: {}
      }
    }
  )

  // Handle initialization
  server.setRequestHandler(InitializeRequestSchema, async (request) => {
    log('Received initialize request')
    return {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {}
      },
      serverInfo: {
        name: 'suparank',
        version: '1.0.0'
      }
    }
  })

  // Handle tools list
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    log('Received list tools request')
    const tools = getAvailableTools()
    log(`Returning ${tools.length} tools (${ACTION_TOOLS.length} action tools)`)
    return { tools }
  })

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params
    progress('Tool', `Executing ${name}`)
    log(`Executing tool: ${name}`)

    // Track tool call stats
    incrementStat('tool_calls')

    // Check if this is an orchestrator tool
    const orchestratorTool = ORCHESTRATOR_TOOLS.find(t => t.name === name)

    if (orchestratorTool) {
      try {
        const result = await executeOrchestratorTool(name, args || {}, project)
        log(`Orchestrator tool ${name} completed successfully`)
        return result
      } catch (error) {
        log(`Orchestrator tool ${name} failed:`, error.message)
        return {
          content: [{
            type: 'text',
            text: `Error executing ${name}: ${error.message}`
          }]
        }
      }
    }

    // Check if this is an action tool
    const actionTool = ACTION_TOOLS.find(t => t.name === name)

    if (actionTool) {
      // Check credentials
      if (!hasCredential(actionTool.requiresCredential)) {
        return {
          content: [{
            type: 'text',
            text: `Error: ${name} requires ${actionTool.requiresCredential} credentials.\n\nTo enable this tool:\n1. Run: npx suparank setup\n2. Add your ${actionTool.requiresCredential} credentials to ~/.suparank/credentials.json\n3. Restart the MCP server\n\nSee dashboard Settings > Credentials for setup instructions.`
          }]
        }
      }

      // Execute action tool locally
      try {
        const result = await executeActionTool(name, args || {})
        log(`Action tool ${name} completed successfully`)
        return result
      } catch (error) {
        log(`Action tool ${name} failed:`, error.message)
        return {
          content: [{
            type: 'text',
            text: `Error executing ${name}: ${error.message}`
          }]
        }
      }
    }

    // Regular tool - call backend
    try {
      // Add composition hints if configured
      const hints = getCompositionHints(name)
      const externalMcps = getExternalMCPs()

      const result = await callBackendTool(name, args || {})

      // Inject composition hints into response if available
      if (hints && result.content && result.content[0]?.text) {
        const mcpList = externalMcps.length > 0
          ? `\n\n## External MCPs Available\n${externalMcps.map(m => `- **${m.name}**: ${m.available_tools.join(', ')}`).join('\n')}`
          : ''

        result.content[0].text = result.content[0].text +
          `\n\n---\n## Integration Hints\n${hints}${mcpList}`
      }

      log(`Tool ${name} completed successfully`)
      return result
    } catch (error) {
      log(`Tool ${name} failed:`, error.message)
      throw error
    }
  })

  // Error handler
  server.onerror = (error) => {
    log('Server error:', error)
  }

  // Connect to stdio transport
  const transport = new StdioServerTransport()
  await server.connect(transport)

  log('MCP server ready and listening on stdio')
}
