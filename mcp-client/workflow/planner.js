/**
 * Suparank MCP - Workflow Planner
 *
 * Builds multi-step workflow plans for content creation
 */

import { log } from '../utils/logging.js'
import { hasCredential, getExternalMCPs, getCompositionHints } from '../services/credentials.js'

/**
 * Validate project configuration
 * @param {object} config - Project configuration from database
 * @returns {{ warnings: string[] }} Validation result
 * @throws {Error} If required fields are missing
 */
export function validateProjectConfig(config) {
  const errors = []

  if (!config) {
    throw new Error('Project configuration not found. Please configure your project in the dashboard.')
  }

  // Check required fields
  if (!config.content?.default_word_count) {
    errors.push('Word count: Not set → Dashboard → Project Settings → Content')
  } else if (typeof config.content.default_word_count !== 'number' || config.content.default_word_count < 100) {
    errors.push('Word count: Must be at least 100 words')
  } else if (config.content.default_word_count > 10000) {
    errors.push('Word count: Maximum 10,000 words supported')
  }

  if (!config.brand?.voice) {
    errors.push('Brand voice: Not set → Dashboard → Project Settings → Brand')
  }

  if (!config.site?.niche) {
    errors.push('Niche: Not set → Dashboard → Project Settings → Site')
  }

  // Warnings (non-blocking but helpful)
  const warnings = []
  if (!config.seo?.primary_keywords?.length) {
    warnings.push('No primary keywords set - content may lack SEO focus')
  }
  if (!config.brand?.target_audience) {
    warnings.push('No target audience set - content may be too generic')
  }

  if (errors.length > 0) {
    throw new Error(`Project configuration incomplete:\n${errors.map(e => `  - ${e}`).join('\n')}`)
  }

  return { warnings }
}

/**
 * Build a workflow plan for content creation
 * @param {string} request - Content request description
 * @param {number} count - Number of articles to create
 * @param {string[]} publishTo - Platforms to publish to
 * @param {boolean} withImages - Whether to generate images
 * @param {object} project - Project configuration from database
 * @returns {object} Workflow plan object
 */
