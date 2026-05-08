// =============================================================================
// newtab.js - Tabbed IDE Frontend Controller (ES Module)
// Manages chat UI, IDE pane, drag-to-resize, auth polling, and theme toggle.
// Communicates with background.js via chrome.runtime.sendMessage.
// =============================================================================

'use strict';

// ---------------------------------------------------------------------------
// DOM References
// ---------------------------------------------------------------------------
const providerSelect   = document.getElementById('provider-select');
const authBadge        = document.getElementById('auth-badge');
const authLabel        = document.getElementById('auth-label');
const themeToggle      = document.getElementById('theme-toggle');
const clearBtn         = document.getElementById('clear-btn');
const messageList      = document.getElementById('message-list');
const typingIndicator  = document.getElementById('typing-indicator');
const chatInput        = document.getElementById('chat-input');
const sendBtn          = document.getElementById('send-btn');
const chatPane         = document.getElementById('chat-container');
const idePane          = document.getElementById('ide-container');
const dragHandle       = document.getElementById('drag-handle');
const langBadge        = document.getElementById('lang-badge');
const editToggleBtn    = document.getElementById('edit-toggle-btn');
const copyBtn          = document.getElementById('copy-btn');
const downloadBtn      = document.getElementById('download-btn');
const codeDisplay      = document.getElementById('code-display');
const codeBlock        = document.getElementById('code-block');
const codeEditor       = document.getElementById('code-editor');
const codeStats        = document.getElementById('code-stats');
const copyFeedback     = document.getElementById('copy-feedback');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let conversationHistory = [];  // [{role:'user'|'ai', content:string}]
let currentLang = 'plaintext';
let currentCode = '// Your generated code will appear here.\n// Start a conversation in the chat pane on the left.';
let isEditMode = false;
let isBusy = false;
let isDarkTheme = true;

// ---------------------------------------------------------------------------
// Theme Management
// In-memory only; no localStorage (blocked in extension pages).
// ---------------------------------------------------------------------------
function applyTheme(dark) {
  isDarkTheme = dark;
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  themeToggle.textContent = dark ? '\u263E' : '\u2600\uFE0F'; // Moon / Sun
}

themeToggle.addEventListener('click', () => applyTheme(!isDarkTheme));

// Respect OS preference on first load
if (window.matchMedia('(prefers-color-scheme: light)').matches) {
  applyTheme(false);
}

// ---------------------------------------------------------------------------
// Auth Badge
// ---------------------------------------------------------------------------
async function checkAuth() {
  const provider = providerSelect.value;
  authBadge.className = 'auth-badge auth-unknown';
  authLabel.textContent = 'Checking...';

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'CHECK_AUTH',
      payload: { provider },
    });

    if (response?.success && response.isAuthed) {
      authBadge.className = 'auth-badge auth-ok';
      authLabel.textContent = `${provider} connected`;
    } else {
      authBadge.className = 'auth-badge auth-fail';
      authLabel.textContent = `Not signed in to ${provider}`;
    }
  } catch (err) {
    authBadge.className = 'auth-badge auth-fail';
    authLabel.textContent = 'Auth error';
  }
}

// Check auth on load and when provider changes
checkAuth();
providerSelect.addEventListener('change', checkAuth);

// ---------------------------------------------------------------------------
// Message Rendering
// ---------------------------------------------------------------------------
function formatTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Appends a message bubble to the chat pane.
 * @param {'user'|'ai'|'system'|'error'} role
 * @param {string} content
 */
function appendMessage(role, content) {
  const msg = document.createElement('div');
  msg.className = `message ${role}`;

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.textContent = content;

  const meta = document.createElement('div');
  meta.className = 'message-meta';
  meta.textContent = role === 'user' ? `You \u00B7 ${formatTime()}` :
                     role === 'ai'   ? `AI \u00B7 ${formatTime()}` : '';

  msg.appendChild(bubble);
  if (role === 'user' || role === 'ai') msg.appendChild(meta);

  messageList.appendChild(msg);
  messageList.scrollTop = messageList.scrollHeight;
  return msg;
}

// ---------------------------------------------------------------------------
// IDE Pane - Code Rendering
// ---------------------------------------------------------------------------

