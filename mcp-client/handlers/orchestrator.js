/**
 * Suparank MCP - Orchestrator Tool Handler
 *
 * Handles workflow management tools (create_content, save_content, publish_content, etc.)
 */

import * as fs from 'fs'
import * as path from 'path'
import { log, progress } from '../utils/logging.js'
import {
  getContentDir,
  getContentFolderSafe
} from '../utils/paths.js'
import { saveContentToFolder, injectImagesIntoContent } from '../utils/content.js'
import {
  sessionState,
  saveSession,
  resetSession,
  generateArticleId
} from '../services/session-state.js'
import { incrementStat } from '../services/stats.js'
import { hasCredential } from '../services/credentials.js'
import { buildWorkflowPlan } from '../workflow/planner.js'
import {
  executeGhostPublish,
  executeWordPressPublish,
  fetchWordPressCategories
} from '../publishers/index.js'

/**
 * Execute an orchestrator tool
 * @param {string} toolName - Name of the orchestrator tool
 * @param {object} args - Tool arguments
 * @param {object} project - Project configuration from database
 * @returns {Promise<object>} MCP response
 */
export async function executeOrchestratorTool(toolName, args, project) {
  switch (toolName) {
    case 'create_content':
      return handleCreateContent(args, project)

    case 'save_content':
      return handleSaveContent(args)

    case 'publish_content':
      return handlePublishContent(args)

    case 'get_session':
      return handleGetSession()

    case 'remove_article':
      return handleRemoveArticle(args)

    case 'clear_session':
      return handleClearSession(args)

    case 'list_content':
      return handleListContent(args)

    case 'load_content':
      return handleLoadContent(args)

    default:
      throw new Error(`Unknown orchestrator tool: ${toolName}`)
  }
}

// ============================================================================
// Individual Tool Handlers
// ============================================================================

async function handleCreateContent(args, project) {
  resetSession()
  const { request = '', count = 1, publish_to = [], with_images = true } = args

  const plan = buildWorkflowPlan(
    request || `content about ${project?.niche || 'the project topic'}`,
    count,
    publish_to,
    with_images,
    project
  )

  sessionState.currentWorkflow = plan
  saveSession()

  // Build response with clear instructions
  const mcpList = plan.available_integrations.external_mcps.length > 0
    ? plan.available_integrations.external_mcps.join(', ')
    : 'None configured'

  let response = `# Content Creation Workflow Started

## PROJECT REQUIREMENTS (from Supabase database)
- Word Count: ${plan.settings.target_word_count} words (MINIMUM - strictly enforced!)
- Brand Voice: ${plan.settings.brand_voice || 'Not set'}
- Target Audience: ${plan.settings.target_audience || 'Not set'}

## Your Request
"${plan.request}"

## Project: ${plan.project_info.name}
- **URL:** ${plan.project_info.url}
- **Niche:** ${plan.project_info.niche}

## Content Settings (from database - DO NOT USE DEFAULTS)
| Setting | Value |
|---------|-------|
| **Word Count** | ${plan.settings.target_word_count} words |
| **Reading Level** | ${plan.settings.reading_level_display} |
| **Brand Voice** | ${plan.settings.brand_voice} |
| **Target Audience** | ${plan.settings.target_audience || 'Not specified'} |
| **Primary Keywords** | ${plan.settings.primary_keywords?.join(', ') || 'Not set'} |
| **Geographic Focus** | ${plan.settings.geo_focus || 'Global'} |
| **Visual Style** | ${plan.settings.visual_style || 'Not specified'} |
| **Include Images** | ${plan.settings.include_images ? 'Yes' : 'No'} |
| **Images Required** | ${plan.settings.total_images} (1 cover + ${plan.settings.content_images} inline) |

## Workflow Plan (4 Phases)

### RESEARCH PHASE
${plan.steps.filter(s => ['keyword_research', 'seo_strategy', 'topical_map', 'content_calendar'].includes(s.action)).map(s => `${s.step}. **${s.action}**`).join('\n')}

### CREATION PHASE
${plan.steps.filter(s => ['content_planning', 'content_write'].includes(s.action)).map(s => `${s.step}. **${s.action}**`).join('\n')}

### OPTIMIZATION PHASE
${plan.steps.filter(s => ['quality_check', 'geo_optimize'].includes(s.action)).map(s => `${s.step}. **${s.action}**`).join('\n')}

### PUBLISHING PHASE
${plan.steps.filter(s => ['generate_images', 'publish'].includes(s.action)).map(s => `${s.step}. **${s.action}**`).join('\n')}

## Available Integrations (from ~/.suparank/credentials.json)
- External MCPs: ${mcpList}
- Image Generation: ${plan.available_integrations.image_generation ? 'Ready' : 'Not configured'}
- Ghost CMS: ${plan.available_integrations.ghost ? 'Ready' : 'Not configured'}
- WordPress: ${plan.available_integrations.wordpress ? 'Ready' : 'Not configured'}

---

## Step 1 of ${plan.total_steps}: ${plan.steps[0].action.toUpperCase()}

${plan.steps[0].instruction}

---

**When you complete this step, move to Step 2.**
`

  return {
    content: [{
      type: 'text',
      text: response
    }]
  }
}

