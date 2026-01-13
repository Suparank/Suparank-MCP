/**
 * Suparank Secrets Wizard
 *
 * Interactive CLI for configuring API keys and credentials.
 * Run with: npx suparank secrets
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as readline from 'readline'

const SUPARANK_DIR = path.join(os.homedir(), '.suparank')
const CREDENTIALS_FILE = path.join(SUPARANK_DIR, 'credentials.json')

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

function ensureDir() {
  if (!fs.existsSync(SUPARANK_DIR)) {
    fs.mkdirSync(SUPARANK_DIR, { recursive: true })
  }
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

function saveCredentials(creds) {
  ensureDir()
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2))
}

function maskKey(key) {
  if (!key) return '(not set)'
  if (key.length <= 8) return '*'.repeat(key.length)
  return key.substring(0, 4) + '*'.repeat(key.length - 8) + key.substring(key.length - 4)
}

// ==================== Main Menu ====================

async function showMainMenu() {
  console.clear()
  logHeader('Suparank Secrets Manager')

  log('What would you like to configure?', 'bright')
  console.log()
  log('  1. Image Generation (fal.ai, Gemini, Wiro)', 'cyan')
  log('  2. WordPress Publishing', 'cyan')
  log('  3. Ghost Publishing', 'cyan')
  log('  4. Webhooks (Make, n8n, Zapier, Slack)', 'cyan')
  log('  5. External MCPs', 'cyan')
  log('  6. View Current Config', 'dim')
  console.log()
  log('  q. Quit', 'dim')
  console.log()

  return await prompt('Enter choice: ')
}

// ==================== Image Provider ====================

async function configureImageProvider() {
  logHeader('Image Generation Setup')

  log('Choose your provider:', 'bright')
  console.log()
  log('  1. fal.ai (recommended)', 'cyan')
  log('  2. Google Gemini', 'cyan')
  log('  3. Wiro', 'cyan')
  log('  b. Back to menu', 'dim')
  console.log()

  const choice = await prompt('Enter choice: ')

  if (choice === 'b' || choice === '') return

  const creds = loadCredentials()

  switch (choice) {
    case '1':
      await configureFal(creds)
      break
    case '2':
      await configureGemini(creds)
      break
    case '3':
      await configureWiro(creds)
      break
  }
}

async function configureFal(creds) {
  logHeader('fal.ai Setup')

  log('Get your API key from:', 'dim')
  log('  https://fal.ai/dashboard/keys', 'cyan')
  console.log()

  const apiKey = await prompt('Enter API key: ')
  if (!apiKey) {
    log('Cancelled.', 'yellow')
    return
  }

  // Test connection
  log('Testing connection...', 'yellow')
  const testResult = await testFalConnection(apiKey)

  if (testResult.success) {
    log('Connection successful!', 'green')

    // Model selection
    console.log()
    log('Select model:', 'bright')
    log('  1. google/nano-banana-pro (recommended)', 'dim')
    log('  2. google/nano-banana', 'dim')
    log('  3. Custom', 'dim')
    console.log()

    const modelChoice = await prompt('Enter choice [1]: ')
    let model = 'google/nano-banana-pro'

    if (modelChoice === '2') {
      model = 'google/nano-banana'
    } else if (modelChoice === '3') {
      model = await prompt('Enter model name: ') || model
    }

    // Save
    creds.image_provider = 'fal'
    creds.fal = { api_key: apiKey, model }
    saveCredentials(creds)

    console.log()
    log('fal.ai configured successfully!', 'green')
    log(`Saved to: ${CREDENTIALS_FILE}`, 'dim')
  } else {
    log(`Connection failed: ${testResult.error}`, 'red')
    log('Please check your API key and try again.', 'dim')
  }

  await prompt('\nPress Enter to continue...')
}

async function configureGemini(creds) {
  logHeader('Google Gemini Setup')

  log('Get your API key from:', 'dim')
  log('  https://aistudio.google.com/app/apikey', 'cyan')
  console.log()

  const apiKey = await prompt('Enter API key: ')
  if (!apiKey) {
    log('Cancelled.', 'yellow')
    return
  }

  // Model selection
  console.log()
  log('Select model:', 'bright')
  log('  1. gemini-2.0-flash-preview-image-generation (recommended)', 'dim')
  log('  2. imagen-3.0-generate-002', 'dim')
  log('  3. Custom', 'dim')
  console.log()

  const modelChoice = await prompt('Enter choice [1]: ')
  let model = 'gemini-2.0-flash-preview-image-generation'

  if (modelChoice === '2') {
    model = 'imagen-3.0-generate-002'
  } else if (modelChoice === '3') {
    model = await prompt('Enter model name: ') || model
  }

  // Save
  creds.image_provider = 'gemini'
  creds.gemini = { api_key: apiKey, model }
  saveCredentials(creds)

  console.log()
  log('Google Gemini configured successfully!', 'green')
  log(`Saved to: ${CREDENTIALS_FILE}`, 'dim')

  await prompt('\nPress Enter to continue...')
}

async function configureWiro(creds) {
  logHeader('Wiro Setup')

  log('Get your API credentials from:', 'dim')
  log('  https://wiro.ai/dashboard', 'cyan')
  console.log()

  const apiKey = await prompt('Enter API key: ')
  if (!apiKey) {
    log('Cancelled.', 'yellow')
    return
  }

  const apiSecret = await prompt('Enter API secret: ')
  if (!apiSecret) {
    log('Cancelled.', 'yellow')
    return
  }

  // Model selection
  console.log()
  log('Select model:', 'bright')
  log('  1. google/nano-banana-pro (recommended)', 'dim')
  log('  2. Custom', 'dim')
  console.log()

  const modelChoice = await prompt('Enter choice [1]: ')
  let model = 'google/nano-banana-pro'

  if (modelChoice === '2') {
    model = await prompt('Enter model name: ') || model
  }

  // Save
  creds.image_provider = 'wiro'
  creds.wiro = { api_key: apiKey, api_secret: apiSecret, model }
  saveCredentials(creds)

  console.log()
  log('Wiro configured successfully!', 'green')
  log(`Saved to: ${CREDENTIALS_FILE}`, 'dim')

  await prompt('\nPress Enter to continue...')
}

// ==================== WordPress ====================

async function configureWordPress() {
  logHeader('WordPress Setup')

  log('Prerequisites:', 'bright')
  log('  1. Install the Suparank Connector plugin in WordPress', 'dim')
  log('  2. Go to Settings > Suparank to get your secret key', 'dim')
  console.log()
  log('Plugin download:', 'dim')
  log('  https://github.com/Suparank/Suparank-WordPress-Plugin', 'cyan')
  console.log()

  const creds = loadCredentials()
  const existing = creds.wordpress

  if (existing?.site_url) {
    log(`Current: ${existing.site_url}`, 'dim')
    log(`Key: ${maskKey(existing.secret_key)}`, 'dim')
    console.log()
    const update = await prompt('Update configuration? [y/N]: ')
    if (update.toLowerCase() !== 'y') {
      return
    }
    console.log()
  }

  let siteUrl = await prompt('Enter WordPress site URL (e.g., https://your-site.com): ')
  if (!siteUrl) {
    log('Cancelled.', 'yellow')
    await prompt('\nPress Enter to continue...')
    return
  }

  // Clean up URL
  siteUrl = siteUrl.replace(/\/+$/, '') // Remove trailing slashes
  if (!siteUrl.startsWith('http')) {
    siteUrl = 'https://' + siteUrl
  }

  const secretKey = await prompt('Enter secret key (from plugin settings): ')
  if (!secretKey) {
    log('Cancelled.', 'yellow')
    await prompt('\nPress Enter to continue...')
    return
  }

  // Test connection
  log('Testing connection...', 'yellow')
  const testResult = await testWordPressConnection(siteUrl, secretKey)

  if (testResult.success) {
    log('Connection successful!', 'green')
    log(`Site: ${testResult.data?.site?.name || siteUrl}`, 'dim')
    log(`WordPress: ${testResult.data?.wordpress || 'unknown'}`, 'dim')
    log(`Plugin: ${testResult.data?.version || 'unknown'}`, 'dim')

    // Save
    creds.wordpress = { site_url: siteUrl, secret_key: secretKey }
    saveCredentials(creds)

    console.log()
    log('WordPress configured successfully!', 'green')
    log(`Saved to: ${CREDENTIALS_FILE}`, 'dim')
  } else {
    log(`Connection failed: ${testResult.error}`, 'red')
    console.log()
    log('Possible issues:', 'yellow')
    log('  - Plugin not installed/activated', 'dim')
    log('  - Wrong secret key', 'dim')
    log('  - Site URL incorrect', 'dim')
    log('  - REST API disabled', 'dim')
    console.log()

    const saveAnyway = await prompt('Save anyway? [y/N]: ')
    if (saveAnyway.toLowerCase() === 'y') {
      creds.wordpress = { site_url: siteUrl, secret_key: secretKey }
      saveCredentials(creds)
      log('Saved.', 'yellow')
    }
  }

  await prompt('\nPress Enter to continue...')
}

// ==================== Ghost ====================

async function configureGhost() {
  logHeader('Ghost Setup')

  log('Get your Admin API key from:', 'dim')
  log('  Ghost Admin > Settings > Integrations > Add custom integration', 'cyan')
  console.log()
  log('The key format is: {id}:{secret}', 'dim')
  log('Example: 24charidentifier:64charhexsecret', 'dim')
  console.log()

  const creds = loadCredentials()
  const existing = creds.ghost

  if (existing?.api_url) {
    log(`Current: ${existing.api_url}`, 'dim')
    log(`Key: ${maskKey(existing.admin_api_key)}`, 'dim')
    console.log()
    const update = await prompt('Update configuration? [y/N]: ')
    if (update.toLowerCase() !== 'y') {
      return
    }
    console.log()
  }

  let apiUrl = await prompt('Enter Ghost API URL (e.g., https://your-site.ghost.io): ')
  if (!apiUrl) {
    log('Cancelled.', 'yellow')
    await prompt('\nPress Enter to continue...')
    return
  }

  // Clean up URL
  apiUrl = apiUrl.replace(/\/+$/, '')
  if (!apiUrl.startsWith('http')) {
    apiUrl = 'https://' + apiUrl
  }

  const adminApiKey = await prompt('Enter Admin API key: ')
  if (!adminApiKey) {
    log('Cancelled.', 'yellow')
    await prompt('\nPress Enter to continue...')
    return
  }

  // Validate key format
  const keyRegex = /^[a-f0-9]{24}:[a-f0-9]{64}$/
  if (!keyRegex.test(adminApiKey)) {
    log('Warning: Key format looks incorrect.', 'yellow')
    log('Expected format: 24_char_id:64_char_hex_secret', 'dim')
    console.log()
    const saveAnyway = await prompt('Save anyway? [y/N]: ')
    if (saveAnyway.toLowerCase() !== 'y') {
      return
    }
  }

  // Save
  creds.ghost = { api_url: apiUrl, admin_api_key: adminApiKey }
  saveCredentials(creds)

  console.log()
  log('Ghost configured successfully!', 'green')
  log(`Saved to: ${CREDENTIALS_FILE}`, 'dim')

  await prompt('\nPress Enter to continue...')
}

// ==================== Webhooks ====================

async function configureWebhooks() {
  logHeader('Webhooks Setup')

  log('Configure webhook URLs for publishing content.', 'dim')
  log('Leave empty to skip any webhook.', 'dim')
  console.log()

  const creds = loadCredentials()
  const existing = creds.webhooks || {}

  // Make
  log('Make (Integromat):', 'bright')
  if (existing.make_url) {
    log(`Current: ${existing.make_url}`, 'dim')
  }
  const makeUrl = await prompt('Make webhook URL: ')

  // n8n
  console.log()
  log('n8n:', 'bright')
  if (existing.n8n_url) {
    log(`Current: ${existing.n8n_url}`, 'dim')
  }
  const n8nUrl = await prompt('n8n webhook URL: ')

  // Zapier
  console.log()
  log('Zapier:', 'bright')
  if (existing.zapier_url) {
    log(`Current: ${existing.zapier_url}`, 'dim')
  }
  const zapierUrl = await prompt('Zapier webhook URL: ')

  // Slack
  console.log()
  log('Slack:', 'bright')
  if (existing.slack_url) {
    log(`Current: ${existing.slack_url}`, 'dim')
  }
  const slackUrl = await prompt('Slack webhook URL: ')

  // Default
  console.log()
  log('Default (fallback):', 'bright')
  if (existing.default_url) {
    log(`Current: ${existing.default_url}`, 'dim')
  }
  const defaultUrl = await prompt('Default webhook URL: ')

  // Build webhooks object (only non-empty values)
  const webhooks = {}
  if (makeUrl) webhooks.make_url = makeUrl
  else if (existing.make_url) webhooks.make_url = existing.make_url

  if (n8nUrl) webhooks.n8n_url = n8nUrl
  else if (existing.n8n_url) webhooks.n8n_url = existing.n8n_url

  if (zapierUrl) webhooks.zapier_url = zapierUrl
  else if (existing.zapier_url) webhooks.zapier_url = existing.zapier_url

  if (slackUrl) webhooks.slack_url = slackUrl
  else if (existing.slack_url) webhooks.slack_url = existing.slack_url

  if (defaultUrl) webhooks.default_url = defaultUrl
  else if (existing.default_url) webhooks.default_url = existing.default_url

  // Save if anything changed
  if (Object.keys(webhooks).length > 0) {
    creds.webhooks = webhooks
    saveCredentials(creds)

    console.log()
    log('Webhooks configured successfully!', 'green')
    log(`Saved to: ${CREDENTIALS_FILE}`, 'dim')
  } else {
    log('No webhooks configured.', 'dim')
  }

  await prompt('\nPress Enter to continue...')
}

// ==================== External MCPs ====================

async function configureExternalMCPs() {
  logHeader('External MCPs Setup')

  log('Add external MCP servers that can be used with Suparank tools.', 'dim')
  console.log()

  const creds = loadCredentials()
  const existing = creds.external_mcps || []

  if (existing.length > 0) {
    log('Current MCPs:', 'bright')
    existing.forEach((mcp, i) => {
      log(`  ${i + 1}. ${mcp.name} - ${mcp.available_tools?.length || 0} tools`, 'dim')
    })
    console.log()
  }

  log('Options:', 'bright')
  log('  1. Add new MCP', 'cyan')
  log('  2. Remove existing MCP', 'cyan')
  log('  b. Back to menu', 'dim')
  console.log()

  const choice = await prompt('Enter choice: ')

  if (choice === '1') {
    await addExternalMCP(creds, existing)
  } else if (choice === '2' && existing.length > 0) {
    await removeExternalMCP(creds, existing)
  }
}

async function addExternalMCP(creds, existing) {
  console.log()
  log('Add External MCP', 'bright')
  console.log()

  const name = await prompt('MCP name (e.g., seo-research-mcp): ')
  if (!name) {
    log('Cancelled.', 'yellow')
    await prompt('\nPress Enter to continue...')
    return
  }

  const description = await prompt('Description (optional): ')

  const toolsInput = await prompt('Available tools (comma-separated): ')
  const availableTools = toolsInput
    .split(',')
    .map(t => t.trim())
    .filter(t => t.length > 0)

  if (availableTools.length === 0) {
    log('At least one tool is required.', 'yellow')
    await prompt('\nPress Enter to continue...')
    return
  }

  const newMCP = {
    name,
    description: description || undefined,
    available_tools: availableTools
  }

  existing.push(newMCP)
  creds.external_mcps = existing
  saveCredentials(creds)

  console.log()
  log(`Added MCP: ${name} with ${availableTools.length} tools`, 'green')
  log(`Saved to: ${CREDENTIALS_FILE}`, 'dim')

  await prompt('\nPress Enter to continue...')
}

async function removeExternalMCP(creds, existing) {
  console.log()
  log('Remove External MCP', 'bright')
  console.log()

  existing.forEach((mcp, i) => {
    log(`  ${i + 1}. ${mcp.name}`, 'dim')
  })
  console.log()

  const indexStr = await prompt('Enter number to remove: ')
  const index = parseInt(indexStr, 10) - 1

  if (isNaN(index) || index < 0 || index >= existing.length) {
    log('Invalid selection.', 'yellow')
    await prompt('\nPress Enter to continue...')
    return
  }

  const removed = existing.splice(index, 1)[0]
  creds.external_mcps = existing
  saveCredentials(creds)

  console.log()
  log(`Removed: ${removed.name}`, 'green')
  log(`Saved to: ${CREDENTIALS_FILE}`, 'dim')

  await prompt('\nPress Enter to continue...')
}

// ==================== View Config ====================

async function viewCurrentConfig() {
  logHeader('Current Configuration')

  const creds = loadCredentials()

  if (Object.keys(creds).length === 0) {
    log('No credentials configured yet.', 'dim')
    log('Use the menu options to add credentials.', 'dim')
    await prompt('\nPress Enter to continue...')
    return
  }

  // Image Provider
  if (creds.image_provider) {
    log('Image Generation', 'bright')
    log(`  Provider: ${creds.image_provider}`, 'cyan')
    const providerConfig = creds[creds.image_provider]
    if (providerConfig?.api_key) {
      log(`  API Key: ${maskKey(providerConfig.api_key)}`, 'dim')
    }
    if (providerConfig?.model) {
      log(`  Model: ${providerConfig.model}`, 'dim')
    }
    console.log()
  }

  // WordPress
  if (creds.wordpress) {
    log('WordPress', 'bright')
    log(`  Site URL: ${creds.wordpress.site_url}`, 'cyan')
    log(`  Secret Key: ${maskKey(creds.wordpress.secret_key)}`, 'dim')
    console.log()
  }

  // Ghost
  if (creds.ghost) {
    log('Ghost', 'bright')
    log(`  API URL: ${creds.ghost.api_url}`, 'cyan')
    log(`  Admin Key: ${maskKey(creds.ghost.admin_api_key)}`, 'dim')
    console.log()
  }

  // Webhooks
  if (creds.webhooks && Object.keys(creds.webhooks).length > 0) {
    log('Webhooks', 'bright')
    for (const [key, url] of Object.entries(creds.webhooks)) {
      log(`  ${key}: ${url}`, 'dim')
    }
    console.log()
  }

  // External MCPs
  if (creds.external_mcps?.length > 0) {
    log('External MCPs', 'bright')
    creds.external_mcps.forEach(mcp => {
      log(`  ${mcp.name}: ${mcp.available_tools?.join(', ')}`, 'dim')
    })
    console.log()
  }

  log(`File: ${CREDENTIALS_FILE}`, 'dim')

  await prompt('\nPress Enter to continue...')
}

// ==================== Connection Tests ====================

async function testFalConnection(apiKey) {
  try {
    const response = await fetch('https://fal.run/fal-ai/nano-banana-pro', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt: 'test',
        num_inference_steps: 1,
        image_size: 'square_hd'
      })
    })

    // Even a 400 means the API key is valid
    if (response.status === 401 || response.status === 403) {
      return { success: false, error: 'Invalid API key' }
    }

    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

async function testWordPressConnection(siteUrl, secretKey) {
  try {
    // Try the ping endpoint
    const response = await fetch(`${siteUrl}/wp-json/suparank/v1/ping`, {
      method: 'GET',
      headers: {
        'X-Suparank-Key': secretKey
      }
    })

    if (!response.ok) {
      // Try legacy endpoint
      const legacyResponse = await fetch(`${siteUrl}/wp-json/writer-mcp/v1/ping`, {
        method: 'GET',
        headers: {
          'X-Writer-MCP-Key': secretKey
        }
      })

      if (!legacyResponse.ok) {
        return { success: false, error: `HTTP ${response.status}` }
      }

      const data = await legacyResponse.json()
      return { success: true, data }
    }

    const data = await response.json()
    return { success: true, data }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// ==================== Main ====================

export async function runSecrets() {
  while (true) {
    const choice = await showMainMenu()

    switch (choice.toLowerCase()) {
      case '1':
        await configureImageProvider()
        break
      case '2':
        await configureWordPress()
        break
      case '3':
        await configureGhost()
        break
      case '4':
        await configureWebhooks()
        break
      case '5':
        await configureExternalMCPs()
        break
      case '6':
        await viewCurrentConfig()
        break
      case 'q':
      case '':
        console.clear()
        log('Goodbye!', 'green')
        return
      default:
        log('Invalid choice. Please try again.', 'yellow')
        await prompt('\nPress Enter to continue...')
    }
  }
}
