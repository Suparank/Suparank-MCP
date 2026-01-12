/**
 * Suparank MCP - Tool Definitions
 *
 * All tool schemas for the MCP server:
 * - TOOLS: Backend tools (keyword research, content write, etc.)
 * - ACTION_TOOLS: Local tools requiring credentials (image gen, publishing)
 * - ORCHESTRATOR_TOOLS: Workflow management tools (create_content, session)
 * - VISIBLE_TOOLS: Subset of tools shown to clients
 */

// Backend research/content tools
export const TOOLS = [
  {
    name: 'keyword_research',
    description: `Research keywords for SEO. Use ONLY when user specifically asks for keyword research WITHOUT wanting full article creation.

TRIGGERS - Use when user says:
- "find keywords for..."
- "research keywords about..."
- "what keywords should I target for..."
- "keyword ideas for..."
- "analyze keywords for..."

DO NOT USE when user wants to write/create content - use create_content instead (it includes keyword research automatically).

OUTCOME: List of keywords with search volume, difficulty, and recommendations.`,
    inputSchema: {
      type: 'object',
      properties: {
        seed_keyword: {
          type: 'string',
          description: 'Starting keyword or topic to research (optional - uses project primary keywords if not specified)'
        },
        content_goal: {
          type: 'string',
          enum: ['traffic', 'conversions', 'brand-awareness'],
          description: 'Primary goal for the content strategy (optional - defaults to traffic)'
        },
        competitor_domain: {
          type: 'string',
          description: 'Optional: Competitor domain to analyze'
        }
      }
    }
  },
  {
    name: 'seo_strategy',
    description: 'Create comprehensive SEO strategy and content brief. Works with project keywords automatically if none specified.',
    inputSchema: {
      type: 'object',
      properties: {
        target_keyword: {
          type: 'string',
          description: 'Main keyword to target (optional - uses project primary keywords if not specified)'
        },
        content_type: {
          type: 'string',
          enum: ['guide', 'listicle', 'how-to', 'comparison', 'review'],
          description: 'Type of content to create (optional - defaults to guide)'
        },
        search_intent: {
          type: 'string',
          enum: ['informational', 'commercial', 'transactional', 'navigational'],
          description: 'Primary search intent to target (optional - auto-detected)'
        }
      }
    }
  },
  {
    name: 'topical_map',
    description: 'Design pillar-cluster content architecture for topical authority. Uses project niche and keywords automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        core_topic: {
          type: 'string',
          description: 'Main topic for the content cluster (optional - uses project niche if not specified)'
        },
        depth: {
          type: 'number',
          enum: [1, 2, 3],
          description: 'Depth of content cluster: 1 (pillar + 5 articles), 2 (+ subtopics), 3 (full hierarchy)',
          default: 2
        }
      }
    }
  },
  {
    name: 'content_calendar',
    description: 'Create editorial calendar and publication schedule. Uses project keywords and niche automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        time_period: {
          type: 'string',
          enum: ['week', 'month', 'quarter'],
          description: 'Planning period for the content calendar (optional - defaults to month)',
          default: 'month'
        },
        content_types: {
          type: 'array',
          items: { type: 'string' },
          description: 'Types of content to include (optional - defaults to blog)'
        },
        priority_keywords: {
          type: 'array',
          items: { type: 'string' },
          description: 'Keywords to prioritize (optional - uses project keywords)'
        }
      }
    }
  },
  {
    name: 'content_write',
    description: 'Write comprehensive, SEO-optimized blog articles. Creates engaging content with proper structure, internal links, and semantic optimization. Uses project brand voice and keywords automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Article title or headline (optional - can be generated from topic)'
        },
        target_keyword: {
          type: 'string',
          description: 'Primary keyword to optimize for (optional - uses project keywords)'
        },
        outline: {
          type: 'string',
          description: 'Optional: Article outline or structure (H2/H3 headings)'
        },
        tone: {
          type: 'string',
          enum: ['professional', 'casual', 'conversational', 'technical'],
          description: 'Writing tone (optional - uses project brand voice)'
        }
      }
    }
  },
  {
    name: 'image_prompt',
    description: 'Create optimized prompts for AI image generation. Designs prompts for blog hero images, section illustrations, and branded visuals. Uses project visual style and brand automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        image_purpose: {
          type: 'string',
          enum: ['hero', 'section', 'diagram', 'comparison', 'infographic'],
          description: 'Purpose of the image (optional - defaults to hero)',
          default: 'hero'
        },
        subject: {
          type: 'string',
          description: 'Main subject or concept for the image (optional - uses project niche)'
        },
        mood: {
          type: 'string',
          description: 'Optional: Desired mood (uses project visual style if not specified)'
        }
      }
    }
  },
  {
    name: 'internal_links',
    description: 'Develop strategic internal linking plan. Analyzes existing content and identifies linking opportunities for improved site architecture. Works with project content automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        current_page: {
          type: 'string',
          description: 'URL or title of the page to optimize (optional - can work with last created content)'
        },
        available_pages: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of existing pages to consider (optional - can analyze site automatically)'
        },
        link_goal: {
          type: 'string',
          enum: ['authority-building', 'user-navigation', 'conversion'],
          description: 'Primary goal for internal linking (optional - defaults to authority-building)'
        }
      }
    }
  },
  {
    name: 'schema_generate',
    description: 'Implement Schema.org structured data markup. Analyzes content to recommend and generate appropriate JSON-LD schemas for enhanced search visibility. Auto-detects page type if not specified.',
    inputSchema: {
      type: 'object',
      properties: {
        page_type: {
          type: 'string',
          enum: ['article', 'product', 'how-to', 'faq', 'review', 'organization'],
          description: 'Type of page to generate schema for (optional - auto-detected from content)'
        },
        content_summary: {
          type: 'string',
          description: 'Brief summary of the page content (optional - can analyze content)'
        }
      }
    }
  },
  {
    name: 'geo_optimize',
    description: 'Optimize content for AI search engines and Google SGE. Implements GEO (Generative Engine Optimization) best practices for LLM-friendly content. Works with project content automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        content_url: {
          type: 'string',
          description: 'URL or title of content to optimize (optional - can work with last created content)'
        },
        target_engines: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['chatgpt', 'perplexity', 'claude', 'gemini', 'google-sge']
          },
          description: 'AI search engines to optimize for (optional - defaults to all)',
          default: ['chatgpt', 'google-sge']
        }
      }
    }
  },
  {
    name: 'quality_check',
    description: 'Perform comprehensive pre-publish quality assurance. Checks grammar, SEO requirements, brand consistency, accessibility, and technical accuracy. Can review last created content automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'Full content to review (optional - can review last created content)'
        },
        check_type: {
          type: 'string',
          enum: ['full', 'seo-only', 'grammar-only', 'brand-only'],
          description: 'Type of quality check to perform (optional - defaults to full)',
          default: 'full'
        }
      }
    }
  },
  {
    name: 'full_pipeline',
    description: 'Execute complete 5-phase content creation pipeline. Orchestrates research, planning, creation, optimization, and quality checking in one workflow. Works with project configuration automatically - just describe what you need!',
    inputSchema: {
      type: 'object',
      properties: {
        seed_keyword: {
          type: 'string',
          description: 'Starting keyword for the pipeline (optional - uses project primary keywords and niche)'
        },
        content_type: {
          type: 'string',
          enum: ['guide', 'listicle', 'how-to', 'comparison', 'review'],
          description: 'Type of content to create (optional - defaults to guide)',
          default: 'guide'
        },
        skip_phases: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['research', 'planning', 'creation', 'optimization', 'quality']
          },
          description: 'Optional: Phases to skip in the pipeline'
        }
      }
    }
  }
]