async function handleSaveContent(args) {
  const { title, content, keywords = [], meta_description = '' } = args
  const wordCount = content.split(/\s+/).length

  // Create article object with unique ID
  const articleId = generateArticleId()
  const newArticle = {
    id: articleId,
    title,
    content,
    keywords,
    metaDescription: meta_description,
    metaTitle: title,
    imageUrl: sessionState.imageUrl || null,
    inlineImages: [...sessionState.inlineImages],
    savedAt: new Date().toISOString(),
    published: false,
    publishedTo: [],
    wordCount
  }

  // Add to articles array
  sessionState.articles.push(newArticle)

  // Track stats
  incrementStat('articles_created')
  incrementStat('words_written', wordCount)

  // Also keep in current working fields for backwards compatibility
  sessionState.title = title
  sessionState.article = content
  sessionState.keywords = keywords
  sessionState.metaDescription = meta_description
  sessionState.metadata = { meta_description }

  // Persist session and save to folder
  saveSession()
  const contentFolder = saveContentToFolder()

  progress('Content', `Saved "${title}" (${wordCount} words) as article #${sessionState.articles.length}${contentFolder ? ` → ${contentFolder}` : ''}`)

  // Clear current working images for next article
  sessionState.imageUrl = null
  sessionState.inlineImages = []

  const workflow = sessionState.currentWorkflow
  const targetWordCount = workflow?.settings?.target_word_count
  const wordCountOk = targetWordCount ? wordCount >= targetWordCount * 0.95 : true
  const shortfall = targetWordCount ? targetWordCount - wordCount : 0

  log(`Word count check: ${wordCount} words (target: ${targetWordCount}, ok: ${wordCountOk})`)

  // Find next step info
  const imageStep = workflow?.steps?.find(s => s.action === 'generate_images')
  const totalImages = workflow?.settings?.total_images || 0
  const includeImages = workflow?.settings?.include_images

  // Fetch WordPress categories
  let categoriesSection = ''
  if (hasCredential('wordpress')) {
    const wpCategories = await fetchWordPressCategories()
    if (wpCategories && wpCategories.length > 0) {
      const categoryList = wpCategories
        .slice(0, 15)
        .map(c => `- **${c.name}** (${c.count} posts)${c.description ? `: ${c.description}` : ''}`)
        .join('\n')
      categoriesSection = `\n## WordPress Categories Available
Pick the most relevant category when publishing:
${categoryList}

When calling \`publish_content\`, include the \`category\` parameter with your choice.\n`
    }
  }

  // Show all articles in session
  const articlesListSection = sessionState.articles.length > 1 ? `
## Articles in Session (${sessionState.articles.length} total)
${sessionState.articles.map((art, i) => {
  const status = art.published ? `published to ${art.publishedTo.join(', ')}` : 'unpublished'
  return `${i + 1}. **${art.title}** (${art.wordCount} words) - ${status}`
}).join('\n')}

Use \`publish_content\` to publish all unpublished articles, or \`get_session\` to see full details.
` : ''

  return {
    content: [{
      type: 'text',
      text: `# Content Saved to Session (Article #${sessionState.articles.length})

**Title:** ${title}
**Article ID:** ${articleId}
**Word Count:** ${wordCount} words ${targetWordCount ? (wordCountOk ? '(ok)' : `(target: ${targetWordCount})`) : '(no target set)'}
**Meta Description:** ${meta_description ? `${meta_description.length} chars` : 'Missing!'}
**Keywords:** ${keywords.join(', ') || 'none specified'}
**Images:** ${newArticle.imageUrl ? '1 cover' : 'no cover'}${newArticle.inlineImages.length > 0 ? ` + ${newArticle.inlineImages.length} inline` : ''}

${targetWordCount && !wordCountOk ? `
**WORD COUNT NOT MET - ${shortfall} WORDS SHORT!**
Target: ${targetWordCount} words | Actual: ${wordCount} words

The article does not meet the project's word count requirement.
Please EXPAND the content before publishing.
` : ''}
${!meta_description ? '**Warning:** Meta description is missing. Add it for better SEO.\n' : ''}
${articlesListSection}${categoriesSection}
## Next Step${includeImages && imageStep ? ': Generate Images' : ': Ready to Publish or Continue'}
${includeImages && imageStep ? `Generate **${totalImages} images** (1 cover + ${totalImages - 1} inline images).

Call \`generate_image\` ${totalImages} times with prompts based on your article sections.` : `You can:
- **Add more articles**: Continue creating content (each save_content adds to the batch)
- **Publish all**: Call \`publish_content\` to publish all ${sessionState.articles.length} article(s)
- **View session**: Call \`get_session\` to see all saved articles`}`
    }]
  }
}

async function handlePublishContent(args) {
  const { platforms = ['all'], status = 'draft', category = '', article_numbers = [] } = args

  // Determine which articles to publish
  let articlesToPublish = []

  if (article_numbers && article_numbers.length > 0) {
    articlesToPublish = article_numbers
      .map(num => sessionState.articles[num - 1])
      .filter(art => art && !art.published)

    if (articlesToPublish.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `No valid unpublished articles found for numbers: ${article_numbers.join(', ')}

Use \`get_session\` to see available articles and their numbers.`
        }]
      }
    }
  } else {
    articlesToPublish = sessionState.articles.filter(art => !art.published)
  }

  // Fallback: Check if there's a current working article not yet saved
  if (articlesToPublish.length === 0 && sessionState.article && sessionState.title) {
    articlesToPublish = [{
      id: 'current',
      title: sessionState.title,
      content: sessionState.article,
      keywords: sessionState.keywords || [],
      metaDescription: sessionState.metaDescription || '',
      imageUrl: sessionState.imageUrl,
      inlineImages: sessionState.inlineImages
    }]
  }

  if (articlesToPublish.length === 0) {
    return {
      content: [{
        type: 'text',
        text: `No unpublished articles found in session.

Use \`save_content\` after writing an article, then call \`publish_content\`.
Or use \`get_session\` to see current session state.`
      }]
    }
  }

  const hasGhost = hasCredential('ghost')
  const hasWordPress = hasCredential('wordpress')
  const shouldPublishGhost = hasGhost && (platforms.includes('all') || platforms.includes('ghost'))
  const shouldPublishWordPress = hasWordPress && (platforms.includes('all') || platforms.includes('wordpress'))

  const allResults = []
  progress('Publishing', `Starting batch publish of ${articlesToPublish.length} article(s)`)

  for (let i = 0; i < articlesToPublish.length; i++) {
    const article = articlesToPublish[i]
    progress('Publishing', `Article ${i + 1}/${articlesToPublish.length}: "${article.title}"`)

    // Inject inline images
    const contentWithImages = injectImagesIntoContent(
      article.content,
      article.inlineImages || []
    )

    const articleResults = {
      article: article.title,
      articleId: article.id,
      wordCount: article.wordCount || contentWithImages.split(/\s+/).length,
      platforms: []
    }

    // Publish to Ghost
    if (shouldPublishGhost) {
      try {
        const ghostResult = await executeGhostPublish({
          title: article.title,
          content: contentWithImages,
          status: status,
          tags: article.keywords || [],
          featured_image_url: article.imageUrl
        })
        articleResults.platforms.push({ platform: 'Ghost', success: true, result: ghostResult })
      } catch (e) {
        articleResults.platforms.push({ platform: 'Ghost', success: false, error: e.message })
      }
    }

    // Publish to WordPress
    if (shouldPublishWordPress) {
      try {
        const categories = category ? [category] : []
        const wpResult = await executeWordPressPublish({
          title: article.title,
          content: contentWithImages,
          status: status,
          categories: categories,
          tags: article.keywords || [],
          featured_image_url: article.imageUrl
        })
        articleResults.platforms.push({ platform: 'WordPress', success: true, result: wpResult })
      } catch (e) {
        articleResults.platforms.push({ platform: 'WordPress', success: false, error: e.message })
      }
    }

    // Mark article as published
    const hasSuccess = articleResults.platforms.some(p => p.success)
    if (hasSuccess && article.id !== 'current') {
      const articleIndex = sessionState.articles.findIndex(a => a.id === article.id)
      if (articleIndex !== -1) {
        sessionState.articles[articleIndex].published = true
        sessionState.articles[articleIndex].publishedTo = articleResults.platforms
          .filter(p => p.success)
          .map(p => p.platform.toLowerCase())
        sessionState.articles[articleIndex].publishedAt = new Date().toISOString()
      }
    }

    allResults.push(articleResults)
  }

  saveSession()

  // Build response
  const totalArticles = allResults.length
  const successfulArticles = allResults.filter(r => r.platforms.some(p => p.success)).length
  const totalWords = allResults.reduce((sum, r) => sum + r.wordCount, 0)

  let response = `# Batch Publishing Results

## Summary
- **Articles Published:** ${successfulArticles}/${totalArticles}
- **Total Words:** ${totalWords.toLocaleString()}
- **Status:** ${status}
- **Platforms:** ${[shouldPublishGhost ? 'Ghost' : null, shouldPublishWordPress ? 'WordPress' : null].filter(Boolean).join(', ') || 'None'}
${category ? `- **Category:** ${category}` : ''}

---

`

  for (const result of allResults) {
    const hasAnySuccess = result.platforms.some(p => p.success)
    response += `## ${hasAnySuccess ? '[OK]' : '[FAILED]'} ${result.article}\n`
    response += `**Words:** ${result.wordCount}\n\n`

    for (const p of result.platforms) {
      if (p.success) {
        response += `**${p.platform}:** Published\n`
        const resultText = p.result?.content?.[0]?.text || ''
        const urlMatch = resultText.match(/https?:\/\/[^\s\)]+/)
        if (urlMatch) {
          response += `URL: ${urlMatch[0]}\n`
        }
      } else {
        response += `**${p.platform}:** Failed - ${p.error}\n`
      }
    }
    response += '\n'
  }

  const remainingUnpublished = sessionState.articles.filter(a => !a.published)
  if (remainingUnpublished.length > 0) {
    response += `---\n\n**${remainingUnpublished.length} article(s) still unpublished** in session.\n`
  } else if (sessionState.articles.length > 0) {
    response += `---\n\n**All ${sessionState.articles.length} articles published!**\n`
  }

  return {
    content: [{
      type: 'text',
      text: response
    }]
  }
}

