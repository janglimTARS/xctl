#!/usr/bin/env node

const crypto = require('node:crypto');

const API_ORIGIN = 'https://api.x.com';
const MARKDOWN_NEW_ORIGIN = 'https://markdown.new';

const HELP_TEXT = `xctl - X/Twitter CLI (official X API v2)

Usage:
  xctl <command> [options]

Commands:
  read <tweet-id-or-url>         Fetch a tweet (URL inputs can fall back to markdown.new)
  search <query> [-n count]      Search recent tweets (default 10, max 100)
  user <handle> [-n count]       Get recent tweets from a user
  home                           Home timeline (stub; needs OAuth 2.0 user context)
  mentions                       Mentions timeline (stub; needs OAuth 2.0 user context)
  tweet <text>                   Post a tweet (OAuth 1.0a)
  reply <tweet-id> <text>        Reply to a tweet (OAuth 1.0a)
  retweet <tweet-id-or-url>      Retweet a tweet (OAuth 1.0a)
  quote <tweet-id-or-url> "text" Quote a tweet with your text (OAuth 1.0a)
  delete <tweet-id-or-url>       Delete a tweet (OAuth 1.0a)
  whoami                         Show authenticated user info

Global flags:
  --plain                        Minimal text output
  --json                         JSON output
  -h, --help                     Show help

Environment variables:
  X_BEARER_TOKEN                 Bearer token for app-only endpoints
  X_CONSUMER_KEY                 OAuth 1.0a consumer key
  X_CONSUMER_SECRET              OAuth 1.0a consumer secret
  X_ACCESS_TOKEN                 OAuth 1.0a access token
  X_ACCESS_TOKEN_SECRET          OAuth 1.0a access token secret
`;

function parseGlobalArgs(argv) {
  let format = 'pretty';
  let help = false;
  const positional = [];

  for (const arg of argv) {
    if (arg === '--json') {
      format = 'json';
    } else if (arg === '--plain') {
      format = 'plain';
    } else if (arg === '-h' || arg === '--help') {
      help = true;
    } else {
      positional.push(arg);
    }
  }

  const [command, ...args] = positional;
  return { command, args, format, help };
}

function parseCountArg(args, defaultCount = 10) {
  let count = defaultCount;
  const rest = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '-n' || arg === '--count') {
      const next = args[i + 1];
      if (!next) {
        throw new Error('Missing value for -n/--count');
      }
      count = Number.parseInt(next, 10);
      i += 1;
      continue;
    }
    if (arg.startsWith('-n=')) {
      count = Number.parseInt(arg.slice(3), 10);
      continue;
    }
    rest.push(arg);
  }

  if (!Number.isFinite(count) || count < 1) {
    throw new Error('Count must be a positive integer');
  }

  return {
    count: Math.min(100, count),
    rest,
  };
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function hasOAuth1Creds() {
  return Boolean(
    process.env.X_CONSUMER_KEY &&
    process.env.X_CONSUMER_SECRET &&
    process.env.X_ACCESS_TOKEN &&
    process.env.X_ACCESS_TOKEN_SECRET,
  );
}

function getOAuth1Creds() {
  return {
    consumerKey: requireEnv('X_CONSUMER_KEY'),
    consumerSecret: requireEnv('X_CONSUMER_SECRET'),
    accessToken: requireEnv('X_ACCESS_TOKEN'),
    accessTokenSecret: requireEnv('X_ACCESS_TOKEN_SECRET'),
  };
}