// Action tools that require local credentials
export const ACTION_TOOLS = [
  {
    name: 'generate_image',
    description: `Generate AI images. Use when user wants to create, generate, or regenerate images.

TRIGGERS - Use when user says:
- "create an image for..."
- "generate image of..."
- "make a picture of..."
- "I need an image for..."
- "regenerate the image"
- "new hero image"
- "create thumbnail for..."

NOTE: create_content automatically generates images. Use this tool for:
- Regenerating/replacing images
- Creating standalone images
- Custom image requests outside content workflow

OUTCOME: AI-generated image URL ready for use.`,
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Detailed prompt for image generation'
        },
        style: {
          type: 'string',
          description: 'Style guidance (e.g., "minimalist", "photorealistic", "illustration")'
        },
        aspect_ratio: {
          type: 'string',
          enum: ['1:1', '16:9', '9:16', '4:3', '3:4'],
          description: 'Image aspect ratio',
          default: '16:9'
        }
      },
      required: ['prompt']
    },
    requiresCredential: 'image'
  },
  {
    name: 'publish_wordpress',
    description: 'Publish content directly to WordPress (supports .com and .org). Requires WordPress credentials in ~/.suparank/credentials.json',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Post title'
        },
        content: {
          type: 'string',
          description: 'Full post content (HTML or Markdown)'
        },
        status: {
          type: 'string',
          enum: ['draft', 'publish'],
          description: 'Publication status',
          default: 'draft'
        },
        categories: {
          type: 'array',
          items: { type: 'string' },
          description: 'Category names'
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tag names'
        },
        featured_image_url: {
          type: 'string',
          description: 'URL of featured image to upload'
        }
      },
      required: ['title', 'content']
    },
    requiresCredential: 'wordpress'
  },
  {
    name: 'publish_ghost',
    description: 'Publish content to Ghost CMS. Requires Ghost Admin API key in ~/.suparank/credentials.json',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Post title'
        },
        content: {
          type: 'string',
          description: 'Full post content (HTML or Markdown)'
        },
        status: {
          type: 'string',
          enum: ['draft', 'published'],
          description: 'Publication status',
          default: 'draft'
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tag names'
        },
        featured_image_url: {
          type: 'string',
          description: 'URL of featured image'
        }
      },
      required: ['title', 'content']
    },
    requiresCredential: 'ghost'
  },
  {
    name: 'send_webhook',
    description: 'Send data to configured webhooks (Make.com, n8n, Zapier, Slack). Requires webhook URLs in ~/.suparank/credentials.json',
    inputSchema: {
      type: 'object',
      properties: {
        webhook_type: {
          type: 'string',
          enum: ['default', 'make', 'n8n', 'zapier', 'slack'],
          description: 'Which webhook to use',
          default: 'default'
        },
        payload: {
          type: 'object',
          description: 'Data to send in the webhook'
        },
        message: {
          type: 'string',
          description: 'For Slack: formatted message text'
        }
      },
      required: ['webhook_type']
    },
    requiresCredential: 'webhooks'
  }
]

