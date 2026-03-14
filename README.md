# xctl - X/Twitter CLI

Single-file Node.js CLI for X/Twitter API v2. Zero dependencies. Just copy and run.

## Features

- Search recent tweets
- Read individual tweets (with fallback to markdown.new for articles)
- View user profiles and timelines
- Post tweets and replies (OAuth 1.0a)
- Check authenticated user info
- Output as pretty-print, plain text, or JSON

## Requirements

- Node.js 18+ (uses built-in `fetch` and `crypto`)
- X/Twitter API credentials (free developer account works for read operations)

## Setup

Set the following environment variables:

```bash
# Required for read operations (search, read, user, whoami)
export X_BEARER_TOKEN="your_bearer_token"

# Required for write operations (tweet, reply) and OAuth whoami
export X_CONSUMER_KEY="your_consumer_key"
export X_CONSUMER_SECRET="your_consumer_secret"
export X_ACCESS_TOKEN="your_access_token"
export X_ACCESS_TOKEN_SECRET="your_access_token_secret"
```

You can put these in a `.env` file and source it:

```bash
source .env
```

Or add them to your shell profile (`~/.zshrc`, `~/.bashrc`, etc.).

## Installation

```bash
# Download
curl -O https://raw.githubusercontent.com/anglim3/xctl/main/xctl.js

# Make executable
chmod +x xctl.js

# Copy to your PATH (optional)
sudo cp xctl.js /usr/local/bin/xctl
```

Or clone the repo:

```bash
git clone https://github.com/anglim3/xctl.git
cd xctl
chmod +x xctl.js
./xctl.js --help
```

## Usage

```
xctl <command> [options]
```

### Commands

#### `search <query> [-n count]`

Search recent tweets. Default 10 results, max 100.

```bash
xctl search "node.js tips" -n 20
xctl search "#bitcoin" -n 5 --json
```

#### `read <tweet-id-or-url>`

Fetch a specific tweet by ID or URL. Falls back to markdown.new for article-style tweets.

```bash
xctl read 1234567890123456789
xctl read https://x.com/user/status/1234567890123456789
```

#### `user <handle> [-n count]`

Get a user's profile and recent tweets.

```bash
xctl user elonmusk -n 10
xctl user @naval --json
```

#### `tweet <text>`

Post a tweet. Requires OAuth 1.0a credentials.

```bash
xctl tweet "Hello from xctl!"
```

#### `reply <tweet-id> <text>`

Reply to a tweet. Requires OAuth 1.0a credentials.

```bash
xctl reply 1234567890123456789 "Great point!"
```

#### `whoami`

Show the authenticated user. Uses OAuth 1.0a if credentials are set, falls back to Bearer token.

```bash
xctl whoami
xctl whoami --json
```

### Global Flags

| Flag | Description |
|------|-------------|
| `--json` | Output raw JSON |
| `--plain` | Minimal tab-separated output (good for scripting) |
| `-h, --help` | Show help |

## Getting API Credentials

1. Go to [developer.x.com](https://developer.x.com)
2. Create a new project and app (free tier is fine for read-only)
3. From your app settings, grab:
   - **Bearer Token** (for read operations)
   - **API Key & Secret** → `X_CONSUMER_KEY` / `X_CONSUMER_SECRET`
   - **Access Token & Secret** (from "Keys and tokens" tab) → `X_ACCESS_TOKEN` / `X_ACCESS_TOKEN_SECRET`

> Note: Free tier allows reading tweets. Posting requires Elevated access or a paid plan depending on your use case.

## Examples

```bash
# Search for recent Bitcoin news
xctl search "bitcoin" -n 5

# Read a specific tweet
xctl read https://x.com/user/status/1234567890

# Get user profile + last 20 tweets
xctl user pmarca -n 20

# Post a tweet
xctl tweet "Built something cool with xctl today"

# Get raw JSON for scripting
xctl search "openai" --json | jq '.tweets[].text'

# Plain output for grep/awk
xctl user dhh --plain | head -5
```

## License

MIT - do whatever you want with it.