function rfc3986Encode(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function buildOAuth1Header(method, url, creds, extraBodyParams = {}) {
  const oauthParams = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.accessToken,
    oauth_version: '1.0',
  };

  const signatureParams = [];

  for (const [k, v] of url.searchParams.entries()) {
    signatureParams.push([k, v]);
  }

  for (const [k, v] of Object.entries(extraBodyParams || {})) {
    signatureParams.push([k, v]);
  }

  for (const [k, v] of Object.entries(oauthParams)) {
    signatureParams.push([k, v]);
  }

  signatureParams.sort((a, b) => {
    const ak = rfc3986Encode(a[0]);
    const bk = rfc3986Encode(b[0]);
    if (ak < bk) return -1;
    if (ak > bk) return 1;
    const av = rfc3986Encode(a[1]);
    const bv = rfc3986Encode(b[1]);
    if (av < bv) return -1;
    if (av > bv) return 1;
    return 0;
  });

  const normalizedParams = signatureParams
    .map(([k, v]) => `${rfc3986Encode(k)}=${rfc3986Encode(v)}`)
    .join('&');

  const baseUrl = `${url.origin}${url.pathname}`;
  const baseString = [
    method.toUpperCase(),
    rfc3986Encode(baseUrl),
    rfc3986Encode(normalizedParams),
  ].join('&');

  const signingKey = `${rfc3986Encode(creds.consumerSecret)}&${rfc3986Encode(creds.accessTokenSecret)}`;

  const signature = crypto
    .createHmac('sha1', signingKey)
    .update(baseString)
    .digest('base64');

  const headerParams = {
    ...oauthParams,
    oauth_signature: signature,
  };

  return `OAuth ${Object.entries(headerParams)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${rfc3986Encode(k)}="${rfc3986Encode(v)}"`)
    .join(', ')}`;
}

function formatApiError(status, data) {
  if (data && typeof data === 'object') {
    if (Array.isArray(data.errors) && data.errors.length) {
      const details = data.errors
        .map((e) => e.detail || e.message || JSON.stringify(e))
        .join('; ');
      return `HTTP ${status}: ${details}`;
    }

    if (data.title || data.detail || data.type) {
      const title = data.title || 'API error';
      const detail = data.detail ? ` - ${data.detail}` : '';
      return `HTTP ${status}: ${title}${detail}`;
    }
  }

  if (typeof data === 'string' && data.trim()) {
    return `HTTP ${status}: ${data.trim()}`;
  }

  return `HTTP ${status}`;
}

async function apiRequest(method, urlOrPath, { query, headers, body } = {}) {
  const url = new URL(urlOrPath.startsWith('http') ? urlOrPath : `${API_ORIGIN}${urlOrPath}`);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }

  const requestHeaders = {
    'User-Agent': 'xctl/1.0',
    ...(headers || {}),
  };

  let requestBody;
  if (body !== undefined) {
    requestBody = JSON.stringify(body);
    if (!requestHeaders['Content-Type']) {
      requestHeaders['Content-Type'] = 'application/json';
    }
  }

  const response = await fetch(url, {
    method,
    headers: requestHeaders,
    body: requestBody,
  });

  const raw = await response.text();
  let data = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = raw;
    }
  }

  if (!response.ok) {
    const error = new Error(formatApiError(response.status, data));
    error.status = response.status;
    error.payload = data;
    throw error;
  }

  return data;
}

async function apiRequestBearer(method, path, { query, body } = {}) {
  const token = requireEnv('X_BEARER_TOKEN');
  return apiRequest(method, path, {
    query,
    body,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

async function apiRequestOAuth1(method, path, { query, body } = {}) {
  const creds = getOAuth1Creds();
  const url = new URL(`${API_ORIGIN}${path}`);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }

  const authHeader = buildOAuth1Header(method, url, creds);

  return apiRequest(method, url.toString(), {
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
    },
    body,
  });
}

function extractTweetId(input) {
  const value = String(input || '').trim();
  if (/^\d+$/.test(value)) {
    return value;
  }

  // Match /status/<id> URLs
  const statusMatch = value.match(/status\/(\d+)/i);
  if (statusMatch) {
    return statusMatch[1];
  }

  // Match /i/article/<id> URLs
  const articleMatch = value.match(/\/i\/article\/(\d+)/i);
  if (articleMatch) {
    return articleMatch[1];
  }

  throw new Error(`Could not parse tweet ID from: ${input}`);
}

function parseTweetUrl(input) {
  const value = String(input || '').trim();
  if (!/^https?:\/\//i.test(value)) {
    return null;
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./i, '').toLowerCase();
  if (host !== 'x.com' && host !== 'twitter.com') {
    return null;
  }

  const match = url.pathname.match(/^\/([^/]+)\/status\/(\d+)/i);
  if (!match) {
    return null;
  }

  const username = match[1];
  const tweetId = match[2];
  return `https://${host}/${username}/status/${tweetId}`;
}

