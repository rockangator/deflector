/** @typedef {'off' | 'manual' | 'auto' | 'always'} SiteMode */

const CONTENT_SCRIPT = 'dist/content.js';

const COMMERCE_HOST_RE = /(?:^|\.)((?:amazon|booking|expedia|hotels|airbnb|ebay|walmart|target|etsy|shopify)\.[a-z.]+)/i;
const COMMERCE_PATH_RE = /\/(dp|gp\/aw|product|checkout|cart|hotel|hotels|flights)\//i;

const MENU_SCAN_PAGE = 'deflector-scan-page';
const MENU_SCAN_SELECTION = 'deflector-scan-selection';

const TAXONOMY_PROMPT = `You classify web page text for pressure tactics (manipulative commerce language). Categories: urgency, scarcity, social_proof, misdirection, trick_question, hidden_cost, disguised_ad.
Be conservative — only flag clearly manipulative text. False positives are worse than misses.
Use calm, plain language in explanations. Suggest a plain-language alternative in rewrite.
Return JSON: { "findings": [{ "text": "...", "category": "...", "confidence": 0.0-1.0, "explanation": "...", "rewrite": "..." }] }`;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_SCAN_PAGE,
    title: 'Deflector: Scan this page',
    contexts: ['page'],
  });
  chrome.contextMenus.create({
    id: MENU_SCAN_SELECTION,
    title: 'Deflector: Scan selection',
    contexts: ['selection'],
  });
});

/**
 * @param {string} url
 */
function isCommerceUrl(url) {
  try {
    const { hostname, pathname } = new URL(url);
    if (COMMERCE_HOST_RE.test(hostname)) return true;
    if (COMMERCE_PATH_RE.test(pathname)) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * @param {number} tabId
 */
async function ensureContentScript(tabId) {
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    if (pong?.ready) return true;
  } catch {
    /* not injected */
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: [CONTENT_SCRIPT],
  });
  return true;
}

/**
 * @param {number} tabId
 * @param {object} message
 */
async function sendToContentScript(tabId, message) {
  await ensureContentScript(tabId);
  return chrome.tabs.sendMessage(tabId, message);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;
  if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) return;
  if (!isCommerceUrl(tab.url)) return;

  ensureContentScript(tabId).catch(() => {});
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  const type = info.menuItemId === MENU_SCAN_SELECTION ? 'SCAN_SELECTION' : 'SCAN_PAGE';
  try {
    await sendToContentScript(tab.id, { type, trigger: 'manual', openSidebar: true });
  } catch (err) {
    console.error('[Deflector] Context menu scan failed:', err);
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'scan-page') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await sendToContentScript(tab.id, { type: 'SCAN_PAGE', trigger: 'manual', openSidebar: true });
  } catch (err) {
    console.error('[Deflector] Keyboard scan failed:', err);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SAVE_FINDINGS') {
    const tabId = sender.tab?.id;
    if (tabId != null) {
      const payload = {
        findings: message.findings,
        pageInfo: message.pageInfo,
        filterVersion: message.filterVersion,
        updatedAt: Date.now(),
      };
      chrome.storage.session.set({ [`findings_${tabId}`]: payload }).then(() => {
        chrome.action.setBadgeText({ tabId, text: message.findings.length ? String(message.findings.length) : '' });
        chrome.action.setBadgeBackgroundColor({ tabId, color: '#9d0208' });
        sendResponse({ ok: true, count: message.findings.length });
      });
      return true;
    }
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'UPDATE_BADGE') {
    const tabId = sender.tab?.id;
    if (tabId != null) {
      chrome.action.setBadgeText({ tabId, text: message.count ? String(message.count) : '' });
    }
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'GET_FINDINGS') {
    chrome.storage.session.get([`findings_${message.tabId}`]).then((stored) => {
      sendResponse({ ok: true, data: stored[`findings_${message.tabId}`] || null });
    });
    return true;
  }

  if (message.type === 'FORWARD_TO_TAB') {
    sendToContentScript(message.tabId, message.payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (message.type === 'LLM_ESCALATE') {
    handleLlmEscalation(message.snippets, message.deep)
      .then((findings) => sendResponse({ findings }))
      .catch(() => sendResponse({ findings: [] }));
    return true;
  }

  return false;
});

/**
 * @param {string[]} snippets
 * @param {boolean} deep
 */
async function handleLlmEscalation(snippets, deep) {
  const { apiKey } = await chrome.storage.local.get(['apiKey']);
  if (!apiKey) return [];

  const cacheKey = snippets.map((s) => s.toLowerCase().trim()).sort().join('\n');
  const cached = await getLlmCache(cacheKey);
  if (cached) return cached;

  const userContent = deep
    ? `Deep scan these page snippets:\n\n${snippets.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
    : `Review these ambiguous or low-confidence snippets:\n\n${snippets.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: TAXONOMY_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!response.ok) return [];

  const data = await response.json();
  const text = data.content?.find((c) => c.type === 'text')?.text || '';

  let parsed;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
  } catch {
    return [];
  }

  const findings = (parsed.findings || []).slice(0, 10);
  await setLlmCache(cacheKey, findings);
  return findings;
}

async function getLlmCache(key) {
  const stored = await chrome.storage.session.get([`llm_${hashKey(key)}`]);
  return stored[`llm_${hashKey(key)}`] || null;
}

async function setLlmCache(key, value) {
  await chrome.storage.session.set({ [`llm_${hashKey(key)}`]: value });
}

function hashKey(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return String(h);
}