function handleGetSession() {
  const totalImagesNeeded = sessionState.currentWorkflow?.settings?.total_images || 0
  const imagesGenerated = (sessionState.imageUrl ? 1 : 0) + sessionState.inlineImages.length
  const workflow = sessionState.currentWorkflow

  const totalArticles = sessionState.articles.length
  const unpublishedArticles = sessionState.articles.filter(a => !a.published)
  const publishedArticles = sessionState.articles.filter(a => a.published)
  const totalWords = sessionState.articles.reduce((sum, a) => sum + (a.wordCount || 0), 0)
  const totalImages = sessionState.articles.reduce((sum, a) => {
    return sum + (a.imageUrl ? 1 : 0) + (a.inlineImages?.length || 0)
  }, 0)

  const articlesSection = sessionState.articles.length > 0 ? `
## Saved Articles (${totalArticles} total)

| # | Title | Words | Images | Status |
|---|-------|-------|--------|--------|
${sessionState.articles.map((art, i) => {
  const imgCount = (art.imageUrl ? 1 : 0) + (art.inlineImages?.length || 0)
  const status = art.published ? `${art.publishedTo.join(', ')}` : 'Unpublished'
  return `| ${i + 1} | ${art.title.substring(0, 40)}${art.title.length > 40 ? '...' : ''} | ${art.wordCount} | ${imgCount} | ${status} |`
}).join('\n')}

**Summary:** ${totalWords.toLocaleString()} total words, ${totalImages} total images
**Unpublished:** ${unpublishedArticles.length} article(s) ready to publish
` : `
## Saved Articles
No articles saved yet. Use \`save_content\` after writing an article.
`

  const currentWorkingSection = sessionState.title && sessionState.article ? `
## Current Working Article
**Title:** ${sessionState.title}
**Word Count:** ${sessionState.article.split(/\s+/).length} words
**Meta Description:** ${sessionState.metaDescription || 'Not set'}
**Cover Image:** ${sessionState.imageUrl ? 'Generated' : 'Not yet'}
**Inline Images:** ${sessionState.inlineImages.length}

*This article is being edited. Call \`save_content\` to add it to the session.*
` : ''

  return {
    content: [{
      type: 'text',
      text: `# Session State

**Workflow:** ${workflow?.workflow_id || 'None active'}
**Total Articles:** ${totalArticles}
**Ready to Publish:** ${unpublishedArticles.length}
**Already Published:** ${publishedArticles.length}
${articlesSection}${currentWorkingSection}
## Current Working Images (${imagesGenerated}/${totalImagesNeeded})
**Cover Image:** ${sessionState.imageUrl || 'Not generated'}
**Inline Images:** ${sessionState.inlineImages.length > 0 ? sessionState.inlineImages.map((url, i) => `\n  ${i+1}. ${url.substring(0, 60)}...`).join('') : 'None'}

${workflow ? `
## Project Settings
- **Project:** ${workflow.project_info?.name || 'Unknown'}
- **Niche:** ${workflow.project_info?.niche || 'Unknown'}
- **Word Count Target:** ${workflow.settings?.target_word_count || 'Not set'}
- **Reading Level:** ${workflow.settings?.reading_level_display || 'Not set'}
- **Brand Voice:** ${workflow.settings?.brand_voice || 'Not set'}
- **Include Images:** ${workflow.settings?.include_images ? 'Yes' : 'No'}
` : ''}
## Actions
- **Publish all unpublished:** Call \`publish_content\`
- **Add more articles:** Use \`create_content\` or \`content_write\` then \`save_content\`
- **Remove articles:** Call \`remove_article\` with article numbers
- **Clear session:** Call \`clear_session\` with confirm: true`
    }]
  }
}