async function fetchMarkdownNew(targetUrl, { method = 'auto', retainImages = false } = {}) {
  const url = new URL(`${MARKDOWN_NEW_ORIGIN}/${targetUrl}`);

  if (method) {
    url.searchParams.set('method', method);
  }

  if (retainImages) {
    url.searchParams.set('retain_images', 'true');
  }

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'xctl/1.0',
      Accept: 'text/plain, text/markdown;q=0.9, */*;q=0.8',
    },
  });

  const text = await response.text();
  if (!response.ok) {
    const detail = text.trim() || `HTTP ${response.status}`;
    throw new Error(`markdown.new request failed (${response.status}): ${detail}`);
  }

  return text;
}

function userMapFromIncludes(includes) {
  const map = new Map();
  if (!includes || !Array.isArray(includes.users)) {
    return map;
  }

  for (const user of includes.users) {
    map.set(user.id, user);
  }
  return map;
}

function normalizeTweet(tweet, userMap = new Map(), fallbackAuthor = null) {
  const author = userMap.get(tweet.author_id) || fallbackAuthor || null;
  const username = author?.username || 'unknown';

  return {
    id: tweet.id,
    text: tweet.note_tweet?.text || tweet.text,
    created_at: tweet.created_at || null,
    metrics: {
      reply_count: tweet.public_metrics?.reply_count ?? 0,
      retweet_count: tweet.public_metrics?.retweet_count ?? 0,
      like_count: tweet.public_metrics?.like_count ?? 0,
      quote_count: tweet.public_metrics?.quote_count ?? 0,
    },
    article: tweet.article || null,
    author: author
      ? {
          id: author.id,
          name: author.name,
          username: author.username,
        }
      : null,
    url: `https://x.com/${username}/status/${tweet.id}`,
  };
}

function oneLine(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function printTweetPretty(tweet, index = null) {
  const prefix = index === null ? '' : `${index}. `;
  const authorName = tweet.author?.name || 'Unknown';
  const username = tweet.author?.username || 'unknown';
  const created = tweet.created_at || 'unknown-date';

  console.log(`${prefix}${authorName} (@${username})`);
  console.log(`   ${created}`);
  console.log(`   ${tweet.text.split('\n').join('\n   ')}`);
  console.log(
    `   ♥ ${tweet.metrics.like_count}  🔁 ${tweet.metrics.retweet_count}  💬 ${tweet.metrics.reply_count}  🗨 ${tweet.metrics.quote_count}`,
  );
  console.log(`   ${tweet.url}`);
}

function printTweets(tweets, format) {
  if (format === 'json') {
    console.log(JSON.stringify(tweets, null, 2));
    return;
  }

  if (!Array.isArray(tweets) || tweets.length === 0) {
    console.log('No tweets found.');
    return;
  }

  if (format === 'plain') {
    for (const tweet of tweets) {
      const username = tweet.author?.username || 'unknown';
      console.log(`${tweet.id}\t@${username}\t${tweet.created_at || ''}\t${oneLine(tweet.text)}`);
    }
    return;
  }

  tweets.forEach((tweet, idx) => {
    printTweetPretty(tweet, idx + 1);
    if (idx < tweets.length - 1) console.log('');
  });
}

function printObject(obj, format) {
  if (format === 'json') {
    console.log(JSON.stringify(obj, null, 2));
    return;
  }

  if (format === 'plain') {
    if (obj && typeof obj === 'object') {
      for (const [k, v] of Object.entries(obj)) {
        console.log(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
      }
    } else {
      console.log(String(obj));
    }
    return;
  }

  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      console.log(`${k}: ${typeof v === 'object' ? JSON.stringify(v, null, 2) : v}`);
    }
  } else {
    console.log(String(obj));
  }
}

