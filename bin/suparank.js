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
import { spawn, execSync, exec } from 'child_process'
import { fileURLToPath } from 'url'

const SUPARANK_DIR = path.join(os.homedir(), '.suparank')
const VERSION_CACHE_FILE = path.join(SUPARANK_DIR, '.version-check')

// Get current package version
function getCurrentVersion() {
  try {
    const packagePath = path.join(import.meta.dirname, '..', 'package.json')
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'))
    return pkg.version
  } catch {
    return null
  }
}

// Check for updates (non-blocking, cached for 1 hour)
async function checkForUpdates() {
  const currentVersion = getCurrentVersion()
  if (!currentVersion) return

  // Check cache to avoid spamming npm registry
  try {
    if (fs.existsSync(VERSION_CACHE_FILE)) {
      const cache = JSON.parse(fs.readFileSync(VERSION_CACHE_FILE, 'utf-8'))
      const cacheAge = Date.now() - cache.timestamp
      if (cacheAge < 3600000) { // 1 hour cache
        if (cache.latest !== currentVersion && cache.latest > currentVersion) {
          console.error(`[suparank] Update available: ${currentVersion} → ${cache.latest}`)
        }
        return
      }
    }
  } catch {}

  // Fetch latest version from npm (with timeout)
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000) // 3 second timeout

    const response = await fetch('https://registry.npmjs.org/suparank/latest', {
      signal: controller.signal
    })
    clearTimeout(timeout)

    if (response.ok) {
      const data = await response.json()
      const latestVersion = data.version

      // Cache the result
      fs.mkdirSync(SUPARANK_DIR, { recursive: true })
      fs.writeFileSync(VERSION_CACHE_FILE, JSON.stringify({
        latest: latestVersion,
        current: currentVersion,
        timestamp: Date.now()
      }))

      if (latestVersion !== currentVersion && latestVersion > currentVersion) {
        console.error(`[suparank] Update available: ${currentVersion} → ${latestVersion}`)
        console.error('[suparank] Run: npx suparank@latest OR npx clear-npx-cache')
      }
    }
  } catch {
    // Silently fail - don't block MCP startup
  }
}

const CONFIG_FILE = path.join(SUPARANK_DIR, 'config.json')
const CREDENTIALS_FILE = path.join(SUPARANK_DIR, 'credentials.json')
const SESSION_FILE = path.join(SUPARANK_DIR, 'session.json')

// Colors for terminal output (only used in interactive commands)
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

// Check if running in MCP mode (no command argument = MCP server)
const isMCPMode = !process.argv[2] || !['setup', 'test', 'session', 'clear', 'update', 'version', '-v', '--version', 'help', '--help', '-h'].includes(process.argv[2])

function log(message, color = 'reset') {
  // In MCP mode, use stderr to avoid breaking JSON protocol
  // In interactive mode (setup, test, etc), use stdout for user-friendly output
  if (isMCPMode) {
    console.error(`[suparank] ${message}`)
  } else {
    console.log(`${colors[color]}${message}${colors.reset}`)
  }
}

