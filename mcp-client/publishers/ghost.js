/**
 * Suparank MCP - Ghost Publisher
 *
 * Publish content to Ghost CMS using Admin API
 */

import { log, progress } from '../utils/logging.js'
import { fetchWithRetry } from '../services/api.js'
import { getCredentials } from '../services/credentials.js'
import { markdownToHtml } from '../utils/formatting.js'

/**
 * Create JWT for Ghost Admin API
 * @param {string} id - API key ID
 * @param {string} secret - API key secret
 * @returns {Promise<string>} JWT token
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
 * Publish content to Ghost CMS
 * @param {object} args - Publish arguments
 * @param {string} args.title - Post title
 * @param {string} args.content - Post content (markdown)
 * @param {string} [args.status='draft'] - Publication status
 * @param {string[]} [args.tags=[]] - Tag names
 * @param {string} [args.featured_image_url] - Featured image URL
 * @returns {Promise<object>} MCP response
 */
export async function executeGhostPublish(args) {
  const credentials = getCredentials()
  const { api_url, admin_api_key } = credentials.ghost
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
