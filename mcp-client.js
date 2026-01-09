#!/usr/bin/env node

/**
 * Suparank MCP - Stdio Client
 *
 * Local MCP client that connects to the Suparank backend API.
 * Works with Claude Desktop and Cursor via stdio transport.
 *
 * Usage:
 *   npx suparank
 *   node mcp-client.js <project-slug> <api-key>
 *
 * Credentials:
 *   Local credentials are loaded from ~/.suparank/credentials.json
 *   These enable additional tools: image generation, CMS publishing, webhooks
 *
 * Note: API keys are more secure than JWT tokens for MCP connections
 * because they don't expire and can be revoked individually.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  InitializeRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import * as fs from 'fs'
import { marked } from 'marked'
import * as path from 'path'
import * as os from 'os'

// Parse command line arguments
const projectSlug = process.argv[2]
const apiKey = process.argv[3]
const apiUrl = process.env.SUPARANK_API_URL || 'https://api.suparank.io'

if (!projectSlug) {
  console.error('Error: Project slug is required')
  console.error('Usage: node mcp-client.js <project-slug> <api-key>')
  console.error('Example: node mcp-client.js my-project sk_live_abc123...')
  process.exit(1)
}

if (!apiKey) {
  console.error('Error: API key is required')
  console.error('Usage: node mcp-client.js <project-slug> <api-key>')
  console.error('')
  console.error('To create an API key:')
  console.error('1. Sign in to the dashboard at http://localhost:3001')
  console.error('2. Go to Settings > API Keys')
  console.error('3. Click "Create API Key"')
  console.error('4. Copy the key (shown only once!)')
  process.exit(1)
}

// Validate API key format
if (!apiKey.startsWith('sk_live_') && !apiKey.startsWith('sk_test_')) {
  console.error('Error: Invalid API key format')
  console.error('API keys must start with "sk_live_" or "sk_test_"')
  console.error('Example: sk_live_abc123...')
  process.exit(1)
}

// Log to stderr (stdout is used for MCP protocol)
const log = (...args) => console.error('[suparank]', ...args)

// Structured progress logging for user visibility
const progress = (step, message) => console.error(`[suparank] ${step}: ${message}`)

// Local credentials storage
let localCredentials = null

// Session state for orchestration - stores content between steps
// Supports multiple articles for batch content creation workflows
const sessionState = {
  currentWorkflow: null,
  stepResults: {},

  // Multi-article support: Array of saved articles
  articles: [],

  // Current working article (being edited/created)
  // These fields are for the article currently being worked on
  article: null,
  title: null,
  imageUrl: null,        // Cover image
  inlineImages: [],      // Array of inline image URLs
  keywords: null,
  metadata: null,
  metaTitle: null,
  metaDescription: null,

  contentFolder: null    // Path to saved content folder
}

/**
 * Generate a unique article ID
 */
