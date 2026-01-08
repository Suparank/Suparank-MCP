#!/usr/bin/env node

/**
 * Suparank CLI - Interactive Setup and MCP Launcher
 *
 * Usage:
 *   npx suparank              - Run MCP (or setup if first time)
 *   npx suparank setup        - Run setup wizard
 *   npx suparank credentials  - Configure local credentials (WordPress, Ghost, etc.)
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

// Production API URL
const DEFAULT_API_URL = 'https://api.suparank.io'

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
}

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`)
}

function logHeader(message) {
  console.log()
  log(`${'='.repeat(50)}`, 'cyan')
  log(`  ${message}`, 'bright')
  log(`${'='.repeat(50)}`, 'cyan')
  console.log()
}

function logStep(step, total, message) {
  log(`[${step}/${total}] ${message}`, 'yellow')
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
  } catch (e) {
    // Ignore errors
  }
  return {}
}

function saveCredentials(credentials) {
  ensureDir()
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2))
  // Set restrictive permissions
  fs.chmodSync(CREDENTIALS_FILE, 0o600)
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

function promptPassword(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    })

    // Hide input for passwords
    process.stdout.write(question)
    let password = ''

    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf8')

    const onData = (char) => {
      if (char === '\n' || char === '\r') {
        process.stdin.setRawMode(false)
        process.stdin.removeListener('data', onData)
        rl.close()
        console.log()
        resolve(password)
      } else if (char === '\u0003') {
        process.exit()
      } else if (char === '\u007F') {
        password = password.slice(0, -1)
        process.stdout.clearLine(0)
        process.stdout.cursorTo(0)
        process.stdout.write(question + '*'.repeat(password.length))
      } else {
        password += char
        process.stdout.write('*')
      }
    }

    process.stdin.on('data', onData)
  })
}

async function testConnection(apiKey, projectSlug, apiUrl = null) {
  try {
    const url = apiUrl || DEFAULT_API_URL
    const response = await fetch(`${url}/projects/${projectSlug}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    })

    if (response.ok) {
      const data = await response.json()
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

  log('Welcome to Suparank! ', 'green')
  log('AI-powered SEO content creation for your blog.', 'dim')
  console.log()
  log('This wizard will help you:', 'cyan')
  log('  1. Connect to your Suparank account', 'dim')
  log('  2. Configure your project', 'dim')
  log('  3. Set up local integrations (optional)', 'dim')
  console.log()

  // Step 1: API Key
  logStep(1, 3, 'Suparank Account')
  console.log()
  log('Get your API key from:', 'dim')
  log('  https://suparank.io/dashboard/settings/api-keys', 'cyan')
  console.log()

  const apiKey = await prompt('Enter your API key: ')
  if (!apiKey) {
    log('API key is required. Exiting.', 'red')
    process.exit(1)
  }

  // Validate API key format
  if (!apiKey.startsWith('sk_live_') && !apiKey.startsWith('sk_test_')) {
    log('Invalid API key format. Keys must start with sk_live_ or sk_test_', 'red')
    process.exit(1)
  }

  // Step 2: Project slug
  console.log()
  logStep(2, 3, 'Project Selection')
  console.log()
  log('Enter your project slug (from your dashboard URL)', 'dim')
  log('Example: my-blog-abc123', 'dim')
  console.log()

  const projectSlug = await prompt('Project slug: ')
  if (!projectSlug) {
    log('Project slug is required. Exiting.', 'red')
    process.exit(1)
  }

  // Test connection
  console.log()
  log('Testing connection...', 'yellow')

  const result = await testConnection(apiKey, projectSlug, DEFAULT_API_URL)

  if (!result.success) {
    log(`Connection failed: ${result.error}`, 'red')
    log('Please check your API key and project slug.', 'dim')
    process.exit(1)
  }

  log(`Connected to: ${result.project.name}`, 'green')

  // Save config
  const config = {
    api_key: apiKey,
    project_slug: projectSlug,
    api_url: DEFAULT_API_URL,
    created_at: new Date().toISOString()
  }

  saveConfig(config)
  log('Configuration saved!', 'green')

  // Step 3: Local credentials (optional)
  console.log()
  logStep(3, 3, 'Local Integrations (Optional)')
  console.log()
  log('Set up local integrations for:', 'dim')
  log('  - Image generation (fal.ai, Gemini, wiro.ai)', 'dim')
  log('  - WordPress publishing', 'dim')
  log('  - Ghost CMS publishing', 'dim')
  log('  - Webhooks (Make, n8n, Zapier, Slack)', 'dim')
  console.log()

  const setupCreds = await prompt('Configure integrations now? (y/N): ')

  if (setupCreds.toLowerCase() === 'y') {
    await runCredentialsSetup()
  } else {
    log('You can configure integrations later with: npx suparank credentials', 'dim')
  }

  // Final instructions
  logHeader('Setup Complete!')

  log('Add Suparank to your AI client:', 'bright')
  console.log()

  log('For Claude Desktop:', 'cyan')
  log('Edit ~/.config/claude/claude_desktop_config.json:', 'dim')
  console.log(`{
  "mcpServers": {
    "suparank": {
      "command": "npx",
      "args": ["suparank"]
    }
  }
}`)

  console.log()
  log('For Cursor:', 'cyan')
  log('Add to your MCP settings:', 'dim')
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
  log('  npx suparank              Run MCP server', 'dim')
  log('  npx suparank setup        Re-run setup', 'dim')
  log('  npx suparank credentials  Configure integrations', 'dim')
  log('  npx suparank test         Test connection', 'dim')
  log('  npx suparank session      View session state', 'dim')
  log('  npx suparank clear        Clear session', 'dim')
  console.log()
  log('Documentation: https://suparank.io/docs', 'cyan')
}

async function runCredentialsSetup() {
  logHeader('Configure Integrations')

  const credentials = loadCredentials()

  // Image Generation
  log('Image Generation', 'bright')
  log('Generate AI images for your blog posts', 'dim')
  console.log()
  log('Providers:', 'cyan')
  log('  1. fal.ai (recommended) - Fast, high quality', 'dim')
  log('  2. wiro.ai - Google Imagen via API', 'dim')
  log('  3. Gemini - Google AI directly', 'dim')
  log('  4. Skip', 'dim')
  console.log()

  const imageChoice = await prompt('Choose provider (1-4): ')

  if (imageChoice === '1') {
    const apiKey = await prompt('fal.ai API key: ')
    if (apiKey) {
      credentials.image_provider = 'fal'
      credentials.fal = { api_key: apiKey }
      log('fal.ai configured!', 'green')
    }
  } else if (imageChoice === '2') {
    const apiKey = await prompt('wiro.ai API key: ')
    const apiSecret = await prompt('wiro.ai API secret: ')
    if (apiKey && apiSecret) {
      credentials.image_provider = 'wiro'
      credentials.wiro = {
        api_key: apiKey,
        api_secret: apiSecret,
        model: 'google/nano-banana-pro'
      }
      log('wiro.ai configured!', 'green')
    }
  } else if (imageChoice === '3') {
    const apiKey = await prompt('Google AI API key: ')
    if (apiKey) {
      credentials.image_provider = 'gemini'
      credentials.gemini = { api_key: apiKey }
      log('Gemini configured!', 'green')
    }
  }

  // WordPress
  console.log()
  log('WordPress Publishing', 'bright')
  log('Publish directly to your WordPress site', 'dim')
  console.log()

  const setupWP = await prompt('Configure WordPress? (y/N): ')
  if (setupWP.toLowerCase() === 'y') {
    log('Install the Suparank Connector plugin from:', 'dim')
    log('  https://suparank.io/wordpress-plugin', 'cyan')
    console.log()

    const siteUrl = await prompt('WordPress site URL (https://your-site.com): ')
    const secretKey = await prompt('Plugin secret key (from plugin settings): ')

    if (siteUrl && secretKey) {
      credentials.wordpress = {
        site_url: siteUrl.replace(/\/$/, ''),
        secret_key: secretKey
      }
      log('WordPress configured!', 'green')
    }
  }

  // Ghost
  console.log()
  log('Ghost CMS Publishing', 'bright')
  log('Publish directly to your Ghost blog', 'dim')
  console.log()

  const setupGhost = await prompt('Configure Ghost? (y/N): ')
  if (setupGhost.toLowerCase() === 'y') {
    const apiUrl = await prompt('Ghost site URL (https://your-ghost.com): ')
    const adminKey = await prompt('Admin API key (from Ghost settings): ')

    if (apiUrl && adminKey) {
      credentials.ghost = {
        api_url: apiUrl.replace(/\/$/, ''),
        admin_api_key: adminKey
      }
      log('Ghost configured!', 'green')
    }
  }

  // Webhooks
  console.log()
  log('Webhooks (Optional)', 'bright')
  log('Send notifications to Make, n8n, Zapier, or Slack', 'dim')
  console.log()

  const setupWebhooks = await prompt('Configure webhooks? (y/N): ')
  if (setupWebhooks.toLowerCase() === 'y') {
    credentials.webhooks = credentials.webhooks || {}

    const slackUrl = await prompt('Slack webhook URL (or Enter to skip): ')
    if (slackUrl) credentials.webhooks.slack_url = slackUrl

    const makeUrl = await prompt('Make.com webhook URL (or Enter to skip): ')
    if (makeUrl) credentials.webhooks.make_url = makeUrl

    const zapierUrl = await prompt('Zapier webhook URL (or Enter to skip): ')
    if (zapierUrl) credentials.webhooks.zapier_url = zapierUrl

    log('Webhooks configured!', 'green')
  }

  // Save credentials
  saveCredentials(credentials)
  console.log()
  log('Credentials saved to ~/.suparank/credentials.json', 'green')
  log('File permissions set to owner-only (600)', 'dim')
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
    console.log()

    // Check credentials
    const creds = loadCredentials()
    const configured = []
    if (creds.wordpress?.secret_key) configured.push('WordPress')
    if (creds.ghost?.admin_api_key) configured.push('Ghost')
    if (creds[creds.image_provider]?.api_key) configured.push(`Images (${creds.image_provider})`)
    if (creds.webhooks && Object.values(creds.webhooks).some(Boolean)) configured.push('Webhooks')

    if (configured.length > 0) {
      log('Local integrations:', 'cyan')
      configured.forEach(c => log(`  - ${c}`, 'green'))
    } else {
      log('No local integrations configured', 'dim')
      log('Run: npx suparank credentials', 'dim')
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

function showVersion() {
  const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf-8'))
  log(`Suparank MCP v${packageJson.version}`, 'cyan')
  log('https://suparank.io', 'dim')
}

function runMCP() {
  const config = loadConfig()

  if (!config) {
    log('No configuration found. Running setup...', 'yellow')
    console.log()
    runSetup()
    return
  }

  // Find the MCP client script
  const mcpClientPaths = [
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
    log('Error: mcp-client.js not found', 'red')
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
  case 'credentials':
  case 'creds':
    runCredentialsSetup()
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
  case 'version':
  case '-v':
  case '--version':
    showVersion()
    break
  case 'help':
  case '--help':
  case '-h':
    logHeader('Suparank CLI')
    log('AI-powered SEO content creation MCP', 'dim')
    console.log()
    log('Usage: npx suparank [command]', 'cyan')
    console.log()
    log('Commands:', 'bright')
    log('  (none)       Run MCP server (default)', 'dim')
    log('  setup        Run setup wizard', 'dim')
    log('  credentials  Configure local integrations', 'dim')
    log('  test         Test API connection', 'dim')
    log('  session      View current session state', 'dim')
    log('  clear        Clear session state', 'dim')
    log('  version      Show version', 'dim')
    log('  help         Show this help message', 'dim')
    console.log()
    log('Documentation: https://suparank.io/docs', 'cyan')
    break
  default:
    runMCP()
}
