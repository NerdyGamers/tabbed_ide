// =============================================================================
// background.js - Tabbed IDE Service Worker (MV3)
// Handles cookie harvesting, LLM API calls, response parsing,
// and toolbar icon click -> open/focus ide.html in its own tab.
// Cookies are used transiently and NEVER stored in chrome.storage or logs.
// =============================================================================

'use strict';

// ---------------------------------------------------------------------------
// Provider Configuration
// ---------------------------------------------------------------------------
const PROVIDERS = {
  gemini: {
    url: 'https://gemini.google.com',
    endpoint: 'https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate',
    requiredCookies: ['__Secure-3PSID', '__Secure-3PAPISID', '__Secure-3PSIDCC', 'SIDCC'],
    csrfHeader: 'X-Goog-AuthUser',
  },
  perplexity: {
    url: 'https://www.perplexity.ai',
    endpoint: 'https://www.perplexity.ai/rest/sse/perplexity_ask',
    sessionEndpoint: 'https://www.perplexity.ai/api/auth/session',
    requiredCookies: ['__Secure-next-auth.session-token', 'next-auth.session-token', 'pplx-token'],
  },
};

// ---------------------------------------------------------------------------
// Action Click Handler
// Opens ide.html in its own tab, or focuses it if already open.
// This replaces the old chrome_url_overrides newtab approach.
// ---------------------------------------------------------------------------
const IDE_URL = chrome.runtime.getURL('ide.html');

chrome.action.onClicked.addListener(async () => {
  // Search all tabs for an already-open ide.html
  const existingTabs = await chrome.tabs.query({ url: IDE_URL });

  if (existingTabs.length > 0) {
    // IDE is already open — focus that tab and its window
    const tab = existingTabs[0];
    await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.tabs.update(tab.id, { active: true });
  } else {
    // Not open yet — create a new tab
    await chrome.tabs.create({ url: IDE_URL });
  }
});

// ---------------------------------------------------------------------------
// Cookie Harvesting
// Returns a transient Map<name, value>. Cleared in finally block after use.
// ---------------------------------------------------------------------------
async function harvestCookies(providerKey) {
  const cfg = PROVIDERS[providerKey];
  const cookieMap = new Map();

  for (const name of cfg.requiredCookies) {
    try {
      const cookie = await chrome.cookies.get({ url: cfg.url, name });
      if (cookie && cookie.value) {
        cookieMap.set(name, cookie.value);
      }
    } catch (err) {
      // Non-fatal: cookie may not exist if user is not logged in
      console.warn(`[TabbedIDE] Cookie not found: ${name}`);
    }
  }

  return cookieMap;
}

// Build a Cookie header string from a Map, then clear the map.
function buildCookieHeader(cookieMap) {
  const header = Array.from(cookieMap.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  cookieMap.clear(); // Immediately purge from memory
  return header;
}

// ---------------------------------------------------------------------------
// Gemini API Call
// ---------------------------------------------------------------------------
async function askGemini(userMessage, conversationHistory) {
  const cookieMap = await harvestCookies('gemini');

  if (cookieMap.size === 0) {
    throw new Error('Not authenticated with Gemini. Please visit gemini.google.com and sign in.');
  }

  const reqData = [
    null,
    JSON.stringify([
      [userMessage],
      null,
      null,
    ]),
  ];

  const body = new URLSearchParams({
    'f.req': JSON.stringify(reqData),
    'at': '',
  });

  const cookieHeader = buildCookieHeader(cookieMap);

  let response;
  try {
    response = await fetch(PROVIDERS.gemini.endpoint, {
      method: 'POST',
      credentials: 'omit', // Never use browser jar; cookies injected manually
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'Cookie': cookieHeader,
        'X-Goog-AuthUser': '0',
        'Referer': 'https://gemini.google.com/',
        'Origin': 'https://gemini.google.com',
        'User-Agent': navigator.userAgent,
      },
      body: body.toString(),
    });
  } finally {
    // cookieHeader string goes out of scope
  }

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
  }

  const rawText = await response.text();
  return parseGeminiStream(rawText);
}

