/**
 * Suparank MCP - Content Utilities
 *
 * Content saving and folder management utilities
 */

import * as fs from 'fs'
import * as path from 'path'
import { log, progress } from './logging.js'
import {
  ensureContentDir,
  getContentFolderSafe,
  atomicWriteSync,
  slugify
} from './paths.js'
import { sessionState } from '../services/session-state.js'
import { projectSlug } from '../config.js'

/**
 * Save current article content to a folder on disk
 * Creates a folder with article.md, metadata.json, and optional workflow.json
 * @returns {string|null} Folder path on success, null on failure
 */
export function saveContentToFolder() {
  if (!sessionState.title || !sessionState.article) {
    return null
  }

  try {
    ensureContentDir()

    // Create folder name: YYYY-MM-DD-slug (slugify removes dangerous characters)
    const date = new Date().toISOString().split('T')[0]
    const slug = slugify(sessionState.title)
    const folderName = `${date}-${slug}`

    // Use safe path function to prevent any path traversal
    const folderPath = getContentFolderSafe(folderName)

    // Create folder if doesn't exist
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true })
    }

    // Save markdown article
    atomicWriteSync(
      path.join(folderPath, 'article.md'),
      sessionState.article
    )

    // Save metadata
    const metadata = {
      title: sessionState.title,
      keywords: sessionState.keywords || [],
      metaDescription: sessionState.metaDescription || '',
      metaTitle: sessionState.metaTitle || sessionState.title,
      imageUrl: sessionState.imageUrl,
      inlineImages: sessionState.inlineImages || [],
      wordCount: sessionState.article.split(/\s+/).length,
      createdAt: new Date().toISOString(),
      projectSlug: projectSlug
    }
    atomicWriteSync(
      path.join(folderPath, 'metadata.json'),
      JSON.stringify(metadata, null, 2)
    )

    // Save workflow state for resuming
    if (sessionState.currentWorkflow) {
      atomicWriteSync(
        path.join(folderPath, 'workflow.json'),
        JSON.stringify({
          workflow: sessionState.currentWorkflow,
          stepResults: sessionState.stepResults,
          savedAt: new Date().toISOString()
        }, null, 2)
      )
    }

    // Store folder path in session
    sessionState.contentFolder = folderPath

    progress('Content', `Saved to folder: ${folderPath}`)
    return folderPath
  } catch (error) {
    log(`Warning: Failed to save content to folder: ${error.message}`)
    return null
  }
}

/**
 * Extract image prompts from article content
 * Looks for [IMAGE: description] placeholders
 * @param {string} content - Article content
 * @returns {string[]} Array of image prompt descriptions
 */
export function extractImagePromptsFromArticle(content) {
  const prompts = []
  const regex = /\[IMAGE:\s*([^\]]+)\]/gi
  let match

  while ((match = regex.exec(content)) !== null) {
    prompts.push(match[1].trim())
  }

  return prompts
}

/**
 * Inject image URLs into article content
 * Replaces [IMAGE: ...] placeholders with markdown images
 * @param {string} content - Article content with placeholders
 * @param {string[]} imageUrls - Array of image URLs to inject
 * @returns {string} Content with images injected
 */
export function injectImagesIntoContent(content, imageUrls) {
  let imageIndex = 0
  return content.replace(/\[IMAGE:\s*([^\]]+)\]/gi, (match, description) => {
    if (imageIndex < imageUrls.length) {
      const imgUrl = imageUrls[imageIndex]
      imageIndex++
      return `![${description.trim()}](${imgUrl})`
    }
    return match // Keep placeholder if no image available
  })
}
