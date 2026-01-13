# Suparank MCP

[![npm version](https://badge.fury.io/js/suparank.svg)](https://www.npmjs.com/package/suparank)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

AI-powered SEO content creation MCP (Model Context Protocol) for Claude, Cursor, and other AI assistants.

## Features

- **19 SEO Tools** - Keyword research, content writing, optimization, and more
- **Multi-Platform Publishing** - WordPress, Ghost, webhooks
- **Image Generation** - fal.ai, Google Gemini, Wiro integration
- **Session Management** - Save and resume content workflows
- **Interactive Setup** - Simple CLI wizards for configuration

## Quick Start

### 1. Create Account

Sign up at [app.suparank.io](https://app.suparank.io) and create a project.

### 2. Install & Setup

```bash
npx suparank setup
```

This opens your browser for authentication and automatically configures your API key.

### 3. Configure Your AI Client

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):

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

**Cursor** (Settings → MCP Servers):

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

### 4. Configure Integrations (Optional)

```bash
npx suparank secrets
```

Interactive wizard to configure:
- **Image Generation** - fal.ai, Google Gemini, Wiro
- **WordPress** - Publish directly to your WordPress site
- **Ghost** - Publish to Ghost blogs
- **Webhooks** - Make, n8n, Zapier, Slack integrations

## CLI Commands

| Command | Description |
|---------|-------------|
| `npx suparank` | Start MCP server |
| `npx suparank setup` | Run setup wizard |
| `npx suparank secrets` | Configure API keys & integrations |
| `npx suparank test` | Test API connection |
| `npx suparank session` | View current session |
| `npx suparank clear` | Clear session state |
| `npx suparank update` | Clear cache & update to latest |

## Available Tools

### SEO Research
- `keyword_research` - Find keywords with search volume and difficulty
- `seo_strategy` - Create comprehensive SEO strategies
- `topical_map` - Build topic clusters for authority
- `content_calendar` - Plan content schedules

### Content Creation
- `content_write` - Write SEO-optimized articles
- `image_prompt` - Generate prompts for AI images
- `generate_image` - Create images with fal.ai/Gemini/Wiro

### Content Optimization
- `internal_links` - Find internal linking opportunities
- `schema_generate` - Create JSON-LD schema markup
- `geo_optimize` - Optimize for local SEO
- `quality_check` - Check content quality and SEO

### Publishing
- `save_content` - Save content to session
- `publish_content` - Publish to configured platforms
- `publish_wordpress` - Direct WordPress publishing
- `publish_ghost` - Direct Ghost publishing
- `send_webhook` - Send to automation platforms

### Pipeline
- `full_pipeline` - Complete content workflow
- `create_content` - Start new content session

## Configuration Files

All configuration is stored in `~/.suparank/`:

```
~/.suparank/
├── config.json         # API key & project slug
├── credentials.json    # Integration credentials
├── session.json        # Current workflow state
└── content/            # Saved articles
```

### credentials.json Example

```json
{
  "image_provider": "fal",
  "fal": {
    "api_key": "your-fal-key",
    "model": "fal-ai/flux-pro/v1.1"
  },
  "wordpress": {
    "site_url": "https://your-site.com",
    "secret_key": "from-wordpress-plugin"
  },
  "webhooks": {
    "make_url": "https://hook.make.com/xxx"
  }
}
```

## WordPress Integration

1. Install the [Suparank WordPress Plugin](https://github.com/Suparank/Suparank-WordPress-Plugin)
2. Copy your secret key from Settings → Suparank
3. Run `npx suparank secrets` and select WordPress

## Updating

To update to the latest version:

```bash
npx suparank update
```

This clears the npx cache and ensures you get the newest version on next run.

## Documentation

Full documentation at [suparank.io/docs](https://suparank.io/docs)

## Support

- **Docs:** [suparank.io/docs](https://suparank.io/docs)
- **Issues:** [GitHub Issues](https://github.com/Suparank/Suparank-MCP/issues)
- **Email:** hello@suparank.io

## Related Repositories

- [Suparank-API](https://github.com/Suparank/Suparank-API) - Backend API
- [Suparank-WordPress-Plugin](https://github.com/Suparank/Suparank-WordPress-Plugin) - WordPress integration

## License

MIT License - see [LICENSE](LICENSE) for details.
