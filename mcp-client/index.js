/**
 * Suparank MCP - Main Entry Point
 *
 * Modular MCP server for AI-powered SEO content creation
 *
 * This file re-exports from modular components and provides the main entry point.
 * For now, the main server logic is still in ../mcp-client.js but will be
 * migrated incrementally.
 */

// Re-export config
export * from './config.js'

// Re-export utils
export * from './utils/index.js'

// Re-export services
export * from './services/index.js'

// Main entry - for now, delegate to the original mcp-client.js
// This will be replaced with modular server setup in future versions
import '../mcp-client.js'