function generateArticleId() {
  return `art_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
}

/**
 * Get the path to the Suparank config directory (~/.suparank/)
 */
function getSuparankDir() {
  return path.join(os.homedir(), '.suparank')
}

/**
 * Get the path to the session file (~/.suparank/session.json)
 */
function getSessionFilePath() {
  return path.join(getSuparankDir(), 'session.json')
}

/**
 * Get the path to the content directory (~/.suparank/content/)
 */
function getContentDir() {
  return path.join(getSuparankDir(), 'content')
}

/**
 * Ensure the Suparank config directory exists
 */
function ensureSuparankDir() {
  const dir = getSuparankDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
    log(`Created config directory: ${dir}`)
  }
}

/**
 * Ensure content directory exists
 */
function ensureContentDir() {
  const dir = getContentDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * Generate a slug from title for folder naming
 */
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50)
}

/**
 * Atomic file write - prevents corruption on concurrent writes
 */
function atomicWriteSync(filePath, data) {
  const tmpFile = filePath + '.tmp.' + process.pid
  try {
    fs.writeFileSync(tmpFile, data)
    fs.renameSync(tmpFile, filePath) // Atomic on POSIX
  } catch (error) {
    // Clean up temp file if rename failed
    try { fs.unlinkSync(tmpFile) } catch (e) { /* ignore */ }
    throw error
  }
}

/**
 * Fetch with timeout - prevents hanging requests
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
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
 */
async function fetchWithRetry(url, options = {}, maxRetries = 3, timeoutMs = 30000) {
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

      // Retry on network errors
      if (error.name === 'AbortError') {
        lastError = new Error(`Request timeout after ${timeoutMs}ms`)
      }

      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000
        log(`Request error: ${lastError.message}, retrying in ${delay}ms... (attempt ${attempt}/${maxRetries})`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }

  throw lastError
}

/**
 * Load session state from file (survives MCP restarts)
 * Supports both old single-article format and new multi-article format
 */
function loadSession() {
  try {
    const sessionFile = getSessionFilePath()
    if (fs.existsSync(sessionFile)) {
      const content = fs.readFileSync(sessionFile, 'utf-8')
      const saved = JSON.parse(content)

      // Check if session is stale (older than 24 hours)
      const savedAt = new Date(saved.savedAt)
      const hoursSinceSave = (Date.now() - savedAt.getTime()) / (1000 * 60 * 60)
      if (hoursSinceSave > 24) {
        log(`Session expired (${Math.round(hoursSinceSave)} hours old), starting fresh`)
        clearSessionFile()
        return false
      }

      // Restore session state
      sessionState.currentWorkflow = saved.currentWorkflow || null
      sessionState.stepResults = saved.stepResults || {}

      // Load articles array (new format)
      sessionState.articles = saved.articles || []

      // Backwards compatibility: migrate old single-article format to articles array
      if (!saved.articles && saved.article && saved.title) {
        const migratedArticle = {
          id: generateArticleId(),
          title: saved.title,
          content: saved.article,
          keywords: saved.keywords || [],
          metaDescription: saved.metaDescription || '',
          metaTitle: saved.metaTitle || saved.title,
          imageUrl: saved.imageUrl || null,
          inlineImages: saved.inlineImages || [],
          savedAt: saved.savedAt,
          published: false,
          publishedTo: []
        }
        sessionState.articles = [migratedArticle]
        log(`Migrated old session format to multi-article format`)
      }

      // Current working article fields (cleared after each save)
      sessionState.article = saved.article || null
      sessionState.title = saved.title || null
      sessionState.imageUrl = saved.imageUrl || null
      sessionState.inlineImages = saved.inlineImages || []
      sessionState.keywords = saved.keywords || null
      sessionState.metadata = saved.metadata || null
      sessionState.metaTitle = saved.metaTitle || null
      sessionState.metaDescription = saved.metaDescription || null
      sessionState.contentFolder = saved.contentFolder || null

      log(`Restored session from ${sessionFile}`)

      // Show all saved articles
      if (sessionState.articles.length > 0) {
        log(`  - ${sessionState.articles.length} article(s) in session:`)
        sessionState.articles.forEach((art, i) => {
          const wordCount = art.content?.split(/\s+/).length || 0
          const status = art.published ? `published to ${art.publishedTo.join(', ')}` : 'unpublished'
          log(`    ${i + 1}. "${art.title}" (${wordCount} words) - ${status}`)
        })
      }

      // Show current working article if different
      if (sessionState.title && !sessionState.articles.find(a => a.title === sessionState.title)) {
        log(`  - Current working: "${sessionState.title}" (${sessionState.article?.split(/\s+/).length || 0} words)`)
      }

      if (sessionState.contentFolder) {
        log(`  - Content folder: ${sessionState.contentFolder}`)
      }
      return true
    }
  } catch (error) {
    log(`Warning: Failed to load session: ${error.message}`)
  }
  return false
}

/**
 * Save session state to file (persists across MCP restarts)
 * Uses atomic write to prevent corruption
 */
function saveSession() {
  try {
    ensureSuparankDir()
    const sessionFile = getSessionFilePath()

    const toSave = {
      currentWorkflow: sessionState.currentWorkflow,
      stepResults: sessionState.stepResults,
      // Multi-article support
      articles: sessionState.articles,
      // Current working article (for backwards compat and active editing)
      article: sessionState.article,
      title: sessionState.title,
      imageUrl: sessionState.imageUrl,
      inlineImages: sessionState.inlineImages,
      keywords: sessionState.keywords,
      metadata: sessionState.metadata,
      metaTitle: sessionState.metaTitle,
      metaDescription: sessionState.metaDescription,
      contentFolder: sessionState.contentFolder,
      savedAt: new Date().toISOString()
    }

    // Atomic write to prevent corruption
    atomicWriteSync(sessionFile, JSON.stringify(toSave, null, 2))
    progress('Session', `Saved to ${sessionFile} (${sessionState.articles.length} articles)`)
  } catch (error) {
    log(`Warning: Failed to save session: ${error.message}`)
    progress('Session', `FAILED to save: ${error.message}`)
  }
}

/**
 * Extract image prompts from article content
 * Uses H2 headings to create contextual image prompts
 * @param {string} content - Article content in markdown
 * @param {object} projectConfig - Project configuration from database
 * @returns {Array<{heading: string, prompt: string}>} - Array of image prompts
 */
function extractImagePromptsFromArticle(content, projectConfig) {
  // Extract H2 headings from markdown
  const headings = content.match(/^## .+$/gm) || []

  // Get visual style from project config
  const visualStyle = projectConfig?.visual_style?.image_aesthetic || 'professional minimalist'
  const brandColors = projectConfig?.visual_style?.colors || []
  const brandVoice = projectConfig?.brand?.voice || 'professional'
  const niche = projectConfig?.site?.niche || ''

  // Limit to 4 images (1 hero + 3 section images)
  const selectedHeadings = headings.slice(0, 4)

  return selectedHeadings.map((heading, index) => {
    const topic = heading.replace(/^## /, '').trim()

    // Create contextual prompt based on heading
    let prompt = `${topic}`

    // Add visual style
    if (visualStyle) {
      prompt += `, ${visualStyle} style`
    }

    // Add brand context for hero image
    if (index === 0) {
      prompt += `, hero image for article about ${niche}`
    } else {
      prompt += `, illustration for ${niche} article`
    }

    // Add quality modifiers
    prompt += ', high quality, professional, clean composition, no text'

    return {
      heading: topic,
      prompt: prompt,
      type: index === 0 ? 'hero' : 'section',
      aspectRatio: '16:9'
    }
  })
}

/**
 * Save content to a dedicated folder with all assets
 * Creates: ~/.suparank/content/{date}-{slug}/
 *   - article.md (markdown content)
 *   - metadata.json (title, keywords, etc.)
 *   - workflow.json (workflow state for resuming)
 */
function saveContentToFolder() {
  if (!sessionState.title || !sessionState.article) {
    return null
  }

  try {
    ensureContentDir()

    // Create folder name: YYYY-MM-DD-slug
    const date = new Date().toISOString().split('T')[0]
    const slug = slugify(sessionState.title)
    const folderName = `${date}-${slug}`
    const folderPath = path.join(getContentDir(), folderName)

    // Create folder if doesn't exist
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true })
    }

    // Save markdown article
    atomicWriteSync(
      path.join(folderPath, 'article.md'),
      sessionState.article
    )

    // Save metadata
    const metadata = {
      title: sessionState.title,
      keywords: sessionState.keywords || [],
      metaDescription: sessionState.metaDescription || '',
      metaTitle: sessionState.metaTitle || sessionState.title,
      imageUrl: sessionState.imageUrl,
      inlineImages: sessionState.inlineImages || [],
      wordCount: sessionState.article.split(/\s+/).length,
      createdAt: new Date().toISOString(),
      projectSlug: projectSlug
    }
    atomicWriteSync(
      path.join(folderPath, 'metadata.json'),
      JSON.stringify(metadata, null, 2)
    )

    // Save workflow state for resuming
    if (sessionState.currentWorkflow) {
      atomicWriteSync(
        path.join(folderPath, 'workflow.json'),
        JSON.stringify({
          workflow: sessionState.currentWorkflow,
          stepResults: sessionState.stepResults,
          savedAt: new Date().toISOString()
        }, null, 2)
      )
    }

    // Store folder path in session
    sessionState.contentFolder = folderPath

    progress('Content', `Saved to folder: ${folderPath}`)
    return folderPath
  } catch (error) {
    log(`Warning: Failed to save content to folder: ${error.message}`)
    return null
  }
}

/**
 * Clear session file (called after successful publish or on reset)
 */
function clearSessionFile() {
  try {
    const sessionFile = getSessionFilePath()
    if (fs.existsSync(sessionFile)) {
      fs.unlinkSync(sessionFile)
    }
  } catch (error) {
    log(`Warning: Failed to clear session file: ${error.message}`)
  }
}

/**
 * Reset session state for new workflow (clears everything including all articles)
 */
function resetSession() {
  sessionState.currentWorkflow = null
  sessionState.stepResults = {}
  sessionState.articles = []  // Clear all saved articles
  sessionState.article = null
  sessionState.title = null
  sessionState.imageUrl = null
  sessionState.inlineImages = []
  sessionState.keywords = null
  sessionState.metadata = null
  sessionState.metaTitle = null
  sessionState.metaDescription = null
  sessionState.contentFolder = null

  // Clear persisted session file when starting fresh
  clearSessionFile()
}

/**
 * Clear current working article without removing saved articles
 * Use this after saving an article to prepare for the next one
 */
function clearCurrentArticle() {
  sessionState.article = null
  sessionState.title = null
  sessionState.imageUrl = null
  sessionState.inlineImages = []
  sessionState.keywords = null
  sessionState.metadata = null
  sessionState.metaTitle = null
  sessionState.metaDescription = null
}

/**
 * Load credentials from ~/.suparank/credentials.json
 * Falls back to legacy .env.superwriter paths for backward compatibility
 */
function loadLocalCredentials() {
  const searchPaths = [
    path.join(os.homedir(), '.suparank', 'credentials.json'),
    path.join(process.cwd(), '.env.superwriter'),  // Legacy support
    path.join(os.homedir(), '.env.superwriter')    // Legacy support
  ]

  for (const filePath of searchPaths) {
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8')
        const parsed = JSON.parse(content)
        log(`Loaded credentials from: ${filePath}`)
        return parsed
      } catch (e) {
        log(`Warning: Failed to parse ${filePath}: ${e.message}`)
      }
    }
  }

  log('No credentials found. Run "npx suparank setup" to configure. Action tools will be limited.')
  return null
}

/**
 * Check if a credential type is available
 */
function hasCredential(type) {
  if (!localCredentials) return false

  switch (type) {
    case 'wordpress':
      return !!localCredentials.wordpress?.secret_key || !!localCredentials.wordpress?.app_password
    case 'ghost':
      return !!localCredentials.ghost?.admin_api_key
    case 'fal':
      return !!localCredentials.fal?.api_key
    case 'gemini':
      return !!localCredentials.gemini?.api_key
    case 'wiro':
      return !!localCredentials.wiro?.api_key
    case 'image':
      const provider = localCredentials.image_provider
      return provider && hasCredential(provider)
    case 'webhooks':
      return !!localCredentials.webhooks && Object.values(localCredentials.webhooks).some(Boolean)
    default:
      return false
  }
}

/**
 * Get composition hints for a tool from local credentials
 */
function getCompositionHints(toolName) {
  if (!localCredentials?.tool_instructions) return null

  const instruction = localCredentials.tool_instructions.find(t => t.tool_name === toolName)
  return instruction?.composition_hints || null
}

/**
 * Get list of external MCPs configured
 */
function getExternalMCPs() {
  return localCredentials?.external_mcps || []
}

// Fetch project config from API
async function fetchProjectConfig() {
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

// Call backend API to execute tool
async function callBackendTool(toolName, args) {
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

// Tool definitions (synced with backend)
const TOOLS = [
  {
    name: 'keyword_research',
    description: `Research keywords for SEO. Use ONLY when user specifically asks for keyword research WITHOUT wanting full article creation.

TRIGGERS - Use when user says:
- "find keywords for..."
- "research keywords about..."
- "what keywords should I target for..."
- "keyword ideas for..."
- "analyze keywords for..."

DO NOT USE when user wants to write/create content - use create_content instead (it includes keyword research automatically).

OUTCOME: List of keywords with search volume, difficulty, and recommendations.`,
    inputSchema: {
      type: 'object',
      properties: {
        seed_keyword: {
          type: 'string',
          description: 'Starting keyword or topic to research (optional - uses project primary keywords if not specified)'
        },
        content_goal: {
          type: 'string',
          enum: ['traffic', 'conversions', 'brand-awareness'],
          description: 'Primary goal for the content strategy (optional - defaults to traffic)'
        },
        competitor_domain: {
          type: 'string',
          description: 'Optional: Competitor domain to analyze'
        }
      }
    }
  },
  {
    name: 'seo_strategy',
    description: 'Create comprehensive SEO strategy and content brief. Works with project keywords automatically if none specified.',
    inputSchema: {
      type: 'object',
      properties: {
        target_keyword: {
          type: 'string',
          description: 'Main keyword to target (optional - uses project primary keywords if not specified)'
        },
        content_type: {
          type: 'string',
          enum: ['guide', 'listicle', 'how-to', 'comparison', 'review'],
          description: 'Type of content to create (optional - defaults to guide)'
        },
        search_intent: {
          type: 'string',
          enum: ['informational', 'commercial', 'transactional', 'navigational'],
          description: 'Primary search intent to target (optional - auto-detected)'
        }
      }
    }
  },
  {
    name: 'topical_map',
    description: 'Design pillar-cluster content architecture for topical authority. Uses project niche and keywords automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        core_topic: {
          type: 'string',
          description: 'Main topic for the content cluster (optional - uses project niche if not specified)'
        },
        depth: {
          type: 'number',
          enum: [1, 2, 3],
          description: 'Depth of content cluster: 1 (pillar + 5 articles), 2 (+ subtopics), 3 (full hierarchy)',
          default: 2
        }
      }
    }
  },
  {
    name: 'content_calendar',
    description: 'Create editorial calendar and publication schedule. Uses project keywords and niche automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        time_period: {
          type: 'string',
          enum: ['week', 'month', 'quarter'],
          description: 'Planning period for the content calendar (optional - defaults to month)',
          default: 'month'
        },
        content_types: {
          type: 'array',
          items: { type: 'string' },
          description: 'Types of content to include (optional - defaults to blog)'
        },
        priority_keywords: {
          type: 'array',
          items: { type: 'string' },
          description: 'Keywords to prioritize (optional - uses project keywords)'
        }
      }
    }
  },
  {
    name: 'content_write',
    description: 'Write comprehensive, SEO-optimized blog articles. Creates engaging content with proper structure, internal links, and semantic optimization. Uses project brand voice and keywords automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Article title or headline (optional - can be generated from topic)'
        },
        target_keyword: {
          type: 'string',
          description: 'Primary keyword to optimize for (optional - uses project keywords)'
        },
        outline: {
          type: 'string',
          description: 'Optional: Article outline or structure (H2/H3 headings)'
        },
        tone: {
          type: 'string',
          enum: ['professional', 'casual', 'conversational', 'technical'],
          description: 'Writing tone (optional - uses project brand voice)'
        }
      }
    }
  },
  {
    name: 'image_prompt',
    description: 'Create optimized prompts for AI image generation. Designs prompts for blog hero images, section illustrations, and branded visuals. Uses project visual style and brand automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        image_purpose: {
          type: 'string',
          enum: ['hero', 'section', 'diagram', 'comparison', 'infographic'],
          description: 'Purpose of the image (optional - defaults to hero)',
          default: 'hero'
        },
        subject: {
          type: 'string',
          description: 'Main subject or concept for the image (optional - uses project niche)'
        },
        mood: {
          type: 'string',
          description: 'Optional: Desired mood (uses project visual style if not specified)'
        }
      }
    }
  },
  {
    name: 'internal_links',
    description: 'Develop strategic internal linking plan. Analyzes existing content and identifies linking opportunities for improved site architecture. Works with project content automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        current_page: {
          type: 'string',
          description: 'URL or title of the page to optimize (optional - can work with last created content)'
        },
        available_pages: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of existing pages to consider (optional - can analyze site automatically)'
        },
        link_goal: {
          type: 'string',
          enum: ['authority-building', 'user-navigation', 'conversion'],
          description: 'Primary goal for internal linking (optional - defaults to authority-building)'
        }
      }
    }
  },
  {
    name: 'schema_generate',
    description: 'Implement Schema.org structured data markup. Analyzes content to recommend and generate appropriate JSON-LD schemas for enhanced search visibility. Auto-detects page type if not specified.',
    inputSchema: {
      type: 'object',
      properties: {
        page_type: {
          type: 'string',
          enum: ['article', 'product', 'how-to', 'faq', 'review', 'organization'],
          description: 'Type of page to generate schema for (optional - auto-detected from content)'
        },
        content_summary: {
          type: 'string',
          description: 'Brief summary of the page content (optional - can analyze content)'
        }
      }
    }
  },
  {
    name: 'geo_optimize',
    description: 'Optimize content for AI search engines and Google SGE. Implements GEO (Generative Engine Optimization) best practices for LLM-friendly content. Works with project content automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        content_url: {
          type: 'string',
          description: 'URL or title of content to optimize (optional - can work with last created content)'
        },
        target_engines: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['chatgpt', 'perplexity', 'claude', 'gemini', 'google-sge']
          },
          description: 'AI search engines to optimize for (optional - defaults to all)',
          default: ['chatgpt', 'google-sge']
        }
      }
    }
  },
  {
    name: 'quality_check',
    description: 'Perform comprehensive pre-publish quality assurance. Checks grammar, SEO requirements, brand consistency, accessibility, and technical accuracy. Can review last created content automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'Full content to review (optional - can review last created content)'
        },
        check_type: {
          type: 'string',
          enum: ['full', 'seo-only', 'grammar-only', 'brand-only'],
          description: 'Type of quality check to perform (optional - defaults to full)',
          default: 'full'
        }
      }
    }
  },
  {
    name: 'full_pipeline',
    description: 'Execute complete 5-phase content creation pipeline. Orchestrates research, planning, creation, optimization, and quality checking in one workflow. Works with project configuration automatically - just describe what you need!',
    inputSchema: {
      type: 'object',
      properties: {
        seed_keyword: {
          type: 'string',
          description: 'Starting keyword for the pipeline (optional - uses project primary keywords and niche)'
        },
        content_type: {
          type: 'string',
          enum: ['guide', 'listicle', 'how-to', 'comparison', 'review'],
          description: 'Type of content to create (optional - defaults to guide)',
          default: 'guide'
        },
        skip_phases: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['research', 'planning', 'creation', 'optimization', 'quality']
          },
          description: 'Optional: Phases to skip in the pipeline'
        }
      }
    }
  }
]

// Action tools that require local credentials
const ACTION_TOOLS = [
  {
    name: 'generate_image',
    description: `Generate AI images. Use when user wants to create, generate, or regenerate images.

TRIGGERS - Use when user says:
- "create an image for..."
- "generate image of..."
- "make a picture of..."
- "I need an image for..."
- "regenerate the image"
- "new hero image"
- "create thumbnail for..."

NOTE: create_content automatically generates images. Use this tool for:
- Regenerating/replacing images
- Creating standalone images
- Custom image requests outside content workflow

OUTCOME: AI-generated image URL ready for use.`,
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Detailed prompt for image generation'
        },
        style: {
          type: 'string',
          description: 'Style guidance (e.g., "minimalist", "photorealistic", "illustration")'
        },
        aspect_ratio: {
          type: 'string',
          enum: ['1:1', '16:9', '9:16', '4:3', '3:4'],
          description: 'Image aspect ratio',
          default: '16:9'
        }
      },
      required: ['prompt']
    },
    requiresCredential: 'image'
  },
  {
    name: 'publish_wordpress',
    description: 'Publish content directly to WordPress (supports .com and .org). Requires WordPress credentials in ~/.suparank/credentials.json',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Post title'
        },
        content: {
          type: 'string',
          description: 'Full post content (HTML or Markdown)'
        },
        status: {
          type: 'string',
          enum: ['draft', 'publish'],
          description: 'Publication status',
          default: 'draft'
        },
        categories: {
          type: 'array',
          items: { type: 'string' },
          description: 'Category names'
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tag names'
        },
        featured_image_url: {
          type: 'string',
          description: 'URL of featured image to upload'
        }
      },
      required: ['title', 'content']
    },
    requiresCredential: 'wordpress'
  },
  {
    name: 'publish_ghost',
    description: 'Publish content to Ghost CMS. Requires Ghost Admin API key in ~/.suparank/credentials.json',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Post title'
        },
        content: {
          type: 'string',
          description: 'Full post content (HTML or Markdown)'
        },
        status: {
          type: 'string',
          enum: ['draft', 'published'],
          description: 'Publication status',
          default: 'draft'
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tag names'
        },
        featured_image_url: {
          type: 'string',
          description: 'URL of featured image'
        }
      },
      required: ['title', 'content']
    },
    requiresCredential: 'ghost'
  },
  {
    name: 'send_webhook',
    description: 'Send data to configured webhooks (Make.com, n8n, Zapier, Slack). Requires webhook URLs in ~/.suparank/credentials.json',
    inputSchema: {
      type: 'object',
      properties: {
        webhook_type: {
          type: 'string',
          enum: ['default', 'make', 'n8n', 'zapier', 'slack'],
          description: 'Which webhook to use',
          default: 'default'
        },
        payload: {
          type: 'object',
          description: 'Data to send in the webhook'
        },
        message: {
          type: 'string',
          description: 'For Slack: formatted message text'
        }
      },
      required: ['webhook_type']
    },
    requiresCredential: 'webhooks'
  }
]

// Orchestrator tools for automated workflows
const ORCHESTRATOR_TOOLS = [
  {
    name: 'create_content',
    description: `PRIMARY TOOL for content creation. Use this when user wants to write, create, or generate any content.

TRIGGERS - Use when user says:
- "write a blog post about..."
- "create an article about..."
- "I need content for..."
- "help me write about..."
- "generate a post on..."
- "make content about..."
- any request involving writing/creating/generating articles or blog posts

WORKFLOW (automatic 4-phase):
1. RESEARCH: Keywords, SEO strategy, content structure
2. CREATION: Outline, write full article, save to session
3. OPTIMIZATION: Quality check, GEO optimization for AI search
4. PUBLISHING: Generate images, publish to WordPress/Ghost

OUTCOME: Complete article written, optimized, and published to CMS.`,
    inputSchema: {
      type: 'object',
      properties: {
        request: {
          type: 'string',
          description: 'What content do you want? (e.g., "write a blog post about AI", "create 5 articles")'
        },
        count: {
          type: 'number',
          description: 'Number of articles to create (default: 1)',
          default: 1
        },
        publish_to: {
          type: 'array',
          items: { type: 'string', enum: ['ghost', 'wordpress', 'none'] },
          description: 'Where to publish (default: all configured CMS)',
          default: []
        },
        with_images: {
          type: 'boolean',
          description: 'Generate hero images (default: true)',
          default: true
        }
      }
    }
  },
  {
    name: 'save_content',
    description: `Save written article to session. Use after manually writing content outside create_content workflow.

TRIGGERS - Use when:
- You wrote an article manually and need to save it
- User says "save this article" / "save my content"
- Saving edited/revised content

NOTE: create_content saves automatically. Only use this for manual saves.

OUTCOME: Article saved to session, ready for publishing.`,
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Article title'
        },
        content: {
          type: 'string',
          description: 'Full article content (markdown)'
        },
        keywords: {
          type: 'array',
          items: { type: 'string' },
          description: 'Target keywords used'
        },
        meta_description: {
          type: 'string',
          description: 'SEO meta description'
        }
      },
      required: ['title', 'content']
    }
  },
  {
    name: 'publish_content',
    description: `Publish articles to WordPress/Ghost. Use when user wants to publish saved content.

TRIGGERS - Use when user says:
- "publish my article"
- "post this to WordPress/Ghost"
- "publish to my blog"
- "make it live"
- "publish as draft"

NOTE: create_content publishes automatically. Use this for:
- Manual publishing control
- Re-publishing edited content
- Publishing specific articles from session

OUTCOME: Article published to configured CMS platforms.`,
    inputSchema: {
      type: 'object',
      properties: {
        platforms: {
          type: 'array',
          items: { type: 'string', enum: ['ghost', 'wordpress', 'all'] },
          description: 'Platforms to publish to (default: all configured)',
          default: ['all']
        },
        status: {
          type: 'string',
          enum: ['draft', 'publish'],
          description: 'Publication status',
          default: 'draft'
        },
        category: {
          type: 'string',
          description: 'WordPress category name - pick the most relevant one from available categories shown in save_content response'
        },
        article_numbers: {
          type: 'array',
          items: { type: 'number' },
          description: 'Optional: Publish specific articles by number (1, 2, 3...). If not specified, publishes ALL unpublished articles.'
        }
      }
    }
  },
  {
    name: 'get_session',
    description: `View current session status. Shows saved articles, images, and publishing state.

TRIGGERS - Use when user says:
- "what's in my session"
- "show my articles"
- "what have I created"
- "session status"
- "list my saved content"

OUTCOME: List of all articles in session with their publish status.`,
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'remove_article',
    description: `Remove article(s) from session. Does NOT delete published content.

TRIGGERS - Use when user says:
- "remove article 2"
- "delete the second article"
- "remove that article"
- "discard article..."

OUTCOME: Specified article(s) removed from session.`,
    inputSchema: {
      type: 'object',
      properties: {
        article_numbers: {
          type: 'array',
          items: { type: 'number' },
          description: 'Article numbers to remove (1, 2, 3...). Use get_session to see article numbers.'
        }
      },
      required: ['article_numbers']
    }
  },
  {
    name: 'clear_session',
    description: `Clear ALL content from session. DESTRUCTIVE - removes all unpublished articles!

TRIGGERS - Use when user says:
- "clear my session"
- "start fresh"
- "remove all articles"
- "reset everything"
- "clear all content"

WARNING: Requires confirm: true. Does NOT affect already-published content.

OUTCOME: Empty session, ready for new content creation.`,
    inputSchema: {
      type: 'object',
      properties: {
        confirm: {
          type: 'boolean',
          description: 'Must be true to confirm clearing all content'
        }
      },
      required: ['confirm']
    }
  },
  {
    name: 'list_content',
    description: `List all saved content from disk. Shows past articles that can be loaded back.

TRIGGERS - Use when user says:
- "show my past articles"
- "list saved content"
- "what articles do I have"
- "show previous content"
- "find my old articles"

NOTE: Different from get_session - this shows DISK storage, not current session.

OUTCOME: List of saved article folders with titles and dates.`,
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Max number of articles to show (default: 20)',
          default: 20
        }
      }
    }
  },
  {
    name: 'load_content',
    description: `Load a saved article back into session for editing or re-publishing.

TRIGGERS - Use when user says:
- "load my article about..."
- "open the previous article"
- "bring back that article"
- "edit my old post about..."
- "reload article..."

WORKFLOW: Run list_content first to see available articles, then load by folder name.

OUTCOME: Article loaded into session, ready for optimization or re-publishing.`,
    inputSchema: {
      type: 'object',
      properties: {
        folder_name: {
          type: 'string',
          description: 'Folder name from list_content (e.g., "2026-01-09-my-article-title")'
        }
      },
      required: ['folder_name']
    }
  }
]

/**
 * Build workflow plan based on user request and available credentials
 *
 * ALL data comes from project.config (Supabase database) - NO HARDCODED DEFAULTS
 */
/**
 * Validate project configuration with helpful error messages
 */
function validateProjectConfig(config) {
  const errors = []

  if (!config) {
    throw new Error('Project configuration not found. Please configure your project in the dashboard.')
  }

  // Check required fields
  if (!config.content?.default_word_count) {
    errors.push('Word count: Not set → Dashboard → Project Settings → Content')
  } else if (typeof config.content.default_word_count !== 'number' || config.content.default_word_count < 100) {
    errors.push('Word count: Must be at least 100 words')
  } else if (config.content.default_word_count > 10000) {
    errors.push('Word count: Maximum 10,000 words supported')
  }

  if (!config.brand?.voice) {
    errors.push('Brand voice: Not set → Dashboard → Project Settings → Brand')
  }

  if (!config.site?.niche) {
    errors.push('Niche: Not set → Dashboard → Project Settings → Site')
  }

  // Warnings (non-blocking but helpful)
  const warnings = []
  if (!config.seo?.primary_keywords?.length) {
    warnings.push('No primary keywords set - content may lack SEO focus')
  }
  if (!config.brand?.target_audience) {
    warnings.push('No target audience set - content may be too generic')
  }

  if (errors.length > 0) {
    throw new Error(`Project configuration incomplete:\n${errors.map(e => `  • ${e}`).join('\n')}`)
  }

  return { warnings }
}

function buildWorkflowPlan(request, count, publishTo, withImages, project) {
  const steps = []
  const hasGhost = hasCredential('ghost')
  const hasWordPress = hasCredential('wordpress')
  const hasImageGen = hasCredential('image')

  // Get project config from database - MUST be dynamic, no hardcoding
  const config = project?.config

  // Validate configuration with helpful messages
  const { warnings } = validateProjectConfig(config)
  if (warnings.length > 0) {
    log(`Config warnings: ${warnings.join('; ')}`)
  }

  // Extract all settings from project.config (database schema)
  const targetWordCount = config.content?.default_word_count
  const readingLevel = config.content?.reading_level
  const includeImages = config.content?.include_images
  const brandVoice = config.brand?.voice
  const targetAudience = config.brand?.target_audience
  const differentiators = config.brand?.differentiators || []
  const visualStyle = config.visual_style?.image_aesthetic
  const brandColors = config.visual_style?.colors || []
  const primaryKeywords = config.seo?.primary_keywords || []
  const geoFocus = config.seo?.geo_focus
  const niche = config.site?.niche
  const siteName = config.site?.name
  const siteUrl = config.site?.url
  const siteDescription = config.site?.description

  // Calculate required images: 1 cover + 1 per 300 words (only if includeImages is true)
  const shouldGenerateImages = withImages && includeImages && hasImageGen
  const contentImageCount = shouldGenerateImages ? Math.floor(targetWordCount / 300) : 0
  const totalImages = shouldGenerateImages ? 1 + contentImageCount : 0 // cover + inline images

  // Format reading level for display (stored as number, display as "Grade X")
  const readingLevelDisplay = readingLevel ? `Grade ${readingLevel}` : 'Not set'

  // Format keywords for display
  const keywordsDisplay = primaryKeywords.length > 0 ? primaryKeywords.join(', ') : 'No keywords set'

  // Determine publish targets
  let targets = publishTo || []
  if (targets.length === 0 || targets.includes('all')) {
    targets = []
    if (hasGhost) targets.push('ghost')
    if (hasWordPress) targets.push('wordpress')
  }

  let stepNum = 0

  // Step 1: Keyword Research
  // Build dynamic MCP hints from local credentials (user-configured in credentials.json)
  const externalMcps = getExternalMCPs()
  const keywordResearchHints = getCompositionHints('keyword_research')

  let mcpInstructions = ''
  if (externalMcps.length > 0) {
    const mcpList = externalMcps.map(m => `- **${m.name}**: ${m.available_tools?.join(', ') || 'tools available'}`).join('\n')
    mcpInstructions = `\n💡 **External MCPs Available (from your credentials.json):**\n${mcpList}`
    if (keywordResearchHints) {
      mcpInstructions += `\n\n**Integration Hint:** ${keywordResearchHints}`
    }
  }

  // ═══════════════════════════════════════════════════════════
  // RESEARCH PHASE
  // ═══════════════════════════════════════════════════════════

  stepNum++
  steps.push({
    step: stepNum,
    type: 'llm_execute',
    action: 'keyword_research',
    instruction: `Research keywords for: "${request}"

**Project Context (from database):**
- Site: ${siteName} (${siteUrl})
- Niche: ${niche}
- Description: ${siteDescription || 'Not set'}
- Primary keywords: ${keywordsDisplay}
- Geographic focus: ${geoFocus || 'Global'}
${mcpInstructions}

**Deliverables:**
- 1 primary keyword to target (lower difficulty preferred)
- 3-5 secondary/LSI keywords
- 2-3 question-based keywords for FAQ section`,
    store: 'keywords'
  })

  // Step 2: SEO Strategy & Content Brief
  stepNum++
  steps.push({
    step: stepNum,
    type: 'llm_execute',
    action: 'seo_strategy',
    instruction: `Create SEO strategy and content brief for: "${request}"

**Using Keywords from Step 1:**
- Use the primary keyword you identified
- Incorporate secondary/LSI keywords naturally

**Project Context:**
- Site: ${siteName}
- Niche: ${niche}
- Target audience: ${targetAudience || 'Not specified'}
- Brand voice: ${brandVoice}
- Geographic focus: ${geoFocus || 'Global'}

**Deliverables:**
1. **Search Intent Analysis** - What is the user trying to accomplish?
2. **Competitor Gap Analysis** - What are top 3 ranking pages missing?
3. **Content Brief:**
   - Recommended content type (guide/listicle/how-to/comparison)
   - Unique angle to differentiate from competitors
   - Key points to cover that competitors miss
4. **On-Page SEO Checklist:**
   - Title tag format
   - Meta description template
   - Header structure (H1, H2, H3)
   - Internal linking opportunities`,
    store: 'seo_strategy'
  })

  // Step 3: Topical Map (Content Architecture)
  stepNum++
  steps.push({
    step: stepNum,
    type: 'llm_execute',
    action: 'topical_map',
    instruction: `Design content architecture for: "${request}"

**Build a Pillar-Cluster Structure:**
- Main pillar topic (this article)
- Supporting cluster articles (future content opportunities)

**Project Context:**
- Site: ${siteName}
- Niche: ${niche}
- Primary keywords: ${keywordsDisplay}

**Deliverables:**
1. **Pillar Page Concept** - What should this main article establish?
2. **Cluster Topics** - 5-7 related subtopics for future articles
3. **Internal Linking Plan** - How these articles connect
4. **Content Gaps** - What topics are missing in this niche?

Note: Focus on the CURRENT article structure, but identify opportunities for a content cluster.`,
    store: 'topical_map'
  })

  // Step 4: Content Calendar (only for multi-article requests)
  if (count > 1) {
    stepNum++
    steps.push({
      step: stepNum,
      type: 'llm_execute',
      action: 'content_calendar',
      instruction: `Plan content calendar for ${count} articles about: "${request}"

**Project Context:**
- Site: ${siteName}
- Niche: ${niche}
- Articles to create: ${count}

**Deliverables:**
1. **Article Sequence** - Order to create articles (foundational → specific)
2. **Topic List** - ${count} specific titles/topics
3. **Keyword Assignment** - Primary keyword for each article
4. **Publishing Cadence** - Recommended frequency

Note: This guides the creation of all ${count} articles in this session.`,
      store: 'content_calendar'
    })
  }

  // ═══════════════════════════════════════════════════════════
  // CREATION PHASE
  // ═══════════════════════════════════════════════════════════

  // Step N: Content Planning with SEO Meta
  stepNum++
  steps.push({
    step: stepNum,
    type: 'llm_execute',
    action: 'content_planning',
    instruction: `Create a detailed content outline with SEO meta:

**Project Requirements (from database):**
- Site: ${siteName}
- Target audience: ${targetAudience || 'Not specified'}
- Brand voice: ${brandVoice}
- Brand differentiators: ${differentiators.length > 0 ? differentiators.join(', ') : 'Not set'}
- Word count: **${targetWordCount} words MINIMUM** (this is required!)
- Reading level: **${readingLevelDisplay}** (use simple sentences, avoid jargon)

**You MUST create:**

1. **SEO Meta Title** (50-60 characters, include primary keyword)
2. **SEO Meta Description** (150-160 characters, compelling, include keyword)
3. **URL Slug** (lowercase, hyphens, keyword-rich)
4. **Content Outline:**
   - H1: Main title
   - 6-8 H2 sections (to achieve ${targetWordCount} words)
   - H3 subsections where needed
   - FAQ section with 4-5 questions

${shouldGenerateImages ? `**Image Placeholders:** Mark where ${contentImageCount} inline images should go (1 every ~300 words)
Use format: [IMAGE: description of what image should show]` : '**Note:** Images disabled for this project.'}`,
    store: 'outline'
  })

  // Step 3: Write Content
  stepNum++
  steps.push({
    step: stepNum,
    type: 'llm_execute',
    action: 'content_write',
    instruction: `Write the COMPLETE article following your outline.

**⚠️ CRITICAL REQUIREMENTS (from project database):**
- Word count: **${targetWordCount} words MINIMUM** - Count your words!
- Reading level: **${readingLevelDisplay}** - Simple sentences, short paragraphs, no jargon
- Brand voice: ${brandVoice}
- Target audience: ${targetAudience || 'General readers'}

**Content Structure:**
- Engaging hook in first 2 sentences
- All H2/H3 sections from your outline
- Statistics, examples, and actionable tips in each section
${shouldGenerateImages ? '- Image placeholders: [IMAGE: description] where images should go' : ''}
- FAQ section with 4-5 Q&As
- Strong conclusion with clear CTA

**After writing, call 'save_content' with:**
- title: Your SEO-optimized title
- content: The full article (markdown)
- keywords: Array of target keywords
- meta_description: Your 150-160 char meta description

⚠️ DO NOT proceed until you've written ${targetWordCount}+ words!`,
    store: 'article'
  })

  // ═══════════════════════════════════════════════════════════
  // OPTIMIZATION PHASE
  // ═══════════════════════════════════════════════════════════

  // Quality Check - Pre-publish QA
  stepNum++
  steps.push({
    step: stepNum,
    type: 'llm_execute',
    action: 'quality_check',
    instruction: `Perform quality check on the article you just saved.

**Quality Checklist:**

1. **SEO Check:**
   - ✓ Primary keyword in H1, first 100 words, URL slug
   - ✓ Secondary keywords distributed naturally
   - ✓ Meta title 50-60 characters
   - ✓ Meta description 150-160 characters
   - ✓ Proper header hierarchy (H1 → H2 → H3)

2. **Content Quality:**
   - ✓ Word count meets requirement (${targetWordCount}+ words)
   - ✓ Reading level appropriate (${readingLevelDisplay})
   - ✓ No grammar or spelling errors
   - ✓ Factual accuracy (no made-up statistics)

3. **Brand Consistency:**
   - ✓ Voice matches: ${brandVoice}
   - ✓ Speaks to: ${targetAudience || 'target audience'}
   - ✓ Aligns with ${siteName} brand

4. **Engagement:**
   - ✓ Strong hook in introduction
   - ✓ Clear value proposition
   - ✓ Actionable takeaways
   - ✓ Compelling CTA in conclusion

**Report any issues found and suggest fixes. If major issues exist, fix them before proceeding.**`,
    store: 'quality_report'
  })

  // GEO Optimize - AI Search Engine Optimization
  stepNum++
  steps.push({
    step: stepNum,
    type: 'llm_execute',
    action: 'geo_optimize',
    instruction: `Optimize article for AI search engines (ChatGPT, Perplexity, Google SGE, Claude).

**GEO (Generative Engine Optimization) Checklist:**

1. **Structured Answers:**
   - ✓ Clear, direct answers to common questions
   - ✓ Definition boxes for key terms
   - ✓ TL;DR sections for complex topics

2. **Citation-Worthy Content:**
   - ✓ Original statistics or data points
   - ✓ Expert quotes or authoritative sources
   - ✓ Unique insights not found elsewhere

3. **LLM-Friendly Structure:**
   - ✓ Bulleted lists for easy extraction
   - ✓ Tables for comparisons
   - ✓ Step-by-step numbered processes

4. **Semantic Clarity:**
   - ✓ Clear topic sentences per paragraph
   - ✓ Explicit cause-effect relationships
   - ✓ Avoid ambiguous pronouns

**Target AI Engines:**
- ChatGPT (conversational answers)
- Perplexity (citation-heavy)
- Google SGE (structured snippets)
- Claude (comprehensive analysis)

**Review the saved article and suggest specific improvements to make it more likely to be cited by AI search engines.**`,
    store: 'geo_report'
  })

  // ═══════════════════════════════════════════════════════════
  // PUBLISHING PHASE
  // ═══════════════════════════════════════════════════════════

  // Generate Images (if enabled in project settings AND credentials available)
  if (shouldGenerateImages) {
    // Format brand colors for image style guidance
    const colorsDisplay = brandColors.length > 0 ? brandColors.join(', ') : 'Not specified'

    stepNum++
    steps.push({
      step: stepNum,
      type: 'llm_execute',
      action: 'generate_images',
      instruction: `Generate ${totalImages} images for the article:

**Required Images:**
1. **Cover/Hero Image** - Main article header (16:9 aspect ratio)
${Array.from({length: contentImageCount}, (_, i) => `${i + 2}. **Section Image ${i + 1}** - For content section ${i + 1} (16:9 aspect ratio)`).join('\n')}

**For each image, call 'generate_image' tool with:**
- prompt: Detailed description based on article content
- style: ${visualStyle || 'professional minimalist'}
- aspect_ratio: 16:9

**Visual Style (from project database):**
- Image aesthetic: ${visualStyle || 'Not specified'}
- Brand colors: ${colorsDisplay}
- Keep consistent with ${siteName} brand identity

**Image Style Guide:**
- Professional, clean aesthetic
- Relevant to the section topic
- No text in images
- Consistent style across all images

After generating, note the URLs - they will be saved automatically for publishing.`,
      image_count: totalImages,
      store: 'images'
    })
  }

  // Step 5: Publish
  if (targets.length > 0) {
    stepNum++
    steps.push({
      step: stepNum,
      type: 'action',
      action: 'publish',
      instruction: `Publish the article to: ${targets.join(', ')}

Call 'publish_content' tool - it will automatically use:
- Saved article title and content
- SEO meta description
- Generated images (cover + inline)
- Target keywords as tags`,
      targets: targets
    })
  }

  return {
    workflow_id: `wf_${Date.now()}`,
    request: request,
    total_articles: count,
    current_article: 1,
    total_steps: steps.length,
    current_step: 1,
    // All settings come from project.config (database) - no hardcoded values
    project_info: {
      name: siteName,
      url: siteUrl,
      niche: niche
    },
    settings: {
      target_word_count: targetWordCount,
      reading_level: readingLevel,
      reading_level_display: readingLevelDisplay,
      brand_voice: brandVoice,
      target_audience: targetAudience,
      include_images: includeImages,
      total_images: totalImages,
      content_images: contentImageCount,
      visual_style: visualStyle,
      primary_keywords: primaryKeywords,
      geo_focus: geoFocus
    },
    available_integrations: {
      external_mcps: externalMcps.map(m => m.name),
      ghost: hasGhost,
      wordpress: hasWordPress,
      image_generation: hasImageGen
    },
    steps: steps
  }
}

