/**
 * Suparank MCP - WordPress Publisher
 *
 * Publish content to WordPress using REST API or Suparank Connector plugin
 */

import { log, progress } from '../utils/logging.js'
import { fetchWithRetry, fetchWithTimeout } from '../services/api.js'
import { getCredentials } from '../services/credentials.js'
import { sessionState } from '../services/session-state.js'
import { markdownToHtml } from '../utils/formatting.js'

/**
 * Fetch available categories from WordPress
 * @returns {Promise<Array|null>} Categories array or null
 */
export async function fetchWordPressCategories() {
  const credentials = getCredentials()
  const wpConfig = credentials?.wordpress

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
 * Publish content to WordPress
 * @param {object} args - Publish arguments
 * @param {string} args.title - Post title
 * @param {string} args.content - Post content (markdown)
 * @param {string} [args.status='draft'] - Publication status
 * @param {string[]} [args.categories=[]] - Category names
 * @param {string[]} [args.tags=[]] - Tag names
 * @param {string} [args.featured_image_url] - Featured image URL
 * @returns {Promise<object>} MCP response
 */
export async function executeWordPressPublish(args) {
  const credentials = getCredentials()
  const wpConfig = credentials.wordpress
  const { title, content, status = 'draft', categories = [], tags = [], featured_image_url } = args

  progress('Publish', `Publishing to WordPress: "${title}"`)
  log(`Publishing to WordPress: ${title}`)

  // Convert markdown to HTML for WordPress
  const htmlContent = markdownToHtml(content)

  // Method 1: Use Suparank Connector plugin (secret_key auth)
  if (wpConfig.secret_key) {
    return publishWithPlugin(wpConfig, {
      title,
      htmlContent,
      status,
      categories,
      tags,
      featured_image_url
    })
  }

  // Method 2: Use standard REST API with application password
  if (wpConfig.app_password && wpConfig.username) {
    return publishWithRestApi(wpConfig, {
      title,
      htmlContent,
      status,
      categories,
      tags
    })
  }

  throw new Error('WordPress credentials not configured. Add either secret_key (with plugin) or username + app_password to ~/.suparank/credentials.json')
}

/**
 * Publish using Suparank/Writer MCP Connector plugin
 */
async function publishWithPlugin(wpConfig, { title, htmlContent, status, categories, tags, featured_image_url }) {
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
          return formatSuccessResponse(result.post, status)
        }
      }
      lastError = await response.text()
    } catch (e) {
      lastError = e.message
    }
  }

  throw new Error(`WordPress error: ${lastError}`)
}

/**
 * Publish using standard WordPress REST API
 */
async function publishWithRestApi(wpConfig, { title, htmlContent, status, categories, tags }) {
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

/**
 * Format success response for plugin publishing
 */
function formatSuccessResponse(post, status) {
  const categoriesInfo = post.categories?.length
    ? `\n**Categories:** ${post.categories.join(', ')}`
    : ''
  const tagsInfo = post.tags?.length
    ? `\n**Tags:** ${post.tags.join(', ')}`
    : ''
  const imageInfo = post.featured_image
    ? `\n**Featured Image:** Uploaded`
    : ''

  return {
    content: [{
      type: 'text',
      text: `Post published to WordPress!\n\n**Title:** ${post.title}\n**Status:** ${post.status}\n**URL:** ${post.url}\n**Edit:** ${post.edit_url}\n**ID:** ${post.id}${categoriesInfo}${tagsInfo}${imageInfo}\n\n${status === 'draft' ? 'The post is saved as a draft. Edit and publish from WordPress dashboard.' : 'The post is now live!'}`
    }]
  }
}
