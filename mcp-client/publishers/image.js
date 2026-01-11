/**
 * Suparank MCP - Image Publisher
 *
 * AI image generation using fal.ai, Gemini, or Wiro
 */

import { log, progress } from '../utils/logging.js'
import { fetchWithRetry } from '../services/api.js'
import { getCredentials } from '../services/credentials.js'
import { sessionState, saveSession } from '../services/session-state.js'
import { incrementStat } from '../services/stats.js'
import { API_ENDPOINTS } from '../config.js'

/**
 * Generate an AI image using the configured provider
 * @param {object} args - Image generation arguments
 * @param {string} args.prompt - Image prompt
 * @param {string} [args.style] - Style guidance
 * @param {string} [args.aspect_ratio='16:9'] - Aspect ratio
 * @returns {Promise<object>} MCP response with image URL
 */
export async function executeImageGeneration(args) {
  const credentials = getCredentials()
  const provider = credentials.image_provider
  const config = credentials[provider]

  if (!config?.api_key) {
    throw new Error(`${provider} API key not configured`)
  }

  progress('Image', `Generating with ${provider}...`)

  const { prompt, style, aspect_ratio = '16:9' } = args
  const fullPrompt = style ? `${prompt}, ${style}` : prompt

  log(`Generating image with ${provider}: ${fullPrompt.substring(0, 50)}...`)

  switch (provider) {
    case 'fal':
      return generateWithFal(config, fullPrompt, aspect_ratio)

    case 'gemini':
      return generateWithGemini(config, fullPrompt, aspect_ratio)

    case 'wiro':
      return generateWithWiro(config, fullPrompt, aspect_ratio)

    default:
      throw new Error(`Unknown image provider: ${provider}`)
  }
}

/**
 * Generate image with fal.ai
 */
async function generateWithFal(config, fullPrompt, aspect_ratio) {
  const response = await fetchWithRetry(API_ENDPOINTS.fal, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${config.api_key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      prompt: fullPrompt,
      aspect_ratio: aspect_ratio,
      output_format: 'png',
      resolution: '1K',
      num_images: 1
    })
  }, 2, 60000) // 2 retries, 60s timeout for image generation

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`fal.ai error: ${error}`)
  }

  const result = await response.json()
  const imageUrl = result.images?.[0]?.url

  // Store in session for orchestrated workflows
  storeImageInSession(imageUrl)

  // Track stats
  incrementStat('images_generated')

  const imageNumber = 1 + sessionState.inlineImages.length
  const totalImages = sessionState.currentWorkflow?.settings?.total_images || 1
  const imageType = imageNumber === 1 ? 'Cover Image' : `Inline Image ${imageNumber - 1}`

  return {
    content: [{
      type: 'text',
      text: `# ✅ ${imageType} Generated (${imageNumber}/${totalImages})

**URL:** ${imageUrl}

**Prompt:** ${fullPrompt}
**Provider:** fal.ai (nano-banana-pro)
**Aspect Ratio:** ${aspect_ratio}

${imageNumber < totalImages ? `\n**Next:** Generate ${totalImages - imageNumber} more image(s).` : '\n**All images generated!** Proceed to publish.'}`
    }]
  }
}

/**
 * Generate image with Google Gemini
 */
async function generateWithGemini(config, fullPrompt, aspect_ratio) {
  const model = config.model || 'gemini-3-pro-image-preview'
  const response = await fetch(
    `${API_ENDPOINTS.gemini}/${model}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': config.api_key
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: fullPrompt }]
        }],
        generationConfig: {
          responseModalities: ['IMAGE'],
          imageConfig: {
            aspectRatio: aspect_ratio,
            imageSize: '1K'
          }
        }
      })
    }
  )

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Gemini error: ${error}`)
  }

  const result = await response.json()
  const imagePart = result.candidates?.[0]?.content?.parts?.find(p => p.inlineData)
  const imageData = imagePart?.inlineData?.data
  const mimeType = imagePart?.inlineData?.mimeType || 'image/png'

  if (!imageData) {
    throw new Error('No image data in Gemini response')
  }

  // Return base64 data URI
  const dataUri = `data:${mimeType};base64,${imageData}`

  // Track stats
  incrementStat('images_generated')

  return {
    content: [{
      type: 'text',
      text: `Image generated successfully!\n\n**Format:** Base64 Data URI\n**Prompt:** ${fullPrompt}\n**Provider:** Google Gemini (${model})\n**Aspect Ratio:** ${aspect_ratio}\n\n**Data URI:** ${dataUri.substring(0, 100)}...\n\n[Full base64 data: ${imageData.length} chars]`
    }]
  }
}