/**
 * Execute orchestrator tools
 */
async function executeOrchestratorTool(toolName, args, project) {
  switch (toolName) {
    case 'create_content': {
      resetSession()
      const { request = '', count = 1, publish_to = [], with_images = true } = args

      const plan = buildWorkflowPlan(
        request || `content about ${project?.niche || 'the project topic'}`,
        count,
        publish_to,
        with_images,
        project
      )

      sessionState.currentWorkflow = plan

      // Persist session to file for workflow continuity
      saveSession()

      // Build response with clear instructions - all data from database
      const mcpList = plan.available_integrations.external_mcps.length > 0
        ? plan.available_integrations.external_mcps.join(', ')
        : 'None configured'

      let response = `# 🚀 Content Creation Workflow Started

## Your Request
"${plan.request}"

## Project: ${plan.project_info.name}
- **URL:** ${plan.project_info.url}
- **Niche:** ${plan.project_info.niche}

## Content Settings (from database)
| Setting | Value |
|---------|-------|
| **Word Count** | ${plan.settings.target_word_count} words |
| **Reading Level** | ${plan.settings.reading_level_display} |
| **Brand Voice** | ${plan.settings.brand_voice} |
| **Target Audience** | ${plan.settings.target_audience || 'Not specified'} |
| **Primary Keywords** | ${plan.settings.primary_keywords?.join(', ') || 'Not set'} |
| **Geographic Focus** | ${plan.settings.geo_focus || 'Global'} |
| **Visual Style** | ${plan.settings.visual_style || 'Not specified'} |
| **Include Images** | ${plan.settings.include_images ? 'Yes' : 'No'} |
| **Images Required** | ${plan.settings.total_images} (1 cover + ${plan.settings.content_images} inline) |

## Workflow Plan (4 Phases)

### RESEARCH PHASE
${plan.steps.filter(s => ['keyword_research', 'seo_strategy', 'topical_map', 'content_calendar'].includes(s.action)).map(s => `${s.step}. **${s.action}**`).join('\n')}

### CREATION PHASE
${plan.steps.filter(s => ['content_planning', 'content_write'].includes(s.action)).map(s => `${s.step}. **${s.action}**`).join('\n')}

### OPTIMIZATION PHASE
${plan.steps.filter(s => ['quality_check', 'geo_optimize'].includes(s.action)).map(s => `${s.step}. **${s.action}**`).join('\n')}

### PUBLISHING PHASE
${plan.steps.filter(s => ['generate_images', 'publish'].includes(s.action)).map(s => `${s.step}. **${s.action}**`).join('\n')}

## Available Integrations (from ~/.suparank/credentials.json)
- External MCPs: ${mcpList}
- Image Generation: ${plan.available_integrations.image_generation ? '✅ Ready' : '❌ Not configured'}
- Ghost CMS: ${plan.available_integrations.ghost ? '✅ Ready' : '❌ Not configured'}
- WordPress: ${plan.available_integrations.wordpress ? '✅ Ready' : '❌ Not configured'}

---

## Step 1 of ${plan.total_steps}: ${plan.steps[0].action.toUpperCase()}

${plan.steps[0].instruction}

---

**When you complete this step, move to Step 2.**
`

      return {
        content: [{
          type: 'text',
          text: response
        }]
      }
    }

    case 'save_content': {
      const { title, content, keywords = [], meta_description = '' } = args
      const wordCount = content.split(/\s+/).length

      // Create article object with unique ID
      const articleId = generateArticleId()
      const newArticle = {
        id: articleId,
        title,
        content,
        keywords,
        metaDescription: meta_description,
        metaTitle: title,
        imageUrl: sessionState.imageUrl || null,  // Attach any generated cover image
        inlineImages: [...sessionState.inlineImages],  // Copy current inline images
        savedAt: new Date().toISOString(),
        published: false,
        publishedTo: [],
        wordCount
      }

      // Add to articles array (not overwriting previous articles!)
      sessionState.articles.push(newArticle)

      // Also keep in current working fields for backwards compatibility
      sessionState.title = title
      sessionState.article = content
      sessionState.keywords = keywords
      sessionState.metaDescription = meta_description
      sessionState.metadata = { meta_description }

      // Persist session to file and save to content folder
      saveSession()
      const contentFolder = saveContentToFolder()

      progress('Content', `Saved "${title}" (${wordCount} words) as article #${sessionState.articles.length}${contentFolder ? ` → ${contentFolder}` : ''}`)

      // Clear current working images so next article starts fresh
      // (images are already attached to the saved article)
      sessionState.imageUrl = null
      sessionState.inlineImages = []

      const workflow = sessionState.currentWorkflow
      const targetWordCount = workflow?.settings?.target_word_count
      const wordCountOk = targetWordCount ? wordCount >= targetWordCount * 0.9 : true // Allow 10% tolerance

      // Find next step
      const imageStep = workflow?.steps?.find(s => s.action === 'generate_images')
      const totalImages = workflow?.settings?.total_images || 0
      const includeImages = workflow?.settings?.include_images

      // Fetch WordPress categories for intelligent assignment
      let categoriesSection = ''
      if (hasCredential('wordpress')) {
        const wpCategories = await fetchWordPressCategories()
        if (wpCategories && wpCategories.length > 0) {
          const categoryList = wpCategories
            .slice(0, 15) // Show top 15 by post count
            .map(c => `- **${c.name}** (${c.count} posts)${c.description ? `: ${c.description}` : ''}`)
            .join('\n')
          categoriesSection = `\n## WordPress Categories Available
Pick the most relevant category when publishing:
${categoryList}

When calling \`publish_content\`, include the \`category\` parameter with your choice.\n`
        }
      }

      // Show all articles in session
      const articlesListSection = sessionState.articles.length > 1 ? `
## Articles in Session (${sessionState.articles.length} total)
${sessionState.articles.map((art, i) => {
  const status = art.published ? `✅ published to ${art.publishedTo.join(', ')}` : '📝 unpublished'
  return `${i + 1}. **${art.title}** (${art.wordCount} words) - ${status}`
}).join('\n')}

Use \`publish_content\` to publish all unpublished articles, or \`get_session\` to see full details.
` : ''

      return {
        content: [{
          type: 'text',
          text: `# ✅ Content Saved to Session (Article #${sessionState.articles.length})

**Title:** ${title}
**Article ID:** ${articleId}
**Word Count:** ${wordCount} words ${targetWordCount ? (wordCountOk ? '✅' : `⚠️ (target: ${targetWordCount})`) : '(no target set)'}
**Meta Description:** ${meta_description ? `${meta_description.length} chars ✅` : '❌ Missing!'}
**Keywords:** ${keywords.join(', ') || 'none specified'}
**Images:** ${newArticle.imageUrl ? '1 cover' : 'no cover'}${newArticle.inlineImages.length > 0 ? ` + ${newArticle.inlineImages.length} inline` : ''}

${targetWordCount && !wordCountOk ? `⚠️ **Warning:** Article is ${targetWordCount - wordCount} words short of the ${targetWordCount} word target.\n` : ''}
${!meta_description ? '⚠️ **Warning:** Meta description is missing. Add it for better SEO.\n' : ''}
${articlesListSection}${categoriesSection}
## Next Step${includeImages && imageStep ? ': Generate Images' : ': Ready to Publish or Continue'}
${includeImages && imageStep ? `Generate **${totalImages} images** (1 cover + ${totalImages - 1} inline images).

Call \`generate_image\` ${totalImages} times with prompts based on your article sections.` : `You can:
- **Add more articles**: Continue creating content (each save_content adds to the batch)
- **Publish all**: Call \`publish_content\` to publish all ${sessionState.articles.length} article(s)
- **View session**: Call \`get_session\` to see all saved articles`}`
        }]
      }
    }

    case 'publish_content': {
      const { platforms = ['all'], status = 'draft', category = '', article_numbers = [] } = args

      // Determine which articles to publish
      let articlesToPublish = []

      if (article_numbers && article_numbers.length > 0) {
        // Publish specific articles by number (1-indexed)
        articlesToPublish = article_numbers
          .map(num => sessionState.articles[num - 1])
          .filter(art => art && !art.published)

        if (articlesToPublish.length === 0) {
          return {
            content: [{
              type: 'text',
              text: `❌ No valid unpublished articles found for numbers: ${article_numbers.join(', ')}

Use \`get_session\` to see available articles and their numbers.`
            }]
          }
        }
      } else {
        // Publish all unpublished articles
        articlesToPublish = sessionState.articles.filter(art => !art.published)
      }

      // Fallback: Check if there's a current working article not yet saved
      if (articlesToPublish.length === 0 && sessionState.article && sessionState.title) {
        // Create temporary article from current working state for backwards compatibility
        articlesToPublish = [{
          id: 'current',
          title: sessionState.title,
          content: sessionState.article,
          keywords: sessionState.keywords || [],
          metaDescription: sessionState.metaDescription || '',
          imageUrl: sessionState.imageUrl,
          inlineImages: sessionState.inlineImages
        }]
      }

      if (articlesToPublish.length === 0) {
        return {
          content: [{
            type: 'text',
            text: `❌ No unpublished articles found in session.

Use \`save_content\` after writing an article, then call \`publish_content\`.
Or use \`get_session\` to see current session state.`
          }]
        }
      }

      const hasGhost = hasCredential('ghost')
      const hasWordPress = hasCredential('wordpress')
      const shouldPublishGhost = hasGhost && (platforms.includes('all') || platforms.includes('ghost'))
      const shouldPublishWordPress = hasWordPress && (platforms.includes('all') || platforms.includes('wordpress'))

      // Results for all articles
      const allResults = []

      progress('Publishing', `Starting batch publish of ${articlesToPublish.length} article(s)`)

      // Publish each article
      for (let i = 0; i < articlesToPublish.length; i++) {
        const article = articlesToPublish[i]
        progress('Publishing', `Article ${i + 1}/${articlesToPublish.length}: "${article.title}"`)

        // Inject inline images into content (replace [IMAGE: ...] placeholders)
        let contentWithImages = article.content
        let imageIndex = 0
        const articleInlineImages = article.inlineImages || []
        contentWithImages = contentWithImages.replace(/\[IMAGE:\s*([^\]]+)\]/gi, (match, description) => {
          if (imageIndex < articleInlineImages.length) {
            const imgUrl = articleInlineImages[imageIndex]
            imageIndex++
            return `![${description.trim()}](${imgUrl})`
          }
          return match // Keep placeholder if no image available
        })

        const articleResults = {
          article: article.title,
          articleId: article.id,
          wordCount: article.wordCount || contentWithImages.split(/\s+/).length,
          platforms: []
        }

        // Publish to Ghost
        if (shouldPublishGhost) {
          try {
            const ghostResult = await executeGhostPublish({
              title: article.title,
              content: contentWithImages,
              status: status,
              tags: article.keywords || [],
              featured_image_url: article.imageUrl
            })
            articleResults.platforms.push({ platform: 'Ghost', success: true, result: ghostResult })
          } catch (e) {
            articleResults.platforms.push({ platform: 'Ghost', success: false, error: e.message })
          }
        }

        // Publish to WordPress
        if (shouldPublishWordPress) {
          try {
            const categories = category ? [category] : []
            const wpResult = await executeWordPressPublish({
              title: article.title,
              content: contentWithImages,
              status: status,
              categories: categories,
              tags: article.keywords || [],
              featured_image_url: article.imageUrl
            })
            articleResults.platforms.push({ platform: 'WordPress', success: true, result: wpResult })
          } catch (e) {
            articleResults.platforms.push({ platform: 'WordPress', success: false, error: e.message })
          }
        }

        // Mark article as published if at least one platform succeeded
        const hasSuccess = articleResults.platforms.some(p => p.success)
        if (hasSuccess && article.id !== 'current') {
          const articleIndex = sessionState.articles.findIndex(a => a.id === article.id)
          if (articleIndex !== -1) {
            sessionState.articles[articleIndex].published = true
            sessionState.articles[articleIndex].publishedTo = articleResults.platforms
              .filter(p => p.success)
              .map(p => p.platform.toLowerCase())
            sessionState.articles[articleIndex].publishedAt = new Date().toISOString()
          }
        }

        allResults.push(articleResults)
      }

      // Save updated session state (with published flags)
      saveSession()

      // Build response
      const totalArticles = allResults.length
      const successfulArticles = allResults.filter(r => r.platforms.some(p => p.success)).length
      const totalWords = allResults.reduce((sum, r) => sum + r.wordCount, 0)

      let response = `# 📤 Batch Publishing Results

## Summary
- **Articles Published:** ${successfulArticles}/${totalArticles}
- **Total Words:** ${totalWords.toLocaleString()}
- **Status:** ${status}
- **Platforms:** ${[shouldPublishGhost ? 'Ghost' : null, shouldPublishWordPress ? 'WordPress' : null].filter(Boolean).join(', ') || 'None'}
${category ? `- **Category:** ${category}` : ''}

---

`

      // Detail for each article
      for (const result of allResults) {
        const hasAnySuccess = result.platforms.some(p => p.success)
        response += `## ${hasAnySuccess ? '✅' : '❌'} ${result.article}\n`
        response += `**Words:** ${result.wordCount}\n\n`

        for (const p of result.platforms) {
          if (p.success) {
            response += `**${p.platform}:** ✅ Published\n`
            // Extract URL if available
            const resultText = p.result?.content?.[0]?.text || ''
            const urlMatch = resultText.match(/https?:\/\/[^\s\)]+/)
            if (urlMatch) {
              response += `URL: ${urlMatch[0]}\n`
            }
          } else {
            response += `**${p.platform}:** ❌ ${p.error}\n`
          }
        }
        response += '\n'
      }

      // Show remaining unpublished articles
      const remainingUnpublished = sessionState.articles.filter(a => !a.published)
      if (remainingUnpublished.length > 0) {
        response += `---\n\n**📝 ${remainingUnpublished.length} article(s) still unpublished** in session.\n`
        response += `Call \`publish_content\` again to publish remaining, or \`get_session\` to see details.\n`
      } else if (sessionState.articles.length > 0) {
        response += `---\n\n✅ **All ${sessionState.articles.length} articles published!**\n`
        response += `Session retained for reference. Start a new workflow to clear.\n`
      }

      return {
        content: [{
          type: 'text',
          text: response
        }]
      }
    }

    case 'get_session': {
      const totalImagesNeeded = sessionState.currentWorkflow?.settings?.total_images || 0
      const imagesGenerated = (sessionState.imageUrl ? 1 : 0) + sessionState.inlineImages.length
      const workflow = sessionState.currentWorkflow

      // Count totals across all articles
      const totalArticles = sessionState.articles.length
      const unpublishedArticles = sessionState.articles.filter(a => !a.published)
      const publishedArticles = sessionState.articles.filter(a => a.published)
      const totalWords = sessionState.articles.reduce((sum, a) => sum + (a.wordCount || 0), 0)
      const totalImages = sessionState.articles.reduce((sum, a) => {
        return sum + (a.imageUrl ? 1 : 0) + (a.inlineImages?.length || 0)
      }, 0)

      // Build articles list
      const articlesSection = sessionState.articles.length > 0 ? `
## 📚 Saved Articles (${totalArticles} total)

| # | Title | Words | Images | Status |
|---|-------|-------|--------|--------|
${sessionState.articles.map((art, i) => {
  const imgCount = (art.imageUrl ? 1 : 0) + (art.inlineImages?.length || 0)
  const status = art.published ? `✅ ${art.publishedTo.join(', ')}` : '📝 Unpublished'
  return `| ${i + 1} | ${art.title.substring(0, 40)}${art.title.length > 40 ? '...' : ''} | ${art.wordCount} | ${imgCount} | ${status} |`
}).join('\n')}

**Summary:** ${totalWords.toLocaleString()} total words, ${totalImages} total images
**Unpublished:** ${unpublishedArticles.length} article(s) ready to publish
` : `
## 📚 Saved Articles
No articles saved yet. Use \`save_content\` after writing an article.
`

      // Current working article (if any in progress)
      const currentWorkingSection = sessionState.title && sessionState.article ? `
## 🖊️ Current Working Article
**Title:** ${sessionState.title}
**Word Count:** ${sessionState.article.split(/\s+/).length} words
**Meta Description:** ${sessionState.metaDescription || 'Not set'}
**Cover Image:** ${sessionState.imageUrl ? '✅ Generated' : '❌ Not yet'}
**Inline Images:** ${sessionState.inlineImages.length}

*This article is being edited. Call \`save_content\` to add it to the session.*
` : ''

      return {
        content: [{
          type: 'text',
          text: `# 📋 Session State

**Workflow:** ${workflow?.workflow_id || 'None active'}
**Total Articles:** ${totalArticles}
**Ready to Publish:** ${unpublishedArticles.length}
**Already Published:** ${publishedArticles.length}
${articlesSection}${currentWorkingSection}
## 🖼️ Current Working Images (${imagesGenerated}/${totalImagesNeeded})
**Cover Image:** ${sessionState.imageUrl || 'Not generated'}
**Inline Images:** ${sessionState.inlineImages.length > 0 ? sessionState.inlineImages.map((url, i) => `\n  ${i+1}. ${url.substring(0, 60)}...`).join('') : 'None'}

${workflow ? `
## ⚙️ Project Settings
- **Project:** ${workflow.project_info?.name || 'Unknown'}
- **Niche:** ${workflow.project_info?.niche || 'Unknown'}
- **Word Count Target:** ${workflow.settings?.target_word_count || 'Not set'}
- **Reading Level:** ${workflow.settings?.reading_level_display || 'Not set'}
- **Brand Voice:** ${workflow.settings?.brand_voice || 'Not set'}
- **Include Images:** ${workflow.settings?.include_images ? 'Yes' : 'No'}
` : ''}
## 🚀 Actions
- **Publish all unpublished:** Call \`publish_content\`
- **Add more articles:** Use \`create_content\` or \`content_write\` then \`save_content\`
- **Remove articles:** Call \`remove_article\` with article numbers
- **Clear session:** Call \`clear_session\` with confirm: true`
        }]
      }
    }

    case 'remove_article': {
      const { article_numbers } = args

      if (!article_numbers || article_numbers.length === 0) {
        return {
          content: [{
            type: 'text',
            text: `❌ Please specify article numbers to remove. Use \`get_session\` to see article numbers.`
          }]
        }
      }

      // Sort in descending order to avoid index shifting issues
      const sortedNumbers = [...article_numbers].sort((a, b) => b - a)
      const removed = []
      const skipped = []

      for (const num of sortedNumbers) {
        const index = num - 1
        if (index < 0 || index >= sessionState.articles.length) {
          skipped.push({ num, reason: 'not found' })
          continue
        }

        const article = sessionState.articles[index]
        if (article.published) {
          skipped.push({ num, reason: 'already published', title: article.title })
          continue
        }

        // Remove the article
        const [removedArticle] = sessionState.articles.splice(index, 1)
        removed.push({ num, title: removedArticle.title })
      }

      // Save session
      saveSession()

      let response = `# 🗑️ Article Removal Results\n\n`

      if (removed.length > 0) {
        response += `## ✅ Removed (${removed.length})\n`
        for (const r of removed) {
          response += `- #${r.num}: "${r.title}"\n`
        }
        response += '\n'
      }

      if (skipped.length > 0) {
        response += `## ⚠️ Skipped (${skipped.length})\n`
        for (const s of skipped) {
          if (s.reason === 'already published') {
            response += `- #${s.num}: "${s.title}" (already published - cannot remove)\n`
          } else {
            response += `- #${s.num}: not found\n`
          }
        }
        response += '\n'
      }

      response += `---\n\n**${sessionState.articles.length} article(s) remaining in session.**`

      return {
        content: [{
          type: 'text',
          text: response
        }]
      }
    }

    case 'clear_session': {
      const { confirm } = args

      if (!confirm) {
        return {
          content: [{
            type: 'text',
            text: `⚠️ **Clear Session requires confirmation**

This will permanently remove:
- ${sessionState.articles.length} saved article(s)
- All generated images
- Current workflow state

To confirm, call \`clear_session\` with \`confirm: true\``
          }]
        }
      }

      const articleCount = sessionState.articles.length
      const unpublishedCount = sessionState.articles.filter(a => !a.published).length

      // Clear everything
      resetSession()

      return {
        content: [{
          type: 'text',
          text: `# ✅ Session Cleared

Removed:
- ${articleCount} article(s) (${unpublishedCount} unpublished)
- All workflow state
- All generated images

Session is now empty. Ready for new content creation.`
        }]
      }
    }

    case 'list_content': {
      const { limit = 20 } = args
      const contentDir = getContentDir()

      if (!fs.existsSync(contentDir)) {
        return {
          content: [{
            type: 'text',
            text: `# 📂 Saved Content

No content directory found at \`${contentDir}\`.

Save articles using \`save_content\` and they will appear here.`
          }]
        }
      }

      // Get all content folders
      const folders = fs.readdirSync(contentDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => {
          const folderPath = path.join(contentDir, dirent.name)
          const metadataPath = path.join(folderPath, 'metadata.json')

          let metadata = null
          if (fs.existsSync(metadataPath)) {
            try {
              metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'))
            } catch (e) {
              // Ignore parse errors
            }
          }

          return {
            name: dirent.name,
            path: folderPath,
            metadata,
            mtime: fs.statSync(folderPath).mtime
          }
        })
        .sort((a, b) => b.mtime - a.mtime) // Most recent first
        .slice(0, limit)

      if (folders.length === 0) {
        return {
          content: [{
            type: 'text',
            text: `# 📂 Saved Content

No saved articles found in \`${contentDir}\`.

Save articles using \`save_content\` and they will appear here.`
          }]
        }
      }

      let response = `# 📂 Saved Content (${folders.length} articles)

| # | Date | Title | Words | Project |
|---|------|-------|-------|---------|
`
      folders.forEach((folder, i) => {
        const date = folder.name.split('-').slice(0, 3).join('-')
        const title = folder.metadata?.title || folder.name.split('-').slice(3).join('-')
        const words = folder.metadata?.wordCount || '?'
        const project = folder.metadata?.projectSlug || '-'
        response += `| ${i + 1} | ${date} | ${title.substring(0, 35)}${title.length > 35 ? '...' : ''} | ${words} | ${project} |\n`
      })

      response += `
---

## To Load an Article

Call \`load_content\` with the folder name:
\`\`\`
load_content({ folder_name: "${folders[0]?.name}" })
\`\`\`

Once loaded, you can run optimization tools:
- \`quality_check\` - Pre-publish quality assurance
- \`geo_optimize\` - AI search engine optimization
- \`internal_links\` - Internal linking suggestions
- \`schema_generate\` - JSON-LD structured data
- \`save_content\` - Re-save with changes
- \`publish_content\` - Publish to CMS`

      return {
        content: [{
          type: 'text',
          text: response
        }]
      }
    }

    case 'load_content': {
      const { folder_name } = args

      if (!folder_name) {
        return {
          content: [{
            type: 'text',
            text: `❌ Please specify a folder_name. Use \`list_content\` to see available articles.`
          }]
        }
      }

      const contentDir = getContentDir()
      const folderPath = path.join(contentDir, folder_name)

      if (!fs.existsSync(folderPath)) {
        return {
          content: [{
            type: 'text',
            text: `❌ Folder not found: \`${folder_name}\`

Use \`list_content\` to see available articles.`
          }]
        }
      }

      // Load article and metadata
      const articlePath = path.join(folderPath, 'article.md')
      const metadataPath = path.join(folderPath, 'metadata.json')

      if (!fs.existsSync(articlePath)) {
        return {
          content: [{
            type: 'text',
            text: `❌ No article.md found in \`${folder_name}\``
          }]
        }
      }

      const articleContent = fs.readFileSync(articlePath, 'utf-8')
      let metadata = {}
      if (fs.existsSync(metadataPath)) {
        try {
          metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'))
        } catch (e) {
          log(`Warning: Failed to parse metadata.json: ${e.message}`)
        }
      }

      // Load into session state
      sessionState.title = metadata.title || folder_name
      sessionState.article = articleContent
      sessionState.keywords = metadata.keywords || []
      sessionState.metaDescription = metadata.metaDescription || ''
      sessionState.metaTitle = metadata.metaTitle || metadata.title || folder_name
      sessionState.imageUrl = metadata.imageUrl || null
      sessionState.inlineImages = metadata.inlineImages || []
      sessionState.contentFolder = folderPath

      // Also add to articles array if not already there
      const existingIndex = sessionState.articles.findIndex(a => a.title === sessionState.title)
      if (existingIndex === -1) {
        const loadedArticle = {
          id: generateArticleId(),
          title: sessionState.title,
          content: articleContent,
          keywords: sessionState.keywords,
          metaDescription: sessionState.metaDescription,
          metaTitle: sessionState.metaTitle,
          imageUrl: sessionState.imageUrl,
          inlineImages: sessionState.inlineImages,
          savedAt: metadata.createdAt || new Date().toISOString(),
          published: false,
          publishedTo: [],
          wordCount: articleContent.split(/\s+/).length,
          loadedFrom: folderPath
        }
        sessionState.articles.push(loadedArticle)
      }

      // Save session
      saveSession()

      const wordCount = articleContent.split(/\s+/).length
      progress('Content', `Loaded "${sessionState.title}" (${wordCount} words) from ${folder_name}`)

      return {
        content: [{
          type: 'text',
          text: `# ✅ Content Loaded

**Title:** ${sessionState.title}
**Word Count:** ${wordCount}
**Keywords:** ${sessionState.keywords.join(', ') || 'None'}
**Meta Description:** ${sessionState.metaDescription ? `${sessionState.metaDescription.length} chars` : 'None'}
**Cover Image:** ${sessionState.imageUrl ? '✅' : '❌'}
**Inline Images:** ${sessionState.inlineImages.length}
**Source:** \`${folderPath}\`

---

## Now you can run optimization tools:

- **\`quality_check\`** - Pre-publish quality assurance
- **\`geo_optimize\`** - Optimize for AI search engines (ChatGPT, Perplexity)
- **\`internal_links\`** - Get internal linking suggestions
- **\`schema_generate\`** - Generate JSON-LD structured data
- **\`save_content\`** - Re-save after making changes
- **\`publish_content\`** - Publish to WordPress/Ghost

Article is now in session (#${sessionState.articles.length}) and ready for further processing.`
        }]
      }
    }

    default:
      throw new Error(`Unknown orchestrator tool: ${toolName}`)
  }
}

