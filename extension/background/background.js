/**
 * Fire Claude Background Script
 * Coordinates communication between sidebar, content scripts, and native host
 */

// Native messaging state
let nativePort = null;
let pendingRequests = new Map();
let requestIdCounter = 0;

// Network request tracking per tab
let networkRequests = new Map();

/**
 * Initialize or get native messaging connection
 */
function getNativePort() {
  if (nativePort === null) {
    try {
      nativePort = browser.runtime.connectNative("fire_claude_host");

      nativePort.onMessage.addListener((response) => {
        const requestId = response.requestId;
        if (pendingRequests.has(requestId)) {
          const { resolve, reject } = pendingRequests.get(requestId);
          pendingRequests.delete(requestId);

          if (response.success) {
            resolve(response.result);
          } else {
            reject(new Error(response.error || 'Unknown error'));
          }
        }
      });

      nativePort.onDisconnect.addListener((p) => {
        console.error("Native port disconnected:", p.error || "unknown reason");
        nativePort = null;

        // Reject all pending requests
        pendingRequests.forEach(({ reject }) => {
          reject(new Error('Native host disconnected'));
        });
        pendingRequests.clear();
      });
    } catch (error) {
      console.error("Failed to connect to native host:", error);
      throw error;
    }
  }
  return nativePort;
}

/**
 * Send message to native host and await response
 */
function sendNativeMessage(message) {
  return new Promise((resolve, reject) => {
    const requestId = ++requestIdCounter;
    message.requestId = requestId;

    pendingRequests.set(requestId, { resolve, reject });

    try {
      const port = getNativePort();
      port.postMessage(message);
    } catch (error) {
      pendingRequests.delete(requestId);
      reject(error);
    }

    // Timeout after 2 minutes
    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        reject(new Error('Request timed out'));
      }
    }, 120000);
  });
}

/**
 * Extract page content via content script
 */
async function getPageContent(tabId) {
  try {
    const response = await browser.tabs.sendMessage(tabId, { type: 'GET_PAGE_CONTENT' });
    return response;
  } catch (error) {
    console.error('Failed to get page content:', error);
    return { content: '', title: '', url: '' };
  }
}

/**
 * Get simplified HTML from page
 */
async function getPageHTML(tabId) {
  try {
    const response = await browser.tabs.sendMessage(tabId, { type: 'GET_PAGE_HTML' });
    return response.html;
  } catch (error) {
    console.error('Failed to get page HTML:', error);
    return '';
  }
}

/**
 * Handle messages from sidebar and content scripts
 */
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case 'PING_NATIVE':
          const pong = await sendNativeMessage({ action: 'ping' });
          sendResponse({ success: true, result: pong });
          break;

        case 'SUMMARIZE_PAGE': {
          const pageData = await getPageContent(message.tabId);
          const result = await sendNativeMessage({
            action: 'summarize',
            content: `Title: ${pageData.title}\nURL: ${pageData.url}\n\n${pageData.content}`
          });
          sendResponse({ success: true, result });
          break;
        }

        case 'ASK_QUESTION': {
          const pageData = await getPageContent(message.tabId);
          const result = await sendNativeMessage({
            action: 'ask',
            question: message.question,
            content: `Title: ${pageData.title}\nURL: ${pageData.url}\n\n${pageData.content}`
          });
          sendResponse({ success: true, result });
          break;
        }

        case 'EXPLAIN_SELECTION': {
          const result = await sendNativeMessage({
            action: 'explain',
            selection: message.selection
          });
          sendResponse({ success: true, result });
          break;
        }

        case 'ANALYZE_NETWORK': {
          const requests = networkRequests.get(message.tabId) || [];
          const networkData = requests.map(r => ({
            url: r.url,
            type: r.type,
            status: r.statusCode,
            size: r.responseSize || 'unknown',
            method: r.method
          }));
          const result = await sendNativeMessage({
            action: 'analyze_network',
            networkData
          });
          sendResponse({ success: true, result });
          break;
        }

        case 'SUGGEST_DOM_CHANGES': {
          const html = await getPageHTML(message.tabId);
          const result = await sendNativeMessage({
            action: 'suggest_dom_changes',
            html,
            request: message.request
          });
          sendResponse({ success: true, result });
          break;
        }

        case 'APPLY_DOM_CHANGES': {
          const applyResult = await browser.tabs.sendMessage(message.tabId, {
            type: 'APPLY_DOM_CHANGES',
            changes: message.changes
          });
          sendResponse({ success: true, result: applyResult });
          break;
        }

        case 'GET_NETWORK_DATA': {
          const data = networkRequests.get(message.tabId) || [];
          sendResponse({ success: true, data });
          break;
        }

        default:
          sendResponse({ success: false, error: `Unknown message type: ${message.type}` });
      }
    } catch (error) {
      console.error('Error handling message:', error);
      sendResponse({ success: false, error: error.message });
    }
  })();

  return true; // Keep channel open for async response
});

/**
 * Network request monitoring
 */
browser.webRequest.onCompleted.addListener(
  (details) => {
    const { tabId, url, type, statusCode, method } = details;
    if (tabId < 0) return;

    if (!networkRequests.has(tabId)) {
      networkRequests.set(tabId, []);
    }

    const requests = networkRequests.get(tabId);
    requests.push({
      url,
      type,
      statusCode,
      method,
      timestamp: Date.now()
    });

    // Keep only last 100 requests per tab
    if (requests.length > 100) {
      requests.shift();
    }
  },
  { urls: ["<all_urls>"] }
);

// Clean up when tab closes
browser.tabs.onRemoved.addListener((tabId) => {
  networkRequests.delete(tabId);
});

// Clear network data when tab navigates
browser.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId === 0) {
    networkRequests.delete(details.tabId);
  }
});

/**
 * Context menu for explaining selected text
 */
browser.contextMenus.create({
  id: "explain-selection",
  title: "Explain with Claude",
  contexts: ["selection"]
});

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "explain-selection") {
    const selection = info.selectionText;

    try {
      const result = await sendNativeMessage({
        action: 'explain',
        selection
      });

      // Send result to sidebar
      browser.runtime.sendMessage({
        type: 'CONTEXT_MENU_RESULT',
        action: 'explain',
        selection,
        result
      });

      // Open sidebar to show result
      browser.sidebarAction.open();
    } catch (error) {
      console.error('Failed to explain selection:', error);
    }
  }
});

console.log('Fire Claude background script loaded');