// Orchestrator tools for automated workflows
export const ORCHESTRATOR_TOOLS = [
  {
    name: 'create_content',
    description: `PRIMARY TOOL for content creation. Use this when user wants to write, create, or generate any content.

TRIGGERS - Use when user says:
- "write a blog post about..."
- "create an article about..."
- "I need content for..."
- "help me write about..."
- "generate a post on..."
- "make content about..."
- any request involving writing/creating/generating articles or blog posts

SINGLE ARTICLE (count=1): Creates, saves, and publishes 1 article automatically.

MULTIPLE ARTICLES (count>1): Creates a workflow with N separate article steps.
- Each article MUST be written and saved with save_content
- Progress tracked: "Article 1 of 5", "Article 2 of 5", etc.
- get_session shows "3/5 articles saved"
- Do NOT publish until ALL articles are saved
- After all saved, call publish_content to publish batch

WORKFLOW (automatic 4-phase):
1. RESEARCH: Keywords, SEO strategy, content calendar
2. CREATION: (write + save) × N articles
3. OPTIMIZATION: Quality check, GEO optimization
4. PUBLISHING: Generate images, publish all to CMS

OUTCOME: Complete article(s) written, optimized, and published to CMS.`,
    inputSchema: {
      type: 'object',
      properties: {
        request: {
          type: 'string',
          description: 'What content do you want? (e.g., "write a blog post about AI", "create 5 articles")'
        },
        count: {
          type: 'number',
          description: 'Number of articles to create (default: 1)',
          default: 1
        },
        publish_to: {
          type: 'array',
          items: { type: 'string', enum: ['ghost', 'wordpress', 'none'] },
          description: 'Where to publish (default: all configured CMS)',
          default: []
        },
        with_images: {
          type: 'boolean',
          description: 'Generate hero images (default: true)',
          default: true
        }
      }
    }
  },
  {
    name: 'save_content',
    description: `Save written article to session. Use after manually writing content outside create_content workflow.

TRIGGERS - Use when:
- You wrote an article manually and need to save it
- User says "save this article" / "save my content"
- Saving edited/revised content

NOTE: create_content saves automatically. Only use this for manual saves.

OUTCOME: Article saved to session, ready for publishing.`,
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Article title'
        },
        content: {
          type: 'string',
          description: 'Full article content (markdown)'
        },
        keywords: {
          type: 'array',
          items: { type: 'string' },
          description: 'Target keywords used'
        },
        meta_description: {
          type: 'string',
          description: 'SEO meta description'
        }
      },
      required: ['title', 'content']
    }
  },
  {
    name: 'publish_content',
    description: `Publish articles to WordPress/Ghost. Use when user wants to publish saved content.

TRIGGERS - Use when user says:
- "publish my article"
- "post this to WordPress/Ghost"
- "publish to my blog"
- "make it live"
- "publish as draft"

NOTE: create_content publishes automatically. Use this for:
- Manual publishing control
- Re-publishing edited content
- Publishing specific articles from session

OUTCOME: Article published to configured CMS platforms.`,
    inputSchema: {
      type: 'object',
      properties: {
        platforms: {
          type: 'array',
          items: { type: 'string', enum: ['ghost', 'wordpress', 'all'] },
          description: 'Platforms to publish to (default: all configured)',
          default: ['all']
        },
        status: {
          type: 'string',
          enum: ['draft', 'publish'],
          description: 'Publication status',
          default: 'draft'
        },
        category: {
          type: 'string',
          description: 'WordPress category name - pick the most relevant one from available categories shown in save_content response'
        },
        article_numbers: {
          type: 'array',
          items: { type: 'number' },
          description: 'Optional: Publish specific articles by number (1, 2, 3...). If not specified, publishes ALL unpublished articles.'
        }
      }
    }
  },
  {
    name: 'get_session',
    description: `View current session status. Shows saved articles, images, and publishing state.

TRIGGERS - Use when user says:
- "what's in my session"
- "show my articles"
- "what have I created"
- "session status"
- "list my saved content"

OUTCOME: List of all articles in session with their publish status.`,
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'remove_article',
    description: `Remove article(s) from session. Does NOT delete published content.

TRIGGERS - Use when user says:
- "remove article 2"
- "delete the second article"
- "remove that article"
- "discard article..."

OUTCOME: Specified article(s) removed from session.`,
    inputSchema: {
      type: 'object',
      properties: {
        article_numbers: {
          type: 'array',
          items: { type: 'number' },
          description: 'Article numbers to remove (1, 2, 3...). Use get_session to see article numbers.'
        }
      },
      required: ['article_numbers']
    }
  },
  {
    name: 'clear_session',
    description: `Clear ALL content from session. DESTRUCTIVE - removes all unpublished articles!

TRIGGERS - Use when user says:
- "clear my session"
- "start fresh"
- "remove all articles"
- "reset everything"
- "clear all content"

WARNING: Requires confirm: true. Does NOT affect already-published content.

OUTCOME: Empty session, ready for new content creation.`,
    inputSchema: {
      type: 'object',
      properties: {
        confirm: {
          type: 'boolean',
          description: 'Must be true to confirm clearing all content'
        }
      },
      required: ['confirm']
    }
  },
  {
    name: 'list_content',
    description: `List all saved content from disk. Shows past articles that can be loaded back.

TRIGGERS - Use when user says:
- "show my past articles"
- "list saved content"
- "what articles do I have"
- "show previous content"
- "find my old articles"

NOTE: Different from get_session - this shows DISK storage, not current session.

OUTCOME: List of saved article folders with titles and dates.`,
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Max number of articles to show (default: 20)',
          default: 20
        }
      }
    }
  },
  {
    name: 'load_content',
    description: `Load a saved article back into session for editing or re-publishing.

TRIGGERS - Use when user says:
- "load my article about..."
- "open the previous article"
- "bring back that article"
- "edit my old post about..."
- "reload article..."

WORKFLOW: Run list_content first to see available articles, then load by folder name.

OUTCOME: Article loaded into session, ready for optimization or re-publishing.`,
    inputSchema: {
      type: 'object',
      properties: {
        folder_name: {
          type: 'string',
          description: 'Folder name from list_content (e.g., "2026-01-09-my-article-title")'
        }
      },
      required: ['folder_name']
    }
  }
]