/**
 * Renders code in the syntax-highlighted display pane.
 * Uses highlight.js if available; falls back to plain text.
 * @param {string} code - raw code string
 * @param {string} lang - language identifier
 */
function renderCode(code, lang) {
  currentCode = code;
  currentLang = lang || 'plaintext';

  // Update language badge
  langBadge.textContent = currentLang;

  // Highlight
  if (window.hljs) {
    const validLang = hljs.getLanguage(currentLang) ? currentLang : 'plaintext';
    const highlighted = hljs.highlight(code, { language: validLang, ignoreIllegals: true });
    codeBlock.innerHTML = highlighted.value;
  } else {
    codeBlock.textContent = code;
  }

  // Update footer stats
  updateCodeStats(code);

  // If in edit mode, sync textarea too
  if (isEditMode) {
    codeEditor.value = code;
  }
}

function updateCodeStats(code) {
  const lines = code.split('\n').length;
  const chars = code.length;
  codeStats.textContent = `${lines} line${lines !== 1 ? 's' : ''} | ${chars.toLocaleString()} chars`;
}

// Initialize IDE with placeholder
renderCode(currentCode, 'javascript');

// ---------------------------------------------------------------------------
// Edit Mode Toggle
// ---------------------------------------------------------------------------
editToggleBtn.addEventListener('click', () => {
  isEditMode = !isEditMode;

  if (isEditMode) {
    // Switch to textarea
    codeEditor.value = currentCode;
    codeDisplay.classList.add('hidden');
    codeEditor.classList.remove('hidden');
    editToggleBtn.textContent = '\u2713 View';
    codeEditor.focus();
  } else {
    // Sync edits back and re-render
    currentCode = codeEditor.value;
    codeDisplay.classList.remove('hidden');
    codeEditor.classList.add('hidden');
    editToggleBtn.textContent = '\u270E Edit';
    renderCode(currentCode, currentLang);
  }
});

// Live stats update while editing
codeEditor.addEventListener('input', () => {
  updateCodeStats(codeEditor.value);
});

// ---------------------------------------------------------------------------
// Copy to Clipboard
// ---------------------------------------------------------------------------
copyBtn.addEventListener('click', async () => {
  const codeToCopy = isEditMode ? codeEditor.value : currentCode;
  try {
    await navigator.clipboard.writeText(codeToCopy);
    copyFeedback.classList.remove('hidden');
    setTimeout(() => copyFeedback.classList.add('hidden'), 2000);
  } catch (err) {
    appendMessage('error', 'Failed to copy to clipboard.');
  }
});

// ---------------------------------------------------------------------------
// File Download
// ---------------------------------------------------------------------------
const LANG_EXTENSIONS = {
  javascript: 'js', typescript: 'ts', python: 'py', html: 'html',
  css: 'css', json: 'json', markdown: 'md', rust: 'rs',
  go: 'go', java: 'java', cpp: 'cpp', c: 'c', csharp: 'cs',
  php: 'php', ruby: 'rb', swift: 'swift', kotlin: 'kt',
  shell: 'sh', bash: 'sh', sql: 'sql', xml: 'xml', yaml: 'yaml',
};