/**
 * Generate image with Wiro
 */
async function generateWithWiro(config, fullPrompt, aspect_ratio) {
  const crypto = await import('crypto')
  const apiKey = config.api_key
  const apiSecret = config.api_secret

  if (!apiSecret) {
    throw new Error('Wiro API secret not configured. Add api_secret to wiro config in ~/.suparank/credentials.json')
  }

  // Generate nonce and signature
  const nonce = Math.floor(Date.now() / 1000).toString()
  const signatureData = `${apiSecret}${nonce}`
  const signature = crypto.createHmac('sha256', apiKey)
    .update(signatureData)
    .digest('hex')

  const model = config.model || 'google/nano-banana-pro'

  // Submit task
  log(`Submitting wiro.ai task for model: ${model}`)
  const submitResponse = await fetch(`${API_ENDPOINTS.wiro}/Run/${model}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'x-nonce': nonce,
      'x-signature': signature
    },
    body: JSON.stringify({
      prompt: fullPrompt,
      aspectRatio: aspect_ratio,
      resolution: '1K',
      safetySetting: 'BLOCK_ONLY_HIGH'
    })
  })

  if (!submitResponse.ok) {
    const error = await submitResponse.text()
    throw new Error(`wiro.ai submit error: ${error}`)
  }

  const submitResult = await submitResponse.json()
  if (!submitResult.result || !submitResult.taskid) {
    throw new Error(`wiro.ai task submission failed: ${JSON.stringify(submitResult.errors)}`)
  }

  const taskId = submitResult.taskid
  log(`wiro.ai task submitted: ${taskId}`)

  // Poll for completion
  const maxAttempts = 60 // 60 seconds max
  const pollInterval = 2000 // 2 seconds

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(resolve => setTimeout(resolve, pollInterval))

    // Generate new signature for poll request
    const pollNonce = Math.floor(Date.now() / 1000).toString()
    const pollSignatureData = `${apiSecret}${pollNonce}`
    const pollSignature = crypto.createHmac('sha256', apiKey)
      .update(pollSignatureData)
      .digest('hex')

    const pollResponse = await fetch(API_ENDPOINTS.wiroTaskDetail, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'x-nonce': pollNonce,
        'x-signature': pollSignature
      },
      body: JSON.stringify({ taskid: taskId })
    })

    if (!pollResponse.ok) {
      log(`wiro.ai poll error: ${await pollResponse.text()}`)
      continue
    }

    const pollResult = await pollResponse.json()
    const task = pollResult.tasklist?.[0]

    if (!task) continue

    const status = task.status
    log(`wiro.ai task status: ${status}`)

    // Check for completion
    if (status === 'task_postprocess_end') {
      const imageUrl = task.outputs?.[0]?.url
      if (!imageUrl) {
        throw new Error('wiro.ai task completed but no output URL')
      }

      // Store in session for orchestrated workflows
      storeImageInSession(imageUrl)

      // Track stats
      incrementStat('images_generated')

      const imageNumber = 1 + sessionState.inlineImages.length
      const totalImages = sessionState.currentWorkflow?.settings?.total_images || 1
      const imageType = imageNumber === 1 ? 'Cover Image' : `Inline Image ${imageNumber - 1}`

      return {
        content: [{
          type: 'text',
          text: `# ✅ ${imageType} Generated (${imageNumber}/${totalImages})

**URL:** ${imageUrl}

**Prompt:** ${fullPrompt}
**Provider:** wiro.ai (${model})
**Aspect Ratio:** ${aspect_ratio}
**Processing Time:** ${task.elapsedseconds}s

${imageNumber < totalImages ? `\n**Next:** Generate ${totalImages - imageNumber} more image(s).` : '\n**All images generated!** Proceed to publish.'}`
        }]
      }
    }

    // Check for failure
    if (status === 'task_cancel') {
      throw new Error('wiro.ai task was cancelled')
    }
  }

  throw new Error('wiro.ai task timed out after 60 seconds')
}

/**
 * Store generated image URL in session
 * First image is cover, subsequent are inline
 */
function storeImageInSession(imageUrl) {
  if (!sessionState.imageUrl) {
    sessionState.imageUrl = imageUrl
  } else {
    sessionState.inlineImages.push(imageUrl)
  }
  saveSession()
}
