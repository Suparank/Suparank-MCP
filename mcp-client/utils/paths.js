/**
 * Suparank MCP - Path Utilities
 *
 * Safe path handling and directory management
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

/**
 * Get the Suparank configuration directory
 * @returns {string} Path to ~/.suparank
 */
export function getSuparankDir() {
  return path.join(os.homedir(), '.suparank')
}

/**
 * Get the content storage directory
 * @returns {string} Path to ~/.suparank/content
 */
export function getContentDir() {
  return path.join(getSuparankDir(), 'content')
}

/**
 * Get session file path
 * @returns {string} Path to ~/.suparank/session.json
 */
export function getSessionFilePath() {
  return path.join(getSuparankDir(), 'session.json')
}

/**
 * Get credentials file path
 * @returns {string} Path to ~/.suparank/credentials.json
 */
export function getCredentialsFilePath() {
  return path.join(getSuparankDir(), 'credentials.json')
}

/**
 * Get stats file path
 * @returns {string} Path to ~/.suparank/stats.json
 */
export function getStatsFilePath() {
  return path.join(getSuparankDir(), 'stats.json')
}

/**
 * Ensure the Suparank directory exists
 */
export function ensureSuparankDir() {
  const dir = getSuparankDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/**
 * Ensure the content directory exists
 */
export function ensureContentDir() {
  const dir = getContentDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/**
 * Sanitize and validate a path to prevent traversal attacks
 * @param {string} userPath - User-provided path segment
 * @param {string} allowedBase - Base directory that paths must stay within
 * @returns {string} Resolved safe path
 * @throws {Error} If path would escape the allowed base
 */
export function sanitizePath(userPath, allowedBase) {
  // Remove any null bytes (common attack vector)
  const cleanPath = userPath.replace(/\0/g, '')

  // Resolve to absolute path
  const resolved = path.resolve(allowedBase, cleanPath)

  // Ensure the resolved path starts with the allowed base
  const normalizedBase = path.normalize(allowedBase + path.sep)
  const normalizedResolved = path.normalize(resolved + path.sep)

  if (!normalizedResolved.startsWith(normalizedBase)) {
    throw new Error(`Path traversal detected: "${userPath}" would escape allowed directory`)
  }

  return resolved
}

/**
 * Get content folder path safely
 * @param {string} folderName - Folder name (article ID or title slug)
 * @returns {string} Safe path to content folder
 */
export function getContentFolderSafe(folderName) {
  const contentDir = getContentDir()
  return sanitizePath(folderName, contentDir)
}

/**
 * Generate a slug from title for folder naming
 * @param {string} text - Text to slugify
 * @returns {string} URL-safe slug
 */
export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50)
}

/**
 * Atomic file write - prevents corruption on concurrent writes
 * @param {string} filePath - Target file path
 * @param {string} data - Data to write
 */
export function atomicWriteSync(filePath, data) {
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
