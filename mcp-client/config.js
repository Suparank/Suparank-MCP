/**
 * Suparank MCP - Configuration
 *
 * Centralized configuration and constants
 */

// Parse command line arguments
export const projectSlug = process.argv[2]
export const apiKey = process.argv[3]
export const apiUrl = process.env.SUPARANK_API_URL || 'https://api.suparank.io'

// External API endpoints - configurable via environment variables
export const API_ENDPOINTS = {
  fal: process.env.FAL_API_URL || 'https://fal.run/fal-ai/nano-banana-pro',
  gemini: process.env.GEMINI_API_URL || 'https://generativelanguage.googleapis.com/v1beta/models',
  wiro: process.env.WIRO_API_URL || 'https://api.wiro.ai/v1',
  wiroTaskDetail: process.env.WIRO_TASK_URL || 'https://api.wiro.ai/v1/Task/Detail'
}

// Session expiration (24 hours)
export const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000

// Tools that are visible in the MCP tool list (ALL 23 tools)
export const VISIBLE_TOOLS = [
  // Prompt Tools (11) - Backend API calls
  'keyword_research', 'seo_strategy', 'topical_map', 'content_calendar',
  'content_write', 'image_prompt', 'internal_links', 'schema_generate',
  'geo_optimize', 'quality_check', 'full_pipeline',
  // Action Tools (4) - Local execution
  'generate_image', 'publish_wordpress', 'publish_ghost', 'send_webhook',
  // Orchestrator Tools (8) - Session management
  'create_content', 'save_content', 'publish_content', 'get_session',
  'remove_article', 'clear_session', 'list_content', 'load_content'
]

// Default stats object
export const DEFAULT_STATS = {
  tool_calls: 0,
  images_generated: 0,
  articles_created: 0,
  words_written: 0
}