/**
 * Execute an action tool locally using credentials
 */
async function executeActionTool(toolName, args) {
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

/**
 * Generate image using configured provider
 */
async function executeImageGeneration(args) {
  const provider = localCredentials.image_provider
  const config = localCredentials[provider]

  if (!config?.api_key) {
    throw new Error(`${provider} API key not configured`)
  }

  progress('Image', `Generating with ${provider}...`)

  const { prompt, style, aspect_ratio = '16:9' } = args
  const fullPrompt = style ? `${prompt}, ${style}` : prompt

  log(`Generating image with ${provider}: ${fullPrompt.substring(0, 50)}...`)

  switch (provider) {
    case 'fal': {
      // fal.ai Nano Banana Pro (gemini-3-pro-image)
      const response = await fetchWithRetry('https://fal.run/fal-ai/nano-banana-pro', {
        method: 'POST',
        headers: {
          'Authorization': `Key ${config.api_key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt: fullPrompt,
          aspect_ratio: aspect_ratio,
          output_format: 'png',
          resolution: '1K',
          num_images: 1
        })
      }, 2, 60000) // 2 retries, 60s timeout for image generation

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`fal.ai error: ${error}`)
      }

      const result = await response.json()
      const imageUrl = result.images?.[0]?.url

      // Store in session for orchestrated workflows
      // First image is cover, subsequent are inline
      if (!sessionState.imageUrl) {
        sessionState.imageUrl = imageUrl
      } else {
        sessionState.inlineImages.push(imageUrl)
      }

      // Persist session to file
      saveSession()

      const imageNumber = 1 + sessionState.inlineImages.length
      const totalImages = sessionState.currentWorkflow?.settings?.total_images || 1
      const imageType = imageNumber === 1 ? 'Cover Image' : `Inline Image ${imageNumber - 1}`

      return {
        content: [{
          type: 'text',
          text: `# ✅ ${imageType} Generated (${imageNumber}/${totalImages})

**URL:** ${imageUrl}

**Prompt:** ${fullPrompt}
**Provider:** fal.ai (nano-banana-pro)
**Aspect Ratio:** ${aspect_ratio}

${imageNumber < totalImages ? `\n**Next:** Generate ${totalImages - imageNumber} more image(s).` : '\n**All images generated!** Proceed to publish.'}`
        }]
      }
    }

    case 'gemini': {
      // Google Gemini 3 Pro Image (Nano Banana Pro) - generateContent API
      const model = config.model || 'gemini-3-pro-image-preview'
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': config.api_key
          },
          body: JSON.stringify({
            contents: [{
              parts: [{ text: fullPrompt }]
            }],
            generationConfig: {
              responseModalities: ['IMAGE'],
              imageConfig: {
                aspectRatio: aspect_ratio,
                imageSize: '1K'
              }
            }
          })
        }
      )

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`Gemini error: ${error}`)
      }

      const result = await response.json()
      const imagePart = result.candidates?.[0]?.content?.parts?.find(p => p.inlineData)
      const imageData = imagePart?.inlineData?.data
      const mimeType = imagePart?.inlineData?.mimeType || 'image/png'

      if (!imageData) {
        throw new Error('No image data in Gemini response')
      }

      // Return base64 data URI
      const dataUri = `data:${mimeType};base64,${imageData}`

      return {
        content: [{
          type: 'text',
          text: `Image generated successfully!\n\n**Format:** Base64 Data URI\n**Prompt:** ${fullPrompt}\n**Provider:** Google Gemini (${model})\n**Aspect Ratio:** ${aspect_ratio}\n\n**Data URI:** ${dataUri.substring(0, 100)}...\n\n[Full base64 data: ${imageData.length} chars]`
        }]
      }
    }

    case 'wiro': {
      // wiro.ai API with HMAC signature authentication
      const crypto = await import('crypto')
      const apiKey = config.api_key
      const apiSecret = config.api_secret

      if (!apiSecret) {
        throw new Error('Wiro API secret not configured. Add api_secret to wiro config in ~/.suparank/credentials.json')
      }

      // Generate nonce and signature
      const nonce = Math.floor(Date.now() / 1000).toString()
      const signatureData = `${apiSecret}${nonce}`
      const signature = crypto.createHmac('sha256', apiKey)
        .update(signatureData)
        .digest('hex')

      const model = config.model || 'google/nano-banana-pro'

      // Submit task
      log(`Submitting wiro.ai task for model: ${model}`)
      const submitResponse = await fetch(`https://api.wiro.ai/v1/Run/${model}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-nonce': nonce,
          'x-signature': signature
        },
        body: JSON.stringify({
          prompt: fullPrompt,
          aspectRatio: aspect_ratio,
          resolution: '1K',
          safetySetting: 'BLOCK_ONLY_HIGH'
        })
      })

      if (!submitResponse.ok) {
        const error = await submitResponse.text()
        throw new Error(`wiro.ai submit error: ${error}`)
      }

      const submitResult = await submitResponse.json()
      if (!submitResult.result || !submitResult.taskid) {
        throw new Error(`wiro.ai task submission failed: ${JSON.stringify(submitResult.errors)}`)
      }

      const taskId = submitResult.taskid
      log(`wiro.ai task submitted: ${taskId}`)

      // Poll for completion
      const maxAttempts = 60 // 60 seconds max
      const pollInterval = 2000 // 2 seconds

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise(resolve => setTimeout(resolve, pollInterval))

        // Generate new signature for poll request
        const pollNonce = Math.floor(Date.now() / 1000).toString()
        const pollSignatureData = `${apiSecret}${pollNonce}`
        const pollSignature = crypto.createHmac('sha256', apiKey)
          .update(pollSignatureData)
          .digest('hex')

        const pollResponse = await fetch('https://api.wiro.ai/v1/Task/Detail', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'x-nonce': pollNonce,
            'x-signature': pollSignature
          },
          body: JSON.stringify({ taskid: taskId })
        })

        if (!pollResponse.ok) {
          log(`wiro.ai poll error: ${await pollResponse.text()}`)
          continue
        }

        const pollResult = await pollResponse.json()
        const task = pollResult.tasklist?.[0]

        if (!task) continue

        const status = task.status
        log(`wiro.ai task status: ${status}`)

        // Check for completion
        if (status === 'task_postprocess_end') {
          const imageUrl = task.outputs?.[0]?.url
          if (!imageUrl) {
            throw new Error('wiro.ai task completed but no output URL')
          }

          // Store in session for orchestrated workflows
          // First image is cover, subsequent are inline
          if (!sessionState.imageUrl) {
            sessionState.imageUrl = imageUrl
          } else {
            sessionState.inlineImages.push(imageUrl)
          }

          // Persist session to file
          saveSession()

          const imageNumber = 1 + sessionState.inlineImages.length
          const totalImages = sessionState.currentWorkflow?.settings?.total_images || 1
          const imageType = imageNumber === 1 ? 'Cover Image' : `Inline Image ${imageNumber - 1}`

          return {
            content: [{
              type: 'text',
              text: `# ✅ ${imageType} Generated (${imageNumber}/${totalImages})

**URL:** ${imageUrl}

**Prompt:** ${fullPrompt}
**Provider:** wiro.ai (${model})
**Aspect Ratio:** ${aspect_ratio}
**Processing Time:** ${task.elapsedseconds}s

${imageNumber < totalImages ? `\n**Next:** Generate ${totalImages - imageNumber} more image(s).` : '\n**All images generated!** Proceed to publish.'}`
            }]
          }
        }

        // Check for failure
        if (status === 'task_cancel') {
          throw new Error('wiro.ai task was cancelled')
        }
      }

      throw new Error('wiro.ai task timed out after 60 seconds')
    }

    default:
      throw new Error(`Unknown image provider: ${provider}`)
  }
}