/**
 * ALL tools visible in the MCP tool list (23 total)
 * MCP protocol requires tools to be listed for clients to call them
 */
export const VISIBLE_TOOLS = [
  // Prompt Tools (11) - Backend API calls
  'keyword_research',   // Research keywords for SEO
  'seo_strategy',       // Create SEO strategy and content brief
  'topical_map',        // Design pillar-cluster content architecture
  'content_calendar',   // Create editorial calendar
  'content_write',      // Write SEO-optimized articles
  'image_prompt',       // Create prompts for AI image generation
  'internal_links',     // Develop internal linking plan
  'schema_generate',    // Generate Schema.org JSON-LD markup
  'geo_optimize',       // Optimize for AI search engines (GEO)
  'quality_check',      // Pre-publish quality assurance
  'full_pipeline',      // Complete 5-phase content pipeline

  // Action Tools (4) - Local execution with credentials
  'generate_image',     // Generate AI images (fal.ai, Gemini, wiro)
  'publish_wordpress',  // Publish to WordPress
  'publish_ghost',      // Publish to Ghost CMS
  'send_webhook',       // Send to Make.com, n8n, Zapier, Slack

  // Orchestrator Tools (8) - Workflow management
  'create_content',     // Main entry point - 4-phase workflow
  'save_content',       // Save article to session
  'publish_content',    // Publish saved articles
  'get_session',        // View session status
  'remove_article',     // Remove article from session
  'clear_session',      // Clear all session content
  'list_content',       // List saved content from disk
  'load_content'        // Load past content into session
]