function printStub(command, format) {
  const msg = {
    command,
    implemented: false,
    note: `${command} requires OAuth 2.0 user context (PKCE) and is currently a stub.`,
  };

  if (format === 'json') {
    console.log(JSON.stringify(msg, null, 2));
    return;
  }

  console.log(`xctl ${command}: not implemented yet`);
  console.log(msg.note);
}

async function cmdRead(args, format) {
  if (!args[0]) {
    throw new Error('Usage: xctl read <tweet-id-or-url>');
  }

  const input = args[0];

  const tweetId = extractTweetId(input);
  const tweetUrl = parseTweetUrl(input);

  let response = null;
  let apiError = null;

  try {
    response = await apiRequestBearer('GET', `/2/tweets/${tweetId}`, {
      query: {
        'tweet.fields': 'created_at,public_metrics,author_id,note_tweet,article',
        expansions: 'author_id,article.cover_media,article.media_entities',
        'user.fields': 'name,username',
      },
    });
  } catch (error) {
    apiError = error;
  }

  if (response?.data) {
    const map = userMapFromIncludes(response.includes);
    const tweet = normalizeTweet(response.data, map);

    if (format === 'json') {
      console.log(JSON.stringify(tweet, null, 2));
      return;
    }

    printTweets([tweet], format);

    if (response.data.article && format !== 'json') {
      const art = response.data.article;
      console.log('');
      console.log('--- ARTICLE ---');
      if (art.title) {
        console.log(art.title);
        console.log('='.repeat(Math.min(art.title.length, 60)));
      }
      console.log('');
      if (art.plain_text) {
        console.log(art.plain_text);
      }
      if (art.entities?.code?.length) {
        console.log('');
        for (const block of art.entities.code) {
          console.log(`\`\`\`${block.language || ''}`);
          console.log(block.code || '');
          console.log('\`\`\`');
        }
      }
      if (art.entities?.urls?.length) {
        console.log('');
        console.log('Links:');
        for (const u of art.entities.urls) {
          console.log(`  ${u.text}`);
        }
      }
    }

    return;
  }

  if (tweetUrl) {
    try {
      const markdown = await fetchMarkdownNew(tweetUrl, { method: 'auto' });

      if (format === 'json') {
        console.log(
          JSON.stringify(
            {
              source: 'markdown.new',
              url: tweetUrl,
              markdown,
              fallback_reason: apiError ? apiError.message : 'Tweet not found via X API',
            },
            null,
            2,
          ),
        );
      } else {
        if (format !== 'plain') {
          const reason = apiError ? apiError.message : 'Tweet not found via X API';
          console.log(`(fallback via markdown.new: ${reason})`);
          console.log('');
        }

        process.stdout.write(markdown.endsWith('\n') ? markdown : `${markdown}\n`);
      }
      return;
    } catch (markdownError) {
      if (apiError) {
        throw new Error(`${apiError.message}; markdown fallback failed: ${markdownError.message}`);
      }
      throw markdownError;
    }
  }

  if (apiError) {
    throw apiError;
  }

  throw new Error('Tweet not found');
}