/**
 * Convert aspect ratio string to fal.ai image size
 */
function aspectRatioToSize(ratio) {
  const sizes = {
    '1:1': 'square',
    '16:9': 'landscape_16_9',
    '9:16': 'portrait_16_9',
    '4:3': 'landscape_4_3',
    '3:4': 'portrait_4_3'
  }
  return sizes[ratio] || 'landscape_16_9'
}

/**
 * Convert markdown to HTML using marked library
 * Configured for WordPress/Ghost CMS compatibility
 */
function markdownToHtml(markdown) {
  // Configure marked for CMS compatibility
  marked.setOptions({
    gfm: true,        // GitHub Flavored Markdown
    breaks: true,     // Convert line breaks to <br>
    pedantic: false,
    silent: true      // Don't throw on errors
  })

  try {
    return marked.parse(markdown)
  } catch (error) {
    log(`Markdown conversion error: ${error.message}`)
    // Fallback: return markdown wrapped in <p> tags
    return `<p>${markdown.replace(/\n\n+/g, '</p><p>')}</p>`
  }
}

/**
 * Fetch available categories from WordPress
 */
async function fetchWordPressCategories() {
  const wpConfig = localCredentials?.wordpress
  if (!wpConfig?.secret_key || !wpConfig?.site_url) {
    return null
  }

  try {
    log('Fetching WordPress categories...')

    // Try new Suparank endpoint first, then fall back to legacy
    const endpoints = [
      { url: `${wpConfig.site_url}/wp-json/suparank/v1/categories`, header: 'X-Suparank-Key' },
      { url: `${wpConfig.site_url}/wp-json/writer-mcp/v1/categories`, header: 'X-Writer-MCP-Key' }
    ]

    for (const endpoint of endpoints) {
      try {
        const response = await fetchWithTimeout(endpoint.url, {
          method: 'GET',
          headers: {
            [endpoint.header]: wpConfig.secret_key
          }
        }, 10000) // 10s timeout

        if (response.ok) {
          const result = await response.json()
          if (result.success && result.categories) {
            log(`Found ${result.categories.length} WordPress categories`)
            return result.categories
          }
        }
      } catch (e) {
        // Try next endpoint
      }
    }

    log('Failed to fetch categories from any endpoint')
    return null
  } catch (error) {
    log(`Error fetching categories: ${error.message}`)
    return null
  }
}

