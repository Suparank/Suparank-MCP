/**
 * Suparank MCP - Webhook Publisher
 *
 * Send data to configured webhooks (Make.com, n8n, Zapier, Slack)
 */

import { log } from '../utils/logging.js'
import { getCredentials } from '../services/credentials.js'
import { projectSlug } from '../config.js'

/**
 * Send data to a webhook
 * @param {object} args - Webhook arguments
 * @param {string} [args.webhook_type='default'] - Webhook type
 * @param {object} [args.payload={}] - Data payload
 * @param {string} [args.message] - Message text (for Slack)
 * @returns {Promise<object>} MCP response
 */
export async function executeSendWebhook(args) {
  const credentials = getCredentials()
  const { webhook_type = 'default', payload = {}, message } = args
  const webhooks = credentials.webhooks

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
  const headers = { 'Content-Type': 'application/json' }

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