// Parse Gemini's chunked protobuf-JSON stream format
function parseGeminiStream(rawText) {
  try {
    const lines = rawText.split('\n').filter(l => l.trim().startsWith('['));

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        const text = parsed?.[4]?.[0]?.[1]?.[0];
        if (text && typeof text === 'string' && text.length > 10) {
          return text;
        }
      } catch (_) {
        continue;
      }
    }

    const match = rawText.match(/"([^"]{50,}?)"/);
    return match ? match[1] : 'Received a response but could not parse it. Check your Gemini session.';
  } catch (err) {
    throw new Error(`Failed to parse Gemini response: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Perplexity API Call
// ---------------------------------------------------------------------------
async function askPerplexity(userMessage, conversationHistory) {
  const cookieMap = await harvestCookies('perplexity');

  if (cookieMap.size === 0) {
    throw new Error('Not authenticated with Perplexity. Please visit perplexity.ai and sign in.');
  }

  const cookieHeader = buildCookieHeader(cookieMap);

  // Step 1: Fetch CSRF token
  let pplxToken = '';
  try {
    const sessionRes = await fetch(PROVIDERS.perplexity.sessionEndpoint, {
      credentials: 'omit',
      headers: {
        'Cookie': cookieHeader,
        'Referer': 'https://www.perplexity.ai/',
      },
    });
    const sessionData = await sessionRes.json();
    pplxToken = sessionData?.user?.pplxToken || '';
  } catch (_) {
    // Proceed without CSRF token
  }

  // Step 2: POST to SSE ask endpoint
  const payload = {
    query: userMessage,
    mode: 'concise',
    source: 'default',
    search_recency_filter: 'month',
    frontend_uuid: crypto.randomUUID(),
  };

  const response = await fetch(PROVIDERS.perplexity.endpoint, {
    method: 'POST',
    credentials: 'omit',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookieHeader,
      'x-pplx-token': pplxToken,
      'Referer': 'https://www.perplexity.ai/',
      'Origin': 'https://www.perplexity.ai',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Perplexity API error: ${response.status} ${response.statusText}`);
  }

  const rawText = await response.text();
  return parsePerplexitySSE(rawText);
}

// Parse Perplexity SSE stream: accumulate the longest answer chunk
function parsePerplexitySSE(rawText) {
  const lines = rawText.split('\n');
  let bestAnswer = '';

  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    try {
      const data = JSON.parse(line.slice(6));
      const answer = data?.answer || data?.text || '';
      if (answer.length > bestAnswer.length) {
        bestAnswer = answer;
      }
    } catch (_) {
      continue;
    }
  }

  return bestAnswer || 'Received a response but could not parse it. Check your Perplexity session.';
}

// ---------------------------------------------------------------------------
// Response Parser
// Splits prose from fenced code blocks.
// Returns { chat, codeBlocks: [{lang, code}], primaryCode }
// ---------------------------------------------------------------------------
function parseResponse(fullText) {
  const codeBlocks = [];
  const codeRegex = /```([\w]*)?\n([\s\S]*?)```/g;
  let match;

  while ((match = codeRegex.exec(fullText)) !== null) {
    const lang = (match[1] || 'plaintext').trim();
    const code = match[2].trim();
    if (code.length > 0) codeBlocks.push({ lang, code });
  }

  let chatText = fullText.replace(/```[\w]*\n[\s\S]*?```/g, '').trim();
  chatText = chatText.replace(/\n{3,}/g, '\n\n');

  const primaryCode = codeBlocks.length > 0
    ? codeBlocks.reduce((a, b) => a.code.length >= b.code.length ? a : b)
    : null;

  return { chat: chatText, codeBlocks, primaryCode };
}

// ---------------------------------------------------------------------------
// Authentication Check
// ---------------------------------------------------------------------------
async function checkAuth(provider) {
  const cookieMap = await harvestCookies(provider);
  const isAuthed = cookieMap.size > 0;
  cookieMap.clear();
  return isAuthed;
}

// ---------------------------------------------------------------------------
// Message Router (from ide.html / newtab.js)
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Validate sender is our own extension
  if (sender.id !== chrome.runtime.id) {
    console.warn('[TabbedIDE] Rejected message from unknown sender:', sender.id);
    return false;
  }

  const { type, payload } = message;

  if (type === 'CHECK_AUTH') {
    checkAuth(payload.provider)
      .then(isAuthed => sendResponse({ success: true, isAuthed }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (type === 'ASK_LLM') {
    const { provider, userMessage, conversationHistory } = payload;
    const askFn = provider === 'gemini' ? askGemini : askPerplexity;

    askFn(userMessage, conversationHistory || [])
      .then(rawResponse => {
        const parsed = parseResponse(rawResponse);
        sendResponse({ success: true, ...parsed });
      })
      .catch(err => {
        console.error('[TabbedIDE] LLM error:', err.message);
        sendResponse({ success: false, error: err.message });
      });

    return true;
  }

  return false;
});