/**
 * Publish to WordPress using REST API or custom plugin
 */
async function executeWordPressPublish(args) {
  const wpConfig = localCredentials.wordpress
  const { title, content, status = 'draft', categories = [], tags = [], featured_image_url } = args

  progress('Publish', `Publishing to WordPress: "${title}"`)
  log(`Publishing to WordPress: ${title}`)

  // Convert markdown to HTML for WordPress
  const htmlContent = markdownToHtml(content)

  // Method 1: Use Suparank Connector plugin (secret_key auth)
  if (wpConfig.secret_key) {
    log('Using Suparank/Writer MCP Connector plugin')

    // Try new Suparank endpoint first, then fall back to legacy
    const endpoints = [
      { url: `${wpConfig.site_url}/wp-json/suparank/v1/publish`, header: 'X-Suparank-Key' },
      { url: `${wpConfig.site_url}/wp-json/writer-mcp/v1/publish`, header: 'X-Writer-MCP-Key' }
    ]

    const postBody = JSON.stringify({
      title,
      content: htmlContent,
      status,
      categories,
      tags,
      featured_image_url,
      excerpt: sessionState.metaDescription || ''
    })

    let lastError = null
    for (const endpoint of endpoints) {
      try {
        const response = await fetchWithRetry(endpoint.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            [endpoint.header]: wpConfig.secret_key
          },
          body: postBody
        }, 2, 30000) // 2 retries, 30s timeout

        if (response.ok) {
          const result = await response.json()

          if (result.success) {
            const categoriesInfo = result.post.categories?.length
              ? `\n**Categories:** ${result.post.categories.join(', ')}`
              : ''
            const tagsInfo = result.post.tags?.length
              ? `\n**Tags:** ${result.post.tags.join(', ')}`
              : ''
            const imageInfo = result.post.featured_image
              ? `\n**Featured Image:** ✅ Uploaded`
              : ''

            return {
              content: [{
                type: 'text',
                text: `Post published to WordPress!\n\n**Title:** ${result.post.title}\n**Status:** ${result.post.status}\n**URL:** ${result.post.url}\n**Edit:** ${result.post.edit_url}\n**ID:** ${result.post.id}${categoriesInfo}${tagsInfo}${imageInfo}\n\n${status === 'draft' ? 'The post is saved as a draft. Edit and publish from WordPress dashboard.' : 'The post is now live!'}`
              }]
            }
          }
        }
        lastError = await response.text()
      } catch (e) {
        lastError = e.message
      }
    }

    throw new Error(`WordPress error: ${lastError}`)
  }

  // Method 2: Use standard REST API with application password
  if (wpConfig.app_password && wpConfig.username) {
    log('Using WordPress REST API with application password')

    const auth = Buffer.from(`${wpConfig.username}:${wpConfig.app_password}`).toString('base64')
    const postData = {
      title,
      content: htmlContent,
      status,
      categories: [],
      tags: []
    }

    const response = await fetch(`${wpConfig.site_url}/wp-json/wp/v2/posts`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(postData)
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`WordPress error: ${error}`)
    }

    const post = await response.json()

    return {
      content: [{
        type: 'text',
        text: `Post published to WordPress!\n\n**Title:** ${post.title.rendered}\n**Status:** ${post.status}\n**URL:** ${post.link}\n**ID:** ${post.id}\n\n${status === 'draft' ? 'The post is saved as a draft. Edit and publish from WordPress dashboard.' : 'The post is now live!'}`
      }]
    }
  }

  throw new Error('WordPress credentials not configured. Add either secret_key (with plugin) or username + app_password to ~/.suparank/credentials.json')
}