function handleRemoveArticle(args) {
  const { article_numbers } = args

  if (!article_numbers || article_numbers.length === 0) {
    return {
      content: [{
        type: 'text',
        text: `Please specify article numbers to remove. Use \`get_session\` to see article numbers.`
      }]
    }
  }

  const sortedNumbers = [...article_numbers].sort((a, b) => b - a)
  const removed = []
  const skipped = []

  for (const num of sortedNumbers) {
    const index = num - 1
    if (index < 0 || index >= sessionState.articles.length) {
      skipped.push({ num, reason: 'not found' })
      continue
    }

    const article = sessionState.articles[index]
    if (article.published) {
      skipped.push({ num, reason: 'already published', title: article.title })
      continue
    }

    const [removedArticle] = sessionState.articles.splice(index, 1)
    removed.push({ num, title: removedArticle.title })
  }

  saveSession()

  let response = `# Article Removal Results\n\n`

  if (removed.length > 0) {
    response += `## Removed (${removed.length})\n`
    for (const r of removed) {
      response += `- #${r.num}: "${r.title}"\n`
    }
    response += '\n'
  }

  if (skipped.length > 0) {
    response += `## Skipped (${skipped.length})\n`
    for (const s of skipped) {
      if (s.reason === 'already published') {
        response += `- #${s.num}: "${s.title}" (already published - cannot remove)\n`
      } else {
        response += `- #${s.num}: not found\n`
      }
    }
    response += '\n'
  }

  response += `---\n\n**${sessionState.articles.length} article(s) remaining in session.**`

  return {
    content: [{
      type: 'text',
      text: response
    }]
  }
}

