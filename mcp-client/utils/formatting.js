/**
 * Suparank MCP - Formatting Utilities
 *
 * Content formatting and conversion utilities
 */

import { marked } from 'marked'
import { log } from './logging.js'

/**
 * Convert markdown to HTML using marked library
 * Configured for WordPress/Ghost CMS compatibility
 * @param {string} markdown - Markdown content
 * @returns {string} HTML content
 */
export function markdownToHtml(markdown) {
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
 * Convert aspect ratio string to fal.ai image size
 * @param {string} ratio - Aspect ratio (e.g., '16:9', '1:1')
 * @returns {string} fal.ai size identifier
 */
export function aspectRatioToSize(ratio) {
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
 * Truncate text to a maximum length
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated text
 */
export function truncate(text, maxLength = 100) {
  if (!text || text.length <= maxLength) return text
  return text.substring(0, maxLength) + '...'
}

/**
 * Sanitize a string for use as a slug/filename
 * @param {string} str - String to sanitize
 * @returns {string} Sanitized string
 */
export function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