/**
 * Publish to Ghost using Admin API
 */
async function executeGhostPublish(args) {
  const { api_url, admin_api_key } = localCredentials.ghost
  const { title, content, status = 'draft', tags = [], featured_image_url } = args

  progress('Publish', `Publishing to Ghost: "${title}"`)
  log(`Publishing to Ghost: ${title}`)

  // Create JWT for Ghost Admin API
  const [id, secret] = admin_api_key.split(':')
  const token = await createGhostJWT(id, secret)

  // Convert markdown to HTML for proper element separation
  const htmlContent = markdownToHtml(content)

  // Use HTML card for proper rendering (each element separate)
  const mobiledoc = JSON.stringify({
    version: '0.3.1',
    atoms: [],
    cards: [['html', { html: htmlContent }]],
    markups: [],
    sections: [[10, 0]]
  })

  const postData = {
    posts: [{
      title,
      mobiledoc,
      status,
      tags: tags.map(name => ({ name })),
      feature_image: featured_image_url
    }]
  }

  const response = await fetchWithRetry(`${api_url}/ghost/api/admin/posts/`, {
    method: 'POST',
    headers: {
      'Authorization': `Ghost ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(postData)
  }, 2, 30000) // 2 retries, 30s timeout

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Ghost error: ${error}`)
  }

  const result = await response.json()
  const post = result.posts[0]

  return {
    content: [{
      type: 'text',
      text: `Post published to Ghost!\n\n**Title:** ${post.title}\n**Status:** ${post.status}\n**URL:** ${post.url}\n**ID:** ${post.id}\n\n${status === 'draft' ? 'The post is saved as a draft. Edit and publish from Ghost dashboard.' : 'The post is now live!'}`
    }]
  }
}

/**
 * Create JWT for Ghost Admin API
 */
async function createGhostJWT(id, secret) {
  // Simple JWT creation for Ghost
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: id })).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(JSON.stringify({
    iat: now,
    exp: now + 300, // 5 minutes
    aud: '/admin/'
  })).toString('base64url')

  // Create signature using crypto
  const crypto = await import('crypto')
  const key = Buffer.from(secret, 'hex')
  const signature = crypto.createHmac('sha256', key)
    .update(`${header}.${payload}`)
    .digest('base64url')

  return `${header}.${payload}.${signature}`
}