export function buildWorkflowPlan(request, count, publishTo, withImages, project) {
  const steps = []
  const hasGhost = hasCredential('ghost')
  const hasWordPress = hasCredential('wordpress')
  const hasImageGen = hasCredential('image')

  // Get project config from database - MUST be dynamic, no hardcoding
  const config = project?.config

  // Validate configuration with helpful messages
  const { warnings } = validateProjectConfig(config)
  if (warnings.length > 0) {
    log(`Config warnings: ${warnings.join('; ')}`)
  }

  // Extract all settings from project.config (database schema)
  const targetWordCount = config.content?.default_word_count

  // LOG ALL CONFIG VALUES FOR DEBUGGING
  log('=== PROJECT CONFIG VALUES ===')
  log(`Word Count Target: ${targetWordCount}`)
  log(`Reading Level: ${config.content?.reading_level}`)
  log(`Brand Voice: ${config.brand?.voice}`)
  log(`Target Audience: ${config.brand?.target_audience}`)
  log(`Primary Keywords: ${config.seo?.primary_keywords?.join(', ')}`)
  log(`Include Images: ${config.content?.include_images}`)
  log('=============================')

  // CRITICAL: Validate word count is set
  if (!targetWordCount || targetWordCount < 100) {
    log(`WARNING: Word count not properly set! Got: ${targetWordCount}`)
  }

  const readingLevel = config.content?.reading_level
  const includeImages = config.content?.include_images
  const brandVoice = config.brand?.voice
  const targetAudience = config.brand?.target_audience
  const differentiators = config.brand?.differentiators || []
  const visualStyle = config.visual_style?.image_aesthetic
  const brandColors = config.visual_style?.colors || []
  const primaryKeywords = config.seo?.primary_keywords || []
  const geoFocus = config.seo?.geo_focus
  const niche = config.site?.niche
  const siteName = config.site?.name
  const siteUrl = config.site?.url
  const siteDescription = config.site?.description

  // Calculate required images: 1 cover + 1 per 300 words (only if includeImages is true)
  const shouldGenerateImages = withImages && includeImages && hasImageGen
  const contentImageCount = shouldGenerateImages ? Math.floor(targetWordCount / 300) : 0
  const totalImages = shouldGenerateImages ? 1 + contentImageCount : 0 // cover + inline images

  // Format reading level for display (stored as number, display as "Grade X")
  const readingLevelDisplay = readingLevel ? `Grade ${readingLevel}` : 'Not set'

  // Format keywords for display
  const keywordsDisplay = primaryKeywords.length > 0 ? primaryKeywords.join(', ') : 'No keywords set'

  // Determine publish targets
  let targets = publishTo || []
  if (targets.length === 0 || targets.includes('all')) {
    targets = []
    if (hasGhost) targets.push('ghost')
    if (hasWordPress) targets.push('wordpress')
  }

  let stepNum = 0

  // Build dynamic MCP hints from local credentials (user-configured in credentials.json)
  const externalMcps = getExternalMCPs()
  const keywordResearchHints = getCompositionHints('keyword_research')

  let mcpInstructions = ''
  if (externalMcps.length > 0) {
    const mcpList = externalMcps.map(m => `- **${m.name}**: ${m.available_tools?.join(', ') || 'tools available'}`).join('\n')
    mcpInstructions = `\n**External MCPs Available (from your credentials.json):**\n${mcpList}`
    if (keywordResearchHints) {
      mcpInstructions += `\n\n**Integration Hint:** ${keywordResearchHints}`
    }
  }

  // ═══════════════════════════════════════════════════════════
  // RESEARCH PHASE
  // ═══════════════════════════════════════════════════════════

  stepNum++
  steps.push({
    step: stepNum,
    type: 'llm_execute',
    action: 'keyword_research',
    instruction: `Research keywords for: "${request}"

**Project Context (from database):**
- Site: ${siteName} (${siteUrl})
- Niche: ${niche}
- Description: ${siteDescription || 'Not set'}
- Primary keywords: ${keywordsDisplay}
- Geographic focus: ${geoFocus || 'Global'}
${mcpInstructions}

**Deliverables:**
- 1 primary keyword to target (lower difficulty preferred)
- 3-5 secondary/LSI keywords
- 2-3 question-based keywords for FAQ section`,
    store: 'keywords'
  })

  // Step 2: SEO Strategy & Content Brief
  stepNum++
  steps.push({
    step: stepNum,
    type: 'llm_execute',
    action: 'seo_strategy',
    instruction: `Create SEO strategy and content brief for: "${request}"

**Using Keywords from Step 1:**
- Use the primary keyword you identified
- Incorporate secondary/LSI keywords naturally

**Project Context:**
- Site: ${siteName}
- Niche: ${niche}
- Target audience: ${targetAudience || 'Not specified'}
- Brand voice: ${brandVoice}
- Geographic focus: ${geoFocus || 'Global'}

**Deliverables:**
1. **Search Intent Analysis** - What is the user trying to accomplish?
2. **Competitor Gap Analysis** - What are top 3 ranking pages missing?
3. **Content Brief:**
   - Recommended content type (guide/listicle/how-to/comparison)
   - Unique angle to differentiate from competitors
   - Key points to cover that competitors miss
4. **On-Page SEO Checklist:**
   - Title tag format
   - Meta description template
   - Header structure (H1, H2, H3)
   - Internal linking opportunities`,
    store: 'seo_strategy'
  })

  // Step 3: Topical Map (Content Architecture)
  stepNum++
  steps.push({
    step: stepNum,
    type: 'llm_execute',
    action: 'topical_map',
    instruction: `Design content architecture for: "${request}"

**Build a Pillar-Cluster Structure:**
- Main pillar topic (this article)
- Supporting cluster articles (future content opportunities)

**Project Context:**
- Site: ${siteName}
- Niche: ${niche}
- Primary keywords: ${keywordsDisplay}

**Deliverables:**
1. **Pillar Page Concept** - What should this main article establish?
2. **Cluster Topics** - 5-7 related subtopics for future articles
3. **Internal Linking Plan** - How these articles connect
4. **Content Gaps** - What topics are missing in this niche?

Note: Focus on the CURRENT article structure, but identify opportunities for a content cluster.`,
    store: 'topical_map'
  })

  // Step 4: Content Calendar (only for multi-article requests)
  if (count > 1) {
    stepNum++
    steps.push({
      step: stepNum,
      type: 'llm_execute',
      action: 'content_calendar',
      instruction: `Plan content calendar for ${count} articles about: "${request}"

**Project Context:**
- Site: ${siteName}
- Niche: ${niche}
- Articles to create: ${count}

**Deliverables:**
1. **Article Sequence** - Order to create articles (foundational → specific)
2. **Topic List** - ${count} specific titles/topics
3. **Keyword Assignment** - Primary keyword for each article
4. **Publishing Cadence** - Recommended frequency

Note: This guides the creation of all ${count} articles in this session.`,
      store: 'content_calendar'
    })
  }

  // ═══════════════════════════════════════════════════════════
  // CREATION PHASE
  // ═══════════════════════════════════════════════════════════

  // Step N: Content Planning with SEO Meta
  stepNum++
  steps.push({
    step: stepNum,
    type: 'llm_execute',
    action: 'content_planning',
    instruction: `Create a detailed content outline with SEO meta:

**Project Requirements (from database):**
- Site: ${siteName}
- Target audience: ${targetAudience || 'Not specified'}
- Brand voice: ${brandVoice}
- Brand differentiators: ${differentiators.length > 0 ? differentiators.join(', ') : 'Not set'}
- Word count: **${targetWordCount} words MINIMUM** (this is required!)
- Reading level: **${readingLevelDisplay}** (use simple sentences, avoid jargon)

**You MUST create:**

1. **SEO Meta Title** (50-60 characters, include primary keyword)
2. **SEO Meta Description** (150-160 characters, compelling, include keyword)
3. **URL Slug** (lowercase, hyphens, keyword-rich)
4. **Content Outline:**
   - H1: Main title
   - 6-8 H2 sections (to achieve ${targetWordCount} words)
   - H3 subsections where needed
   - FAQ section with 4-5 questions

${shouldGenerateImages ? `**Image Placeholders:** Mark where ${contentImageCount} inline images should go (1 every ~300 words)
Use format: [IMAGE: description of what image should show]` : '**Note:** Images disabled for this project.'}`,
    store: 'outline'
  })

  // Step: Write Content (generates N steps for N articles)
  for (let articleIndex = 0; articleIndex < count; articleIndex++) {
    const articleNum = articleIndex + 1
    const isFirstArticle = articleIndex === 0
    const isLastArticle = articleIndex === count - 1

    stepNum++
    steps.push({
      step: stepNum,
      type: 'llm_execute',
      action: 'content_write',
      instruction: `${count > 1 ? `## 📝 ARTICLE ${articleNum} OF ${count}\n\n` : ''}Write the COMPLETE article following your outline.
${count > 1 && !isFirstArticle ? `\n**Progress:** ${articleIndex} article(s) already saved. Now creating article ${articleNum}.` : ''}
${count > 1 ? `**Topic:** Use topic #${articleNum} from your content calendar.\n` : ''}
**MANDATORY WORD COUNT: ${targetWordCount} WORDS MINIMUM**
This is a strict requirement from the project settings.
The article will be REJECTED if under ${targetWordCount} words.

**Project Requirements (from Supabase database - DO NOT IGNORE):**
- Word count: **${targetWordCount} words** (MINIMUM - not a suggestion!)
- Reading level: **${readingLevelDisplay}** - Simple sentences, short paragraphs
- Brand voice: ${brandVoice}
- Target audience: ${targetAudience || 'General readers'}

**To reach ${targetWordCount} words, you MUST:**
- Write 8-10 substantial H2 sections (each 200-400 words)
- Include detailed examples, statistics, and actionable advice
- Add comprehensive FAQ section (5-8 questions)
- Expand each point with thorough explanations

**Content Structure:**
- Engaging hook in first 2 sentences
- All H2/H3 sections from your outline (expand each thoroughly!)
- Statistics, examples, and actionable tips in EVERY section
${shouldGenerateImages ? '- Image placeholders: [IMAGE: description] where images should go' : ''}
- FAQ section with 5-8 Q&As (detailed answers, not one-liners)
- Strong conclusion with clear CTA

**MANDATORY: After writing ${targetWordCount}+ words, call 'save_content' with:**
- title: Your SEO-optimized title
- content: The full article (markdown)
- keywords: Array of target keywords
- meta_description: Your 150-160 char meta description

STOP! Before calling save_content, verify you have ${targetWordCount}+ words.
Count the words. If under ${targetWordCount}, ADD MORE CONTENT.
${count > 1 && !isLastArticle ? `\n⚠️ After saving this article, you MUST continue with article ${articleNum + 1} of ${count}. Do NOT publish until all ${count} articles are saved.` : ''}
${count > 1 && isLastArticle ? `\n✅ This is the LAST article (${articleNum} of ${count}). After saving, all articles will be ready for publishing.` : ''}`,
      store: `article${count > 1 ? `_${articleNum}` : ''}`
    })
  }

  // ═══════════════════════════════════════════════════════════
  // OPTIMIZATION PHASE
  // ═══════════════════════════════════════════════════════════

  // Quality Check - Pre-publish QA
  stepNum++
  steps.push({
    step: stepNum,
    type: 'llm_execute',
    action: 'quality_check',
    instruction: `Perform quality check on the article you just saved.

**Quality Checklist:**

1. **SEO Check:**
   - Primary keyword in H1, first 100 words, URL slug
   - Secondary keywords distributed naturally
   - Meta title 50-60 characters
   - Meta description 150-160 characters
   - Proper header hierarchy (H1 → H2 → H3)

2. **Content Quality:**
   - Word count meets requirement (${targetWordCount}+ words)
   - Reading level appropriate (${readingLevelDisplay})
   - No grammar or spelling errors
   - Factual accuracy (no made-up statistics)

3. **Brand Consistency:**
   - Voice matches: ${brandVoice}
   - Speaks to: ${targetAudience || 'target audience'}
   - Aligns with ${siteName} brand

4. **Engagement:**
   - Strong hook in introduction
   - Clear value proposition
   - Actionable takeaways
   - Compelling CTA in conclusion

**Report any issues found and suggest fixes. If major issues exist, fix them before proceeding.**`,
    store: 'quality_report'
  })

  // GEO Optimize - AI Search Engine Optimization
  stepNum++
  steps.push({
    step: stepNum,
    type: 'llm_execute',
    action: 'geo_optimize',
    instruction: `Optimize article for AI search engines (ChatGPT, Perplexity, Google SGE, Claude).

**GEO (Generative Engine Optimization) Checklist:**

1. **Structured Answers:**
   - Clear, direct answers to common questions
   - Definition boxes for key terms
   - TL;DR sections for complex topics

2. **Citation-Worthy Content:**
   - Original statistics or data points
   - Expert quotes or authoritative sources
   - Unique insights not found elsewhere

3. **LLM-Friendly Structure:**
   - Bulleted lists for easy extraction
   - Tables for comparisons
   - Step-by-step numbered processes

4. **Semantic Clarity:**
   - Clear topic sentences per paragraph
   - Explicit cause-effect relationships
   - Avoid ambiguous pronouns

**Target AI Engines:**
- ChatGPT (conversational answers)
- Perplexity (citation-heavy)
- Google SGE (structured snippets)
- Claude (comprehensive analysis)

**Review the saved article and suggest specific improvements to make it more likely to be cited by AI search engines.**`,
    store: 'geo_report'
  })

  // ═══════════════════════════════════════════════════════════
  // PUBLISHING PHASE
  // ═══════════════════════════════════════════════════════════

  // Generate Images (if enabled in project settings AND credentials available)
  if (shouldGenerateImages) {
    // Format brand colors for image style guidance
    const colorsDisplay = brandColors.length > 0 ? brandColors.join(', ') : 'Not specified'

    stepNum++
    steps.push({
      step: stepNum,
      type: 'llm_execute',
      action: 'generate_images',
      instruction: `Generate ${totalImages} images for the article:

**Required Images:**
1. **Cover/Hero Image** - Main article header (16:9 aspect ratio)
${Array.from({length: contentImageCount}, (_, i) => `${i + 2}. **Section Image ${i + 1}** - For content section ${i + 1} (16:9 aspect ratio)`).join('\n')}

**For each image, call 'generate_image' tool with:**
- prompt: Detailed description based on article content
- style: ${visualStyle || 'professional minimalist'}
- aspect_ratio: 16:9

**Visual Style (from project database):**
- Image aesthetic: ${visualStyle || 'Not specified'}
- Brand colors: ${colorsDisplay}
- Keep consistent with ${siteName} brand identity

**Image Style Guide:**
- Professional, clean aesthetic
- Relevant to the section topic
- No text in images
- Consistent style across all images

After generating, note the URLs - they will be saved automatically for publishing.`,
      image_count: totalImages,
      store: 'images'
    })
  }

  // Step: Publish
  if (targets.length > 0) {
    stepNum++
    steps.push({
      step: stepNum,
      type: 'action',
      action: 'publish',
      instruction: `Publish the article to: ${targets.join(', ')}

Call 'publish_content' tool - it will automatically use:
- Saved article title and content
- SEO meta description
- Generated images (cover + inline)
- Target keywords as tags`,
      targets: targets
    })
  }

  return {
    workflow_id: `wf_${Date.now()}`,
    request: request,
    total_articles: count,
    current_article: 1,
    total_steps: steps.length,
    current_step: 1,
    // All settings come from project.config (database) - no hardcoded values
    project_info: {
      name: siteName,
      url: siteUrl,
      niche: niche
    },
    settings: {
      article_count: count,  // Track expected article count for progress
      target_word_count: targetWordCount,
      reading_level: readingLevel,
      reading_level_display: readingLevelDisplay,
      brand_voice: brandVoice,
      target_audience: targetAudience,
      include_images: includeImages,
      total_images: totalImages,
      content_images: contentImageCount,
      visual_style: visualStyle,
      primary_keywords: primaryKeywords,
      geo_focus: geoFocus
    },
    available_integrations: {
      external_mcps: externalMcps.map(m => m.name),
      ghost: hasGhost,
      wordpress: hasWordPress,
      image_generation: hasImageGen
    },
    steps: steps
  }
}