function handleClearSession(args) {
  const { confirm } = args

  if (!confirm) {
    return {
      content: [{
        type: 'text',
        text: `**Clear Session requires confirmation**

This will permanently remove:
- ${sessionState.articles.length} saved article(s)
- All generated images
- Current workflow state

To confirm, call \`clear_session\` with \`confirm: true\``
      }]
    }
  }

  const articleCount = sessionState.articles.length
  const unpublishedCount = sessionState.articles.filter(a => !a.published).length

  resetSession()

  return {
    content: [{
      type: 'text',
      text: `# Session Cleared

Removed:
- ${articleCount} article(s) (${unpublishedCount} unpublished)
- All workflow state
- All generated images

Session is now empty. Ready for new content creation.`
    }]
  }
}

function handleListContent(args) {
  const { limit = 20 } = args
  const contentDir = getContentDir()

  if (!fs.existsSync(contentDir)) {
    return {
      content: [{
        type: 'text',
        text: `# Saved Content

No content directory found at \`${contentDir}\`.

Save articles using \`save_content\` and they will appear here.`
      }]
    }
  }

  const folders = fs.readdirSync(contentDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => {
      const folderPath = path.join(contentDir, dirent.name)
      const metadataPath = path.join(folderPath, 'metadata.json')

      let metadata = null
      if (fs.existsSync(metadataPath)) {
        try {
          metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'))
        } catch (e) {
          // Ignore parse errors
        }
      }

      return {
        name: dirent.name,
        path: folderPath,
        metadata,
        mtime: fs.statSync(folderPath).mtime
      }
    })
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit)

  if (folders.length === 0) {
    return {
      content: [{
        type: 'text',
        text: `# Saved Content

No saved articles found in \`${contentDir}\`.

Save articles using \`save_content\` and they will appear here.`
      }]
    }
  }

  let response = `# Saved Content (${folders.length} articles)

| # | Date | Title | Words | Project |
|---|------|-------|-------|---------|
`
  folders.forEach((folder, i) => {
    const date = folder.name.split('-').slice(0, 3).join('-')
    const title = folder.metadata?.title || folder.name.split('-').slice(3).join('-')
    const words = folder.metadata?.wordCount || '?'
    const project = folder.metadata?.projectSlug || '-'
    response += `| ${i + 1} | ${date} | ${title.substring(0, 35)}${title.length > 35 ? '...' : ''} | ${words} | ${project} |\n`
  })

  response += `
---

## To Load an Article

Call \`load_content\` with the folder name:
\`\`\`
load_content({ folder_name: "${folders[0]?.name}" })
\`\`\`

Once loaded, you can run optimization tools:
- \`quality_check\` - Pre-publish quality assurance
- \`geo_optimize\` - AI search engine optimization
- \`internal_links\` - Internal linking suggestions
- \`schema_generate\` - JSON-LD structured data
- \`save_content\` - Re-save with changes
- \`publish_content\` - Publish to CMS`

  return {
    content: [{
      type: 'text',
      text: response
    }]
  }
}