/**
 * Send data to webhook
 */
async function executeSendWebhook(args) {
  const { webhook_type = 'default', payload = {}, message } = args
  const webhooks = localCredentials.webhooks

  // Get webhook URL
  const urlMap = {
    default: webhooks.default_url,
    make: webhooks.make_url,
    n8n: webhooks.n8n_url,
    zapier: webhooks.zapier_url,
    slack: webhooks.slack_url
  }

  const url = urlMap[webhook_type]
  if (!url) {
    throw new Error(`No ${webhook_type} webhook URL configured`)
  }

  log(`Sending webhook to ${webhook_type}: ${url}`)

  // Format payload based on type
  let body
  let headers = { 'Content-Type': 'application/json' }

  if (webhook_type === 'slack') {
    body = JSON.stringify({
      text: message || 'Message from Writer MCP',
      ...payload
    })
  } else {
    body = JSON.stringify({
      source: 'suparank',
      timestamp: new Date().toISOString(),
      project: projectSlug,
      data: payload,
      message
    })
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Webhook error (${response.status}): ${error}`)
  }

  return {
    content: [{
      type: 'text',
      text: `Webhook sent successfully!\n\n**Type:** ${webhook_type}\n**URL:** ${url.substring(0, 50)}...\n**Status:** ${response.status}\n\nThe data has been sent to your ${webhook_type} webhook.`
    }]
  }
}

/**
 * Essential tools shown in the tool list
 * MCP protocol requires tools to be listed for clients to call them
 */
const VISIBLE_TOOLS = [
  // Essential (5) - Main workflow
  'create_content',     // Main entry point - creates & publishes automatically
  'keyword_research',   // Research keywords separately (on-demand)
  'generate_image',     // Generate/regenerate images (on-demand)
  'publish_content',    // Manual publish trigger (on-demand)
  'get_session',        // Check status (on-demand)

  // Session Management (5) - Content lifecycle
  'save_content',       // Save article to session
  'list_content',       // List saved content
  'load_content',       // Load past content into session
  'remove_article',     // Remove article from session
  'clear_session'       // Clear all session content
]

/**
 * Get all available tools based on configured credentials
 * Shows 10 essential tools (instead of 24) for cleaner UX
 */
function getAvailableTools() {
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
 */
function getAllTools() {
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

// Main function
async function main() {
  log(`Starting MCP client for project: ${projectSlug}`)
  log(`API URL: ${apiUrl}`)

  // Load local credentials
  localCredentials = loadLocalCredentials()
  if (localCredentials) {
    const configured = []
    if (hasCredential('wordpress')) configured.push('wordpress')
    if (hasCredential('ghost')) configured.push('ghost')
    if (hasCredential('image')) configured.push(`image:${localCredentials.image_provider}`)
    if (hasCredential('webhooks')) configured.push('webhooks')
    if (localCredentials.external_mcps?.length) {
      configured.push(`mcps:${localCredentials.external_mcps.map(m => m.name).join(',')}`)
    }
    if (configured.length > 0) {
      log(`Configured integrations: ${configured.join(', ')}`)
    }
  }

  // Restore session state from previous run
  if (loadSession()) {
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

// Run
main().catch((error) => {
  log('Fatal error:', error)
  process.exit(1)
})