downloadBtn.addEventListener('click', () => {
  const ext = LANG_EXTENSIONS[currentLang] || 'txt';
  const filename = `tabbed-ide-output.${ext}`;
  const codeToDl = isEditMode ? codeEditor.value : currentCode;

  const blob = new Blob([codeToDl], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();

  // Clean up
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
});

// ---------------------------------------------------------------------------
// Clear Conversation
// ---------------------------------------------------------------------------
clearBtn.addEventListener('click', () => {
  conversationHistory = [];
  messageList.innerHTML = '';
  appendMessage('system', 'Conversation cleared. Start a new chat below.');
  renderCode('// Cleared. Start a new conversation to generate code.', 'plaintext');
});

// ---------------------------------------------------------------------------
// Drag-to-Resize Panes
// ---------------------------------------------------------------------------
(function initDragResize() {
  let isDragging = false;
  let startX = 0;
  let startChatWidth = 0;

  dragHandle.addEventListener('mousedown', (e) => {
    isDragging = true;
    startX = e.clientX;
    startChatWidth = chatPane.getBoundingClientRect().width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const containerWidth = chatPane.parentElement.getBoundingClientRect().width;
    const newWidth = Math.max(280, Math.min(startChatWidth + dx, containerWidth - 285));
    chatPane.style.flex = `0 0 ${newWidth}px`;
  });

  document.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });

  // Keyboard resize support (ArrowLeft / ArrowRight on handle)
  dragHandle.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 50 : 10;
    const current = chatPane.getBoundingClientRect().width;
    const containerWidth = chatPane.parentElement.getBoundingClientRect().width;

    if (e.key === 'ArrowLeft') {
      chatPane.style.flex = `0 0 ${Math.max(280, current - step)}px`;
      e.preventDefault();
    } else if (e.key === 'ArrowRight') {
      chatPane.style.flex = `0 0 ${Math.min(containerWidth - 285, current + step)}px`;
      e.preventDefault();
    }
  });
})();

// ---------------------------------------------------------------------------
// Chat Send Logic
// ---------------------------------------------------------------------------

/**
 * Sends the user's message to the background service worker,
 * receives the parsed response, and updates both panes.
 */
async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text || isBusy) return;

  // Clear input immediately
  chatInput.value = '';
  chatInput.style.height = 'auto';

  // Add user message to UI and history
  appendMessage('user', text);
  conversationHistory.push({ role: 'user', content: text });

  // Show loading state
  isBusy = true;
  sendBtn.disabled = true;
  typingIndicator.classList.remove('hidden');
  messageList.scrollTop = messageList.scrollHeight;

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'ASK_LLM',
      payload: {
        provider: providerSelect.value,
        userMessage: text,
        conversationHistory: conversationHistory.slice(-10), // Last 10 turns for context
      },
    });

    if (!response) {
      throw new Error('No response from background script. Check extension service worker.');
    }

    if (!response.success) {
      throw new Error(response.error || 'Unknown error from LLM.');
    }

    // --- Route response to correct panes ---

    // 1. Chat text (prose without code) goes to the chat pane
    const chatText = response.chat?.trim();
    if (chatText) {
      appendMessage('ai', chatText);
      conversationHistory.push({ role: 'ai', content: chatText });
    } else if (!response.primaryCode) {
      // No prose and no code - show raw
      appendMessage('ai', 'Response received but contained no parseable content.');
    }

    // 2. Primary code block goes to the IDE pane
    if (response.primaryCode) {
      renderCode(response.primaryCode.code, response.primaryCode.lang);

      // Show a brief notification in chat if code was extracted
      if (!chatText) {
        appendMessage('system', `Code generated (${response.primaryCode.lang}) \u2192 see IDE pane.`);
      } else {
        const codeNotice = document.createElement('div');
        codeNotice.className = 'message system';
        const noticeBubble = document.createElement('div');
        noticeBubble.className = 'message-bubble';
        noticeBubble.textContent = `\u2192 Code block (${response.primaryCode.lang}) sent to IDE pane`;
        codeNotice.appendChild(noticeBubble);
        messageList.appendChild(codeNotice);
        messageList.scrollTop = messageList.scrollHeight;
      }
    }

    // 3. If there were multiple code blocks, log count
    if (response.codeBlocks?.length > 1) {
      appendMessage('system', `${response.codeBlocks.length} code blocks detected. Largest shown in IDE.`);
    }

  } catch (err) {
    appendMessage('error', `Error: ${err.message}`);
  } finally {
    isBusy = false;
    sendBtn.disabled = false;
    typingIndicator.classList.add('hidden');
  }
}

// Send on button click
sendBtn.addEventListener('click', sendMessage);

// Send on Enter (Shift+Enter = newline)
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Auto-resize textarea as user types
chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = `${Math.min(chatInput.scrollHeight, 120)}px`;
});

// ---------------------------------------------------------------------------
// Welcome Message
// ---------------------------------------------------------------------------
appendMessage('system', 'Welcome to Tabbed IDE! Select a provider above, then describe what you want to build.');
chatInput.focus();