async function cmdSearch(args, format) {
  const { count, rest } = parseCountArg(args, 10);
  const query = rest.join(' ').trim();

  if (!query) {
    throw new Error('Usage: xctl search <query> [-n count]');
  }

  const requestedCount = Math.min(100, count);
  const apiCount = Math.min(100, Math.max(10, requestedCount));

  const response = await apiRequestBearer('GET', '/2/tweets/search/recent', {
    query: {
      query,
      max_results: apiCount,
      'tweet.fields': 'created_at,public_metrics,author_id,note_tweet,article',
      expansions: 'author_id,article.cover_media,article.media_entities',
      'user.fields': 'name,username',
      sort_order: 'relevancy',
    },
  });

  const map = userMapFromIncludes(response?.includes);
  const tweets = (response?.data || [])
    .map((tweet) => normalizeTweet(tweet, map))
    .slice(0, requestedCount);

  if (format === 'json') {
    console.log(
      JSON.stringify(
        {
          query,
          count: tweets.length,
          tweets,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (format !== 'plain') {
    console.log(`Query: ${query}`);
    console.log(`Results: ${tweets.length}`);
    if (tweets.length > 0) console.log('');
  }

  printTweets(tweets, format);
}

async function cmdUser(args, format) {
  const { count, rest } = parseCountArg(args, 10);
  const handle = (rest[0] || '').replace(/^@/, '');

  if (!handle) {
    throw new Error('Usage: xctl user <handle> [-n count]');
  }

  const requestedCount = Math.min(100, count);
  const apiCount = Math.min(100, Math.max(5, requestedCount));

  const userResponse = await apiRequestBearer('GET', `/2/users/by/username/${encodeURIComponent(handle)}`, {
    query: {
      'user.fields': 'created_at,description,public_metrics,verified',
    },
  });

  if (!userResponse?.data?.id) {
    throw new Error(`User not found: ${handle}`);
  }

  const user = userResponse.data;

  const tweetsResponse = await apiRequestBearer('GET', `/2/users/${user.id}/tweets`, {
    query: {
      max_results: apiCount,
      'tweet.fields': 'created_at,public_metrics,author_id,note_tweet',
    },
  });

  const fallbackAuthor = {
    id: user.id,
    name: user.name,
    username: user.username,
  };

  const tweets = (tweetsResponse?.data || [])
    .map((tweet) => normalizeTweet(tweet, new Map(), fallbackAuthor))
    .slice(0, requestedCount);

  if (format === 'json') {
    console.log(
      JSON.stringify(
        {
          user,
          count: tweets.length,
          tweets,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (format !== 'plain') {
    console.log(`${user.name} (@${user.username})`);
    console.log(`ID: ${user.id}`);
    if (user.public_metrics) {
      console.log(
        `Followers: ${user.public_metrics.followers_count}  Following: ${user.public_metrics.following_count}  Tweets: ${user.public_metrics.tweet_count}`,
      );
    }
    console.log(`Recent tweets: ${tweets.length}`);
    if (tweets.length > 0) console.log('');
  }

  printTweets(tweets, format);
}

async function cmdTweet(args, format) {
  const text = args.join(' ').trim();
  if (!text) {
    throw new Error('Usage: xctl tweet <text>');
  }

  const response = await apiRequestOAuth1('POST', '/2/tweets', {
    body: {
      text,
    },
  });

  if (format === 'json') {
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  const id = response?.data?.id || '(unknown)';
  const outText = response?.data?.text || text;
  console.log(`Tweet posted: ${id}`);
  console.log(outText);
}

async function cmdReply(args, format) {
  if (args.length < 2) {
    throw new Error('Usage: xctl reply <tweet-id> <text>');
  }

  const tweetId = extractTweetId(args[0]);
  const text = args.slice(1).join(' ').trim();

  if (!text) {
    throw new Error('Usage: xctl reply <tweet-id> <text>');
  }

  const response = await apiRequestOAuth1('POST', '/2/tweets', {
    body: {
      text,
      reply: {
        in_reply_to_tweet_id: tweetId,
      },
    },
  });

  if (format === 'json') {
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  const id = response?.data?.id || '(unknown)';
  console.log(`Reply posted: ${id}`);
  console.log(`In reply to: ${tweetId}`);
}

async function getAuthenticatedUserIdOAuth1() {
  const response = await apiRequestOAuth1('GET', '/2/users/me', {
    query: {
      'user.fields': 'id',
    },
  });

  const userId = response?.data?.id;
  if (!userId) {
    throw new Error('Could not determine authenticated user ID');
  }
  return userId;
}

async function cmdRetweet(args, format) {
  if (!args[0]) {
    throw new Error('Usage: xctl retweet <tweet-id-or-url>');
  }

  const tweetId = extractTweetId(args[0]);
  const userId = await getAuthenticatedUserIdOAuth1();

  const response = await apiRequestOAuth1('POST', `/2/users/${userId}/retweets`, {
    body: {
      tweet_id: tweetId,
    },
  });

  if (format === 'json') {
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  if (response?.data?.retweeted !== true) {
    throw new Error(`Unexpected response: ${JSON.stringify(response)}`);
  }

  console.log(`Retweeted: ${tweetId}`);
  console.log(`URL: https://x.com/i/web/status/${tweetId}`);
}

async function cmdQuote(args, format) {
  if (args.length < 2) {
    throw new Error('Usage: xctl quote <tweet-id-or-url> "text"');
  }

  const tweetId = extractTweetId(args[0]);
  const text = args.slice(1).join(' ').trim();

  if (!text) {
    throw new Error('Usage: xctl quote <tweet-id-or-url> "text"');
  }

  const response = await apiRequestOAuth1('POST', '/2/tweets', {
    body: {
      text,
      quote_tweet_id: tweetId,
    },
  });

  if (format === 'json') {
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  const id = response?.data?.id || '(unknown)';
  console.log(`Quote posted: ${id}`);
  console.log(`Quoted tweet: ${tweetId}`);
  console.log(`URL: https://x.com/i/web/status/${id}`);
}

async function cmdDelete(args, format) {
  if (!args[0]) {
    throw new Error('Usage: xctl delete <tweet-id-or-url>');
  }

  const tweetId = extractTweetId(args[0]);

  const response = await apiRequestOAuth1('DELETE', `/2/tweets/${tweetId}`);

  if (format === 'json') {
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  if (response?.data?.deleted === true) {
    console.log(`Deleted tweet ${tweetId}`);
  } else {
    throw new Error(`Unexpected response: ${JSON.stringify(response)}`);
  }
}

async function cmdWhoami(format) {
  const query = {
    'user.fields': 'created_at,description,location,public_metrics,url,verified',
  };

  let response;
  let authMode = 'bearer';

  if (hasOAuth1Creds()) {
    try {
      response = await apiRequestOAuth1('GET', '/2/users/me', { query });
      authMode = 'oauth1';
    } catch (error) {
      response = null;
      if (!process.env.X_BEARER_TOKEN) {
        throw error;
      }
    }
  }

  if (!response) {
    response = await apiRequestBearer('GET', '/2/users/me', { query });
  }

  if (!response?.data) {
    throw new Error('Could not fetch authenticated user');
  }

  const user = response.data;

  if (format === 'json') {
    console.log(
      JSON.stringify(
        {
          auth: authMode,
          user,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (format === 'plain') {
    console.log(`${user.id}\t@${user.username}\t${user.name}`);
    return;
  }

  console.log(`Authenticated via: ${authMode}`);
  console.log(`${user.name} (@${user.username})`);
  console.log(`ID: ${user.id}`);
  if (user.public_metrics) {
    console.log(
      `Followers: ${user.public_metrics.followers_count}  Following: ${user.public_metrics.following_count}  Tweets: ${user.public_metrics.tweet_count}`,
    );
  }
  if (user.description) console.log(`Bio: ${user.description}`);
}

async function main() {
  const { command, args, format, help } = parseGlobalArgs(process.argv.slice(2));

  if (help || !command) {
    console.log(HELP_TEXT);
    return;
  }

  switch (command) {
    case 'read':
      await cmdRead(args, format);
      break;
    case 'search':
      await cmdSearch(args, format);
      break;
    case 'user':
      await cmdUser(args, format);
      break;
    case 'home':
      printStub('home', format);
      break;
    case 'mentions':
      printStub('mentions', format);
      break;
    case 'tweet':
      await cmdTweet(args, format);
      break;
    case 'reply':
      await cmdReply(args, format);
      break;
    case 'retweet':
      await cmdRetweet(args, format);
      break;
    case 'quote':
      await cmdQuote(args, format);
      break;
    case 'delete':
      await cmdDelete(args, format);
      break;
    case 'whoami':
      await cmdWhoami(format);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.log('');
      console.log(HELP_TEXT);
      process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