function handleLoadContent(args) {
  const { folder_name } = args

  if (!folder_name) {
    return {
      content: [{
        type: 'text',
        text: `Please specify a folder_name. Use \`list_content\` to see available articles.`
      }]
    }
  }

  // Sanitize folder_name to prevent path traversal
  let folderPath
  try {
    folderPath = getContentFolderSafe(folder_name)
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `Invalid folder name: ${error.message}`
      }]
    }
  }

  if (!fs.existsSync(folderPath)) {
    return {
      content: [{
        type: 'text',
        text: `Folder not found: \`${folder_name}\`

Use \`list_content\` to see available articles.`
      }]
    }
  }

  const articlePath = path.join(folderPath, 'article.md')
  const metadataPath = path.join(folderPath, 'metadata.json')

  if (!fs.existsSync(articlePath)) {
    return {
      content: [{
        type: 'text',
        text: `No article.md found in \`${folder_name}\``
      }]
    }
  }

  const articleContent = fs.readFileSync(articlePath, 'utf-8')
  let metadata = {}
  if (fs.existsSync(metadataPath)) {
    try {
      metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'))
    } catch (e) {
      log(`Warning: Failed to parse metadata.json: ${e.message}`)
    }
  }

  // Load into session state
  sessionState.title = metadata.title || folder_name
  sessionState.article = articleContent
  sessionState.keywords = metadata.keywords || []
  sessionState.metaDescription = metadata.metaDescription || ''
  sessionState.metaTitle = metadata.metaTitle || metadata.title || folder_name
  sessionState.imageUrl = metadata.imageUrl || null
  sessionState.inlineImages = metadata.inlineImages || []
  sessionState.contentFolder = folderPath

  // Add to articles array if not already there
  const existingIndex = sessionState.articles.findIndex(a => a.title === sessionState.title)
  if (existingIndex === -1) {
    const loadedArticle = {
      id: generateArticleId(),
      title: sessionState.title,
      content: articleContent,
      keywords: sessionState.keywords,
      metaDescription: sessionState.metaDescription,
      metaTitle: sessionState.metaTitle,
      imageUrl: sessionState.imageUrl,
      inlineImages: sessionState.inlineImages,
      savedAt: metadata.createdAt || new Date().toISOString(),
      published: false,
      publishedTo: [],
      wordCount: articleContent.split(/\s+/).length,
      loadedFrom: folderPath
    }
    sessionState.articles.push(loadedArticle)
  }

  saveSession()

  const wordCount = articleContent.split(/\s+/).length
  progress('Content', `Loaded "${sessionState.title}" (${wordCount} words) from ${folder_name}`)

  return {
    content: [{
      type: 'text',
      text: `# Content Loaded

**Title:** ${sessionState.title}
**Word Count:** ${wordCount}
**Keywords:** ${sessionState.keywords.join(', ') || 'None'}
**Meta Description:** ${sessionState.metaDescription ? `${sessionState.metaDescription.length} chars` : 'None'}
**Cover Image:** ${sessionState.imageUrl ? 'Yes' : 'No'}
**Inline Images:** ${sessionState.inlineImages.length}
**Source:** \`${folderPath}\`

---

## Now you can run optimization tools:

- **\`quality_check\`** - Pre-publish quality assurance
- **\`geo_optimize\`** - Optimize for AI search engines (ChatGPT, Perplexity)
- **\`internal_links\`** - Get internal linking suggestions
- **\`schema_generate\`** - Generate JSON-LD structured data
- **\`save_content\`** - Re-save after making changes
- **\`publish_content\`** - Publish to WordPress/Ghost

Article is now in session (#${sessionState.articles.length}) and ready for further processing.`
    }]
  }
}
