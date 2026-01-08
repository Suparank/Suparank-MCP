# Suparank MCP

AI-powered SEO content creation for your blog. Works with Claude Desktop, Cursor, and ChatGPT via the Model Context Protocol (MCP).

## Quick Start

```bash
npx suparank
```

Follow the setup wizard to connect your Suparank account.

## What is Suparank?

Suparank is a SaaS platform that helps you create SEO-optimized blog content using AI. This MCP (Model Context Protocol) client connects your AI assistant (Claude, Cursor, ChatGPT) to the Suparank platform.

**Features:**
- Keyword research and SEO strategy
- AI-powered content writing with your brand voice
- Automatic image generation (fal.ai, wiro.ai, Gemini)
- One-click publishing to WordPress and Ghost
- Webhook integrations (Make, n8n, Zapier, Slack)

## Installation

### Option 1: npx (Recommended)

No installation needed. Just run:

```bash
npx suparank
```

### Option 2: Global Install

```bash
npm install -g suparank
suparank
```

## Setup

1. **Create a Suparank account** at [suparank.io](https://suparank.io)

2. **Create a project** in the dashboard

3. **Get your API key** from Settings > API Keys

4. **Run setup:**
   ```bash
   npx suparank setup
   ```

5. **Add to your AI client:**

   **Claude Desktop** (`~/.config/claude/claude_desktop_config.json`):
   ```json
   {
     "mcpServers": {
       "suparank": {
         "command": "npx",
         "args": ["suparank"]
       }
     }
   }
   ```

   **Cursor** (MCP settings):
   ```json
   {
     "mcpServers": {
       "suparank": {
         "command": "npx",
         "args": ["suparank"]
       }
     }
   }
   ```

6. **Start creating content!**

   Just tell your AI: "Create a blog post about [your topic]"

## Commands

| Command | Description |
|---------|-------------|
| `npx suparank` | Run MCP server (or setup if first time) |
| `npx suparank setup` | Run setup wizard |
| `npx suparank credentials` | Configure local integrations |
| `npx suparank test` | Test API connection |
| `npx suparank session` | View current session state |
| `npx suparank clear` | Clear session state |
| `npx suparank help` | Show help |

## Local Integrations

Configure local credentials for additional features:

```bash
npx suparank credentials
```

### Image Generation

Generate AI images for your blog posts:

- **fal.ai** - Fast, high quality (recommended)
- **wiro.ai** - Google Imagen via API
- **Gemini** - Google AI directly

### WordPress Publishing

Publish directly to your WordPress site:

1. Install the [Suparank Connector plugin](https://suparank.io/wordpress-plugin)
2. Get the secret key from plugin settings
3. Add to credentials

### Ghost CMS Publishing

Publish directly to your Ghost blog:

1. Go to Ghost Admin > Settings > Integrations
2. Create a custom integration
3. Copy the Admin API key
4. Add to credentials

### Webhooks

Send notifications when content is published:

- Slack
- Make.com
- n8n
- Zapier

## Configuration Files

All configuration is stored in `~/.suparank/`:

```
~/.suparank/
├── config.json        # API key and project settings
├── credentials.json   # Local integrations (WordPress, Ghost, etc.)
├── session.json       # Current workflow state
└── content/           # Saved articles
```

## Available Tools

When connected to your AI assistant, Suparank provides these tools:

### SEO Research
- `keyword_research` - Keyword analysis and competitive research
- `seo_strategy` - Create SEO strategy and content briefs
- `topical_map` - Design pillar-cluster content architecture
- `content_calendar` - Plan editorial calendar

### Content Creation
- `content_write` - Write SEO-optimized articles
- `image_prompt` - Create AI image generation prompts
- `generate_image` - Generate images (requires credentials)

### SEO Optimization
- `internal_links` - Develop internal linking strategy
- `schema_generate` - Create JSON-LD structured data
- `geo_optimize` - Optimize for AI search engines (GEO)
- `quality_check` - Pre-publish quality assurance

### Workflow
- `create_content` - Main entry point (orchestrates full workflow)
- `save_content` - Save content to session
- `publish_content` - Publish to configured CMS
- `get_session` - View current session state

### Publishing
- `publish_wordpress` - Direct WordPress publishing
- `publish_ghost` - Direct Ghost CMS publishing
- `send_webhook` - Send to automation platforms

## Example Workflow

1. **Tell your AI what you want:**
   ```
   "Create a blog post about React hooks best practices"
   ```

2. **Suparank will:**
   - Research keywords
   - Create content outline
   - Write the article (following your brand voice)
   - Generate cover image
   - Publish to your CMS

3. **Review and publish** from your CMS dashboard

## Troubleshooting

### "Connection failed"

- Check your API key is valid
- Ensure your project slug is correct
- Verify internet connection

### "No credentials configured"

Run `npx suparank credentials` to set up local integrations.

### MCP not connecting

1. Restart your AI client
2. Check the MCP config path is correct
3. Ensure Node.js 18+ is installed

## Support

- **Documentation:** [suparank.io/docs](https://suparank.io/docs)
- **Issues:** [GitHub Issues](https://github.com/Suparank/Suparank-MCP/issues)
- **Email:** hello@suparank.io

## License

MIT License - see [LICENSE](LICENSE) for details.