function logHeader(message) {
  if (isMCPMode) {
    console.error(`[suparank] === ${message} ===`)
  } else {
    console.log()
    log(`=== ${message} ===`, 'bright')
    console.log()
  }
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

const SUPARANK_API_URL = 'https://api.suparank.io'

async function testConnection(apiKey, projectSlug) {
  try {
    const response = await fetch(`${SUPARANK_API_URL}/projects/${projectSlug}`, {
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

// Helper to sleep for a given number of milliseconds
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Helper to open URL in browser
function openBrowser(url) {
  const platform = process.platform

  let command
  if (platform === 'darwin') {
    command = `open "${url}"`
  } else if (platform === 'win32') {
    command = `start "" "${url}"`
  } else {
    command = `xdg-open "${url}"`
  }

  return new Promise((resolve) => {
    exec(command, (error) => {
      resolve(!error)
    })
  })
}

// Device authorization flow
async function runDeviceAuthSetup() {
  log('Getting authorization code...', 'yellow')

  // Request device code from API
  let deviceResponse
  try {
    const response = await fetch(`${SUPARANK_API_URL}/auth/device`, {
      method: 'POST'
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    deviceResponse = await response.json()
  } catch (e) {
    log(`Failed to get authorization code: ${e.message}`, 'red')
    log('Please check your internet connection and try again.', 'dim')
    process.exit(1)
  }

  const { device_code, user_code, verification_uri_complete, expires_in, interval } = deviceResponse

  // Display code to user
  console.log()
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'dim')
  console.log()
  log(`  Your code: ${colors.bright}${colors.cyan}${user_code}${colors.reset}`, 'reset')
  console.log()
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'dim')
  console.log()
  log('Open this URL to authorize:', 'dim')
  log(`  ${verification_uri_complete}`, 'cyan')
  console.log()

  // Try to open browser
  const openChoice = await prompt('Press Enter to open browser (or "n" to skip): ')
  if (openChoice.toLowerCase() !== 'n') {
    const opened = await openBrowser(verification_uri_complete)
    if (opened) {
      log('Browser opened!', 'green')
    } else {
      log('Could not open browser. Please open the URL manually.', 'yellow')
    }
  }

  // Poll for authorization
  console.log()
  log('Waiting for authorization...', 'yellow')
  log(`(Code expires in ${Math.floor(expires_in / 60)} minutes)`, 'dim')
  console.log()

  const startTime = Date.now()
  const expiresAt = startTime + (expires_in * 1000)
  let dots = 0

  while (Date.now() < expiresAt) {
    await sleep(interval * 1000)

    try {
      const pollResponse = await fetch(`${SUPARANK_API_URL}/auth/device/${device_code}`)
      const result = await pollResponse.json()

      if (result.error === 'authorization_pending') {
        // Show progress
        dots = (dots + 1) % 4
        process.stdout.write(`\r  Waiting${'.'.repeat(dots)}${' '.repeat(3 - dots)}`)
        continue
      }

      if (result.error === 'slow_down') {
        await sleep(interval * 1000) // Double wait
        continue
      }

      if (result.error === 'expired_token') {
        console.log()
        log('Authorization code expired. Please run setup again.', 'red')
        process.exit(1)
      }

      if (result.error === 'access_denied') {
        console.log()
        log('Authorization was denied.', 'red')
        process.exit(1)
      }

      // Success!
      console.log()
      console.log()
      log('Authorization successful!', 'green')
      console.log()

      // Save config
      const config = {
        api_key: result.api_key,
        project_slug: result.project_slug,
        created_at: new Date().toISOString()
      }

      saveConfig(config)

      log(`Project: ${result.project_name}`, 'cyan')
      if (result.user_email) {
        log(`User: ${result.user_email}`, 'dim')
      }
      log('Configuration saved!', 'green')

      return true

    } catch (e) {
      // Network error, continue polling
      dots = (dots + 1) % 4
      process.stdout.write(`\r  Waiting${'.'.repeat(dots)}${' '.repeat(3 - dots)}`)
    }
  }

  console.log()
  log('Authorization timed out. Please run setup again.', 'red')
  process.exit(1)
}

// Manual setup flow (fallback)
async function runManualSetup() {
  // Step 1: Get API key
  log('Step 1: API Key', 'bright')
  log('Get your API key from: https://app.suparank.io/dashboard/settings/api-keys', 'dim')
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

  // Test connection
  console.log()
  log('Testing connection...', 'yellow')

  const result = await testConnection(apiKey, projectSlug)

  if (!result.success) {
    log(`Connection failed: ${result.error}`, 'red')
    log('Please check your API key and project slug.', 'dim')
    process.exit(1)
  }

  log(`Connected to project: ${result.project.name}`, 'green')

  // Save config
  const config = {
    api_key: apiKey,
    project_slug: projectSlug,
    created_at: new Date().toISOString()
  }

  saveConfig(config)
  log('Configuration saved!', 'green')

  return true
}

// Show setup complete message
function showSetupComplete() {
  // Optional credentials
  console.log()
  log('Optional: Local Credentials', 'bright')
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

async function runSetup() {
  logHeader('Suparank Setup Wizard')

  log('Welcome to Suparank!', 'cyan')
  log('This wizard will connect your CLI to your Suparank account.', 'dim')
  console.log()

  // Offer setup method choice
  log('Setup method:', 'bright')
  log('  1. Browser authorization (recommended)', 'dim')
  log('  2. Manual API key entry', 'dim')
  console.log()

  const choice = await prompt('Choice [1]: ')

  console.log()

  let success = false
  if (choice === '2') {
    success = await runManualSetup()
  } else {
    success = await runDeviceAuthSetup()
  }

  if (success) {
    showSetupComplete()

    // Auto-run MCP after setup
    console.log()
    log('Starting MCP server...', 'cyan')
    console.log()
    await runMCP()
  }
}

async function runTest() {
  logHeader('Testing Connection')

  const config = loadConfig()
  if (!config) {
    log('No configuration found. Run: npx suparank setup', 'red')
    process.exit(1)
  }

  log(`Project: ${config.project_slug}`, 'dim')
  log(`API URL: ${SUPARANK_API_URL}`, 'dim')
  console.log()

  log('Testing...', 'yellow')
  const result = await testConnection(config.api_key, config.project_slug)

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

async function runMCP() {
  // Check for updates in background (non-blocking)
  checkForUpdates()

  const config = loadConfig()

  if (!config) {
    // No config - exit with error (user needs to run setup first)
    console.error('[suparank] No configuration found. Run: npx suparank setup')
    process.exit(1)
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
    console.error('[suparank] Error: mcp-client not found')
    process.exit(1)
  }

  // Launch MCP client with config
  // Use 'pipe' for stdin/stdout to properly handle MCP protocol
  // stderr is inherited for logging
  const child = spawn('node', [mcpClientPath, config.project_slug, config.api_key], {
    stdio: ['inherit', 'inherit', 'inherit'],
    env: {
      ...process.env,
      SUPARANK_API_URL: SUPARANK_API_URL
    }
  })

  child.on('error', (err) => {
    console.error('[suparank] Failed to start MCP client:', err.message)
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
  case 'update':
    logHeader('Updating Suparank')
    log('Clearing npx cache and fetching latest version...', 'yellow')
    try {
      execSync('rm -rf ~/.npm/_npx', { stdio: 'inherit' })
      log('Cache cleared!', 'green')
      log('Next run will use the latest version.', 'dim')
      // Also clear version cache
      if (fs.existsSync(VERSION_CACHE_FILE)) {
        fs.unlinkSync(VERSION_CACHE_FILE)
      }
    } catch (e) {
      log(`Update failed: ${e.message}`, 'red')
    }
    break
  case 'version':
  case '-v':
  case '--version':
    const ver = getCurrentVersion()
    console.log(ver || 'unknown')
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
    log('  update     Clear cache and update to latest', 'dim')
    log('  version    Show current version', 'dim')
    log('  help       Show this help message', 'dim')
    break
  default:
    runMCP()
}
