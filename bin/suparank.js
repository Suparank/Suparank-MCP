#!/usr/bin/env node

/**
 * Suparank CLI - Interactive Setup and MCP Launcher
 *
 * Usage:
 *   npx suparank              - Run MCP (or setup if first time)
 *   npx suparank setup        - Run setup wizard
 *   npx suparank test         - Test API connection
 *   npx suparank session      - View current session state
 *   npx suparank clear        - Clear session state
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as readline from 'readline'
import { spawn } from 'child_process'

const SUPARANK_DIR = path.join(os.homedir(), '.suparank')
const CONFIG_FILE = path.join(SUPARANK_DIR, 'config.json')
const CREDENTIALS_FILE = path.join(SUPARANK_DIR, 'credentials.json')
const SESSION_FILE = path.join(SUPARANK_DIR, 'session.json')

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
}

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`)
}

function logHeader(message) {
  console.log()
  log(`=== ${message} ===`, 'bright')
  console.log()
}

function ensureDir() {
  if (!fs.existsSync(SUPARANK_DIR)) {
    fs.mkdirSync(SUPARANK_DIR, { recursive: true })
  }
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'))
    }
  } catch (e) {
    // Ignore errors
  }
  return null
}

function saveConfig(config) {
  ensureDir()
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))
}

function loadCredentials() {
  try {
    if (fs.existsSync(CREDENTIALS_FILE)) {
      return JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf-8'))
    }
    // Try legacy .env.superwriter
    const legacyPaths = [
      path.join(os.homedir(), '.env.superwriter'),
      path.join(process.cwd(), '.env.superwriter')
    ]
    for (const legacyPath of legacyPaths) {
      if (fs.existsSync(legacyPath)) {
        return JSON.parse(fs.readFileSync(legacyPath, 'utf-8'))
      }
    }
  } catch (e) {
    // Ignore errors
  }
  return null
}

function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

async function testConnection(apiKey, projectSlug, apiUrl = null) {
  try {
    const url = apiUrl || process.env.SUPARANK_API_URL || 'http://localhost:3000'
    const response = await fetch(`${url}/projects/${projectSlug}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    })

    if (response.ok) {
      const data = await response.json()
      // API returns { project: {...} }
      const project = data.project || data
      return { success: true, project }
    } else {
      const error = await response.text()
      return { success: false, error: `HTTP ${response.status}: ${error}` }
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

async function runSetup() {
  logHeader('Suparank Setup Wizard')

  log('Welcome to Suparank!', 'cyan')
  log('This wizard will help you configure your MCP client.', 'dim')
  console.log()

  // Step 1: Get API key
  log('Step 1: API Key', 'bright')
  log('Get your API key from: https://suparank.io/dashboard/settings/api-keys', 'dim')
  console.log()

  const apiKey = await prompt('Enter your API key: ')
  if (!apiKey) {
    log('API key is required. Exiting.', 'red')
    process.exit(1)
  }

  // Step 2: Get project slug
  console.log()
  log('Step 2: Project', 'bright')
  log('Enter your project slug (from your dashboard URL)', 'dim')
  console.log()

  const projectSlug = await prompt('Enter project slug: ')
  if (!projectSlug) {
    log('Project slug is required. Exiting.', 'red')
    process.exit(1)
  }

  // Step 3: API URL (optional)
  console.log()
  log('Step 3: API URL (optional)', 'bright')
  log('Press Enter for default, or enter custom URL for self-hosted/development', 'dim')
  const defaultUrl = process.env.SUPARANK_API_URL || 'http://localhost:3000'
  console.log()

  const apiUrlInput = await prompt(`API URL [${defaultUrl}]: `)
  const apiUrl = apiUrlInput || defaultUrl

  // Test connection
  console.log()
  log('Testing connection...', 'yellow')

  const result = await testConnection(apiKey, projectSlug, apiUrl)

  if (!result.success) {
    log(`Connection failed: ${result.error}`, 'red')
    log('Please check your API key, project slug, and API URL.', 'dim')
    process.exit(1)
  }

  log(`Connected to project: ${result.project.name}`, 'green')

  // Save config
  const config = {
    api_key: apiKey,
    project_slug: projectSlug,
    api_url: apiUrl,
    created_at: new Date().toISOString()
  }

  saveConfig(config)
  log('Configuration saved!', 'green')

  // Step 3: Optional credentials
  console.log()
  log('Step 3: Local Credentials (optional)', 'bright')
  log('For image generation and CMS publishing, create:', 'dim')
  log(`  ${CREDENTIALS_FILE}`, 'cyan')
  console.log()

  log('Example credentials.json:', 'dim')
  console.log(`{
  "image_provider": "fal",
  "fal": { "api_key": "YOUR_FAL_KEY" },
  "wordpress": {
    "site_url": "https://your-site.com",
    "secret_key": "FROM_PLUGIN_SETTINGS"
  },
  "ghost": {
    "api_url": "https://your-ghost.com",
    "admin_api_key": "YOUR_GHOST_ADMIN_KEY"
  }
}`)

  console.log()
  logHeader('Setup Complete!')

  log('Add Suparank to your AI client:', 'bright')
  console.log()
  log('For Claude Desktop (claude_desktop_config.json):', 'dim')
  console.log(`{
  "mcpServers": {
    "suparank": {
      "command": "npx",
      "args": ["suparank"]
    }
  }
}`)

  console.log()
  log('For Cursor (settings.json):', 'dim')
  console.log(`{
  "mcpServers": {
    "suparank": {
      "command": "npx",
      "args": ["suparank"]
    }
  }
}`)

  console.log()
  log('Commands:', 'bright')
  log('  npx suparank         - Run MCP server', 'dim')
  log('  npx suparank setup   - Run setup again', 'dim')
  log('  npx suparank test    - Test API connection', 'dim')
  log('  npx suparank session - View session state', 'dim')
  log('  npx suparank clear   - Clear session', 'dim')
}

async function runTest() {
  logHeader('Testing Connection')

  const config = loadConfig()
  if (!config) {
    log('No configuration found. Run: npx suparank setup', 'red')
    process.exit(1)
  }

  log(`Project: ${config.project_slug}`, 'dim')
  log(`API URL: ${config.api_url}`, 'dim')
  console.log()

  log('Testing...', 'yellow')
  const result = await testConnection(config.api_key, config.project_slug, config.api_url)

  if (result.success) {
    log(`Success! Connected to: ${result.project.name}`, 'green')

    // Check credentials
    const creds = loadCredentials()
    if (creds) {
      const configured = []
      if (creds.wordpress?.secret_key) configured.push('WordPress')
      if (creds.ghost?.admin_api_key) configured.push('Ghost')
      if (creds[creds.image_provider]?.api_key) configured.push(`Images (${creds.image_provider})`)

      if (configured.length > 0) {
        log(`Local integrations: ${configured.join(', ')}`, 'green')
      }
    } else {
      log('No local credentials configured (optional)', 'dim')
    }
  } else {
    log(`Connection failed: ${result.error}`, 'red')
  }
}

function viewSession() {
  logHeader('Session State')

  try {
    if (fs.existsSync(SESSION_FILE)) {
      const session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'))

      if (session.title) {
        log(`Title: ${session.title}`, 'green')
        log(`Words: ${session.article?.split(/\s+/).length || 0}`, 'dim')
      }

      if (session.imageUrl) {
        log(`Cover Image: ${session.imageUrl.substring(0, 60)}...`, 'cyan')
      }

      if (session.inlineImages?.length > 0) {
        log(`Inline Images: ${session.inlineImages.length}`, 'cyan')
      }

      if (session.currentWorkflow) {
        log(`Workflow: ${session.currentWorkflow.workflow_id}`, 'yellow')
      }

      log(`Saved: ${session.savedAt}`, 'dim')
    } else {
      log('No active session', 'dim')
    }
  } catch (e) {
    log(`Error reading session: ${e.message}`, 'red')
  }
}

function clearSession() {
  logHeader('Clear Session')

  try {
    if (fs.existsSync(SESSION_FILE)) {
      fs.unlinkSync(SESSION_FILE)
      log('Session cleared!', 'green')
    } else {
      log('No session to clear', 'dim')
    }
  } catch (e) {
    log(`Error clearing session: ${e.message}`, 'red')
  }
}

function runMCP() {
  const config = loadConfig()

  if (!config) {
    log('No configuration found. Running setup...', 'yellow')
    console.log()
    runSetup()
    return
  }

  // Find the MCP client script (modular version)
  const mcpClientPaths = [
    path.join(import.meta.dirname, '..', 'mcp-client', 'index.js'),
    path.join(process.cwd(), 'mcp-client', 'index.js'),
    // Legacy fallback
    path.join(import.meta.dirname, '..', 'mcp-client.js'),
    path.join(process.cwd(), 'mcp-client.js')
  ]

  let mcpClientPath = null
  for (const p of mcpClientPaths) {
    if (fs.existsSync(p)) {
      mcpClientPath = p
      break
    }
  }

  if (!mcpClientPath) {
    log('Error: mcp-client not found', 'red')
    process.exit(1)
  }

  // Launch MCP client with config
  const child = spawn('node', [mcpClientPath, config.project_slug, config.api_key], {
    stdio: 'inherit',
    env: {
      ...process.env,
      SUPARANK_API_URL: config.api_url
    }
  })

  child.on('error', (err) => {
    console.error('Failed to start MCP client:', err.message)
    process.exit(1)
  })

  child.on('exit', (code) => {
    process.exit(code || 0)
  })
}

// Main entry point
const command = process.argv[2]

switch (command) {
  case 'setup':
    runSetup()
    break
  case 'test':
    runTest()
    break
  case 'session':
    viewSession()
    break
  case 'clear':
    clearSession()
    break
  case 'help':
  case '--help':
  case '-h':
    logHeader('Suparank CLI')
    log('Usage: npx suparank [command]', 'dim')
    console.log()
    log('Commands:', 'bright')
    log('  (none)     Run MCP server (default)', 'dim')
    log('  setup      Run setup wizard', 'dim')
    log('  test       Test API connection', 'dim')
    log('  session    View current session state', 'dim')
    log('  clear      Clear session state', 'dim')
    log('  help       Show this help message', 'dim')
    break
  default:
    runMCP()
}
