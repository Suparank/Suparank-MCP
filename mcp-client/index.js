#!/usr/bin/env node

/**
 * Suparank MCP - Main Entry Point
 *
 * Modular MCP server for AI-powered SEO content creation
 *
 * Usage:
 *   npx suparank
 *   node mcp-client/index.js <project-slug> <api-key>
 *
 * Credentials:
 *   Local credentials are loaded from ~/.suparank/credentials.json
 *   These enable additional tools: image generation, CMS publishing, webhooks
 */

import { main } from './server.js'
import { log } from './utils/logging.js'

// Re-export modules for external use
export * from './config.js'
export * from './utils/index.js'
export * from './services/index.js'
export * from './tools/index.js'
export * from './handlers/index.js'
export * from './publishers/index.js'
export * from './workflow/index.js'

// Run server
main().catch((error) => {
  log('Fatal error:', error)
  process.exit(1)
})
