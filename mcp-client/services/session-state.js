/**
 * Suparank MCP - Session State Service
 *
 * Session state management with persistence and mutex protection
 */

import * as fs from 'fs'
import {
  getSessionFilePath,
  ensureSuparankDir,
  atomicWriteSync
} from '../utils/paths.js'
import { log, progress } from '../utils/logging.js'
import { SESSION_EXPIRY_MS } from '../config.js'

// Session state object
export const sessionState = {
  currentWorkflow: null,
  stepResults: {},
  articles: [],
  article: null,
  title: null,
  imageUrl: null,
  inlineImages: [],
  keywords: null,
  metadata: null,
  metaTitle: null,
  metaDescription: null,
  contentFolder: null
}

// Session mutex for concurrent access protection
let sessionLock = false
const sessionLockQueue = []

/**
 * Acquire session lock for safe concurrent access
 * @returns {Promise<void>}
 */
export async function acquireSessionLock() {
  if (!sessionLock) {
    sessionLock = true
    return
  }
  return new Promise(resolve => {
    sessionLockQueue.push(resolve)
  })
}

/**
 * Release session lock
 */
export function releaseSessionLock() {
  if (sessionLockQueue.length > 0) {
    const next = sessionLockQueue.shift()
    next()
  } else {
    sessionLock = false
  }
}

/**
 * Generate a unique article ID
 * @returns {string} Unique ID
 */
export function generateArticleId() {
  return `article-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
}

/**
 * Check if session has expired
 * @param {string} savedAt - ISO timestamp when session was saved
 * @returns {boolean} Whether session has expired
 */
export function isSessionExpired(savedAt) {
  if (!savedAt) return true
  const savedTime = new Date(savedAt).getTime()
  const now = Date.now()
  return (now - savedTime) > SESSION_EXPIRY_MS
}

/**
 * Save session state to file
 * Uses atomic write to prevent corruption
 */
export function saveSession() {
  try {
    ensureSuparankDir()
    const sessionFile = getSessionFilePath()

    const toSave = {
      currentWorkflow: sessionState.currentWorkflow,
      stepResults: sessionState.stepResults,
      articles: sessionState.articles,
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

    atomicWriteSync(sessionFile, JSON.stringify(toSave, null, 2))
    progress('Session', `Saved to ${sessionFile} (${sessionState.articles.length} articles)`)
  } catch (error) {
    log(`Warning: Failed to save session: ${error.message}`)
    progress('Session', `FAILED to save: ${error.message}`)
  }
}

/**
 * Safe session save with mutex
 * @returns {Promise<void>}
 */
export async function saveSessionSafe() {
  await acquireSessionLock()
  try {
    saveSession()
  } finally {
    releaseSessionLock()
  }
}

/**
 * Load session state from file
 * @returns {boolean} Whether session was restored
 */
export function restoreSession() {
  const sessionFile = getSessionFilePath()

  try {
    if (fs.existsSync(sessionFile)) {
      const content = fs.readFileSync(sessionFile, 'utf-8')
      const saved = JSON.parse(content)

      // Check if session is expired (24 hour max)
      if (isSessionExpired(saved.savedAt)) {
        log('Session expired, starting fresh')
        return false
      }

      // Restore state
      sessionState.currentWorkflow = saved.currentWorkflow || null
      sessionState.stepResults = saved.stepResults || {}
      sessionState.articles = saved.articles || []
      sessionState.article = saved.article || null
      sessionState.title = saved.title || null
      sessionState.imageUrl = saved.imageUrl || null
      sessionState.inlineImages = saved.inlineImages || []
      sessionState.keywords = saved.keywords || null
      sessionState.metadata = saved.metadata || null
      sessionState.metaTitle = saved.metaTitle || null
      sessionState.metaDescription = saved.metaDescription || null
      sessionState.contentFolder = saved.contentFolder || null

      log(`Session restored: ${sessionState.articles.length} articles, workflow: ${sessionState.currentWorkflow?.workflow_id || 'none'}`)
      return true
    }
  } catch (error) {
    log(`Warning: Could not restore session: ${error.message}`)
  }

  return false
}

/**
 * Reset session state to initial values
 */
export function resetSession() {
  sessionState.currentWorkflow = null
  sessionState.stepResults = {}
  sessionState.articles = []
  sessionState.article = null
  sessionState.title = null
  sessionState.imageUrl = null
  sessionState.inlineImages = []
  sessionState.keywords = null
  sessionState.metadata = null
  sessionState.metaTitle = null
  sessionState.metaDescription = null
  sessionState.contentFolder = null
}

/**
 * Clear session file from disk
 */
export function clearSessionFile() {
  const sessionFile = getSessionFilePath()
  try {
    if (fs.existsSync(sessionFile)) {
      fs.unlinkSync(sessionFile)
      log('Session file cleared')
    }
  } catch (error) {
    log(`Warning: Could not clear session file: ${error.message}`)
  }
}
