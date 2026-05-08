# Tabbed IDE

A **Chrome Manifest V3 browser extension** that replaces every New Tab with a split-screen AI Coding IDE.

- **Left pane** - AI Chat (Gemini or Perplexity)
- **Right pane** - Live syntax-highlighted code editor

No API keys required. Uses your existing browser sessions.

---

## Features

- Split-screen layout with drag-to-resize handle (keyboard-accessible)
- Gemini and Perplexity provider support via session cookies
- Automatic code block extraction: prose goes to Chat, code goes to IDE
- Highlight.js syntax highlighting (atom-one-dark theme)
- Edit mode - click to edit code inline, sync back to viewer
- Copy to clipboard and file download with correct extension
- Dark / Light theme toggle (respects OS preference)
- Auth status badge with per-provider live check
- MV3 compliant, CSP locked, zero cookie leakage

---

## File Structure

```
tabbed_ide/
├── manifest.json          # MV3 manifest
├── background.js          # Service worker: cookies, LLM API, parser
├── newtab.html            # New Tab override: split-screen UI
├── newtab.css             # Dark/light stylesheet
├── newtab.js              # Frontend controller (ES module)
├── rules/
│   └── dynamic_rules.json # DNR ruleset (empty, injected at runtime)
└── README.md
```

---

## Installation

1. Clone or download this repo
2. Open `chrome://extensions`
3. Enable **Developer Mode** (top-right toggle)
4. Click **Load unpacked** and select the `tabbed_ide/` folder
5. Open a New Tab to launch the IDE

> **Note:** You must download and place Highlight.js files manually:
> - `libs/highlight.min.js` - from https://highlightjs.org/download
> - `libs/atom-one-dark.min.css` - from the same download

---

## Authentication Setup

This extension uses your **existing browser sessions** - no API keys needed.

### Gemini
1. Visit [gemini.google.com](https://gemini.google.com) in Chrome and sign in
2. The auth dot in the extension header will turn green

### Perplexity
1. Visit [perplexity.ai](https://perplexity.ai) in Chrome and sign in
2. Switch to Perplexity in the provider dropdown

---

## How It Works

1. User types a message in the Chat pane
2. `newtab.js` sends `ASK_LLM` to the background service worker
3. `background.js` harvests auth cookies transiently (never stored), calls the LLM API, and parses the response
4. `parseResponse()` extracts code blocks with regex - prose goes to Chat, the largest code block goes to the IDE
5. Highlight.js renders the code with syntax highlighting

---

## Security Notes

- Cookies are loaded into a transient `Map`, used once, then `.clear()`'d
- All fetches use `credentials: 'omit'` - cookies are injected manually, never exposed to the browser jar
- CSP is locked to `script-src 'self'` - no remote scripts
- Message sender ID is validated in the service worker before processing

---

## License

MIT - NerdyGamers 2026
