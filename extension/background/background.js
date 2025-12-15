/**
 * Fire Claude Background Script
 * Coordinates communication between sidebar, content scripts, and native host
 */

// Native messaging state
let nativePort = null;
let pendingRequests = new Map();
let requestIdCounter = 0;

// Track active request for cancellation
let activeRequestId = null;

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
          const { resolve, reject, startTime } = pendingRequests.get(requestId);
          pendingRequests.delete(requestId);

          // Clear active request if this was it
          if (activeRequestId === requestId) {
            activeRequestId = null;
          }

          // Add client-side timing if not provided
          if (!response.duration_ms) {
            response.duration_ms = Date.now() - startTime;
          }

          if (response.success) {
            resolve(response);
          } else {
            reject(new Error(response.error || response.result || 'Unknown error'));
          }
        }
      });

      nativePort.onDisconnect.addListener((p) => {
        console.error("Native port disconnected:", p.error || "unknown reason");
        nativePort = null;
        activeRequestId = null;

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
 * Send message to native host and await response (returns full response with metadata)
 */
function sendNativeMessage(message) {
  return new Promise((resolve, reject) => {
    const requestId = ++requestIdCounter;
    message.requestId = requestId;

    const startTime = Date.now();
    pendingRequests.set(requestId, { resolve, reject, startTime });

    // Track as active request (for cancellation)
    activeRequestId = requestId;

    try {
      const port = getNativePort();
      port.postMessage(message);
    } catch (error) {
      pendingRequests.delete(requestId);
      activeRequestId = null;
      reject(error);
    }

    // Timeout after 3 minutes (matches Python host timeout of 180s)
    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        if (activeRequestId === requestId) {
          activeRequestId = null;
        }
        reject(new Error('Request timed out'));
      }
    }, 180000);
  });
}

/**
 * Cancel the active request
 */
async function cancelActiveRequest() {
  if (activeRequestId === null) {
    return { success: false, error: 'No active request to cancel' };
  }

  const targetId = activeRequestId;

  // Reject the pending promise immediately
  if (pendingRequests.has(targetId)) {
    const { reject } = pendingRequests.get(targetId);
    pendingRequests.delete(targetId);
    reject(new Error('Request cancelled by user'));
  }

  activeRequestId = null;

  // Tell native host to kill the subprocess
  try {
    const port = getNativePort();
    port.postMessage({
      action: 'cancel',
      targetRequestId: targetId,
      requestId: ++requestIdCounter
    });
  } catch (error) {
    console.error('Failed to send cancel to native host:', error);
  }

  return { success: true, cancelled: true };
}

/**
 * Extract page content via content script
 */
async function getPageContent(tabId, contentLimit = 10000) {
  try {
    const response = await browser.tabs.sendMessage(tabId, {
      type: 'GET_PAGE_CONTENT',
      contentLimit
    });
    return response;
  } catch (error) {
    console.error('Failed to get page content:', error);
    return { content: '', title: '', url: '' };
  }
}

/**
 * Get simplified HTML from page
 */
async function getPageHTML(tabId, contentLimit = 20000) {
  try {
    const response = await browser.tabs.sendMessage(tabId, {
      type: 'GET_PAGE_HTML',
      contentLimit
    });
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
        case 'PING_NATIVE': {
          const response = await sendNativeMessage({ action: 'ping' });
          sendResponse({ success: true, result: response.result });
          break;
        }

        case 'CANCEL_REQUEST': {
          const result = await cancelActiveRequest();
          sendResponse(result);
          break;
        }

        case 'GET_ACTIVE_REQUEST': {
          sendResponse({ activeRequestId });
          break;
        }

        case 'SUMMARIZE_PAGE': {
          const pageData = await getPageContent(message.tabId, message.contentLimit);
          const content = `Title: ${pageData.title}\nURL: ${pageData.url}\n\n${pageData.content}`;
          const response = await sendNativeMessage({
            action: 'summarize',
            content,
            model: message.model || 'sonnet'
          });
          sendResponse({
            success: response.success,
            result: response.result,
            log: {
              action: 'summarize',
              prompt_size: response.prompt_size,
              prompt_preview: response.prompt_preview,
              response_size: response.response_size,
              response_preview: response.response_preview,
              duration_ms: response.duration_ms
            }
          });
          break;
        }

        case 'ASK_QUESTION': {
          const pageData = await getPageContent(message.tabId, message.contentLimit);
          const content = `Title: ${pageData.title}\nURL: ${pageData.url}\n\n${pageData.content}`;
          const response = await sendNativeMessage({
            action: 'ask',
            question: message.question,
            content,
            model: message.model || 'sonnet'
          });
          sendResponse({
            success: response.success,
            result: response.result,
            log: {
              action: 'ask',
              question: message.question,
              prompt_size: response.prompt_size,
              prompt_preview: response.prompt_preview,
              response_size: response.response_size,
              response_preview: response.response_preview,
              duration_ms: response.duration_ms
            }
          });
          break;
        }

        case 'EXPLAIN_SELECTION': {
          const response = await sendNativeMessage({
            action: 'explain',
            selection: message.selection,
            model: message.model || 'sonnet'
          });
          sendResponse({
            success: response.success,
            result: response.result,
            log: {
              action: 'explain',
              prompt_size: response.prompt_size,
              prompt_preview: response.prompt_preview,
              response_size: response.response_size,
              response_preview: response.response_preview,
              duration_ms: response.duration_ms
            }
          });
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
          const response = await sendNativeMessage({
            action: 'analyze_network',
            networkData,
            model: message.model || 'sonnet'
          });
          sendResponse({
            success: response.success,
            result: response.result,
            log: {
              action: 'analyze_network',
              prompt_size: response.prompt_size,
              prompt_preview: response.prompt_preview,
              response_size: response.response_size,
              response_preview: response.response_preview,
              duration_ms: response.duration_ms
            }
          });
          break;
        }

        case 'SUGGEST_DOM_CHANGES': {
          // Use content limit for HTML, doubled for DOM structure (max 200KB)
          const htmlLimit = Math.min((message.contentLimit || 10000) * 2, 200000);
          const html = await getPageHTML(message.tabId, htmlLimit);
          const response = await sendNativeMessage({
            action: 'suggest_dom_changes',
            html,
            request: message.request,
            model: message.model || 'sonnet'
          });
          sendResponse({
            success: response.success,
            result: response.result,
            log: {
              action: 'suggest_dom_changes',
              prompt_size: response.prompt_size,
              prompt_preview: response.prompt_preview,
              response_size: response.response_size,
              response_preview: response.response_preview,
              duration_ms: response.duration_ms
            }
          });
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
      sendResponse({
        success: false,
        error: error.message,
        log: {
          action: message.type,
          error: error.message,
          duration_ms: 0
        }
      });
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
      const response = await sendNativeMessage({
        action: 'explain',
        selection
      });

      // Send result to sidebar with log data
      browser.runtime.sendMessage({
        type: 'CONTEXT_MENU_RESULT',
        action: 'explain',
        selection,
        result: response.result,
        log: {
          action: 'explain',
          prompt_size: response.prompt_size,
          prompt_preview: response.prompt_preview,
          response_size: response.response_size,
          response_preview: response.response_preview,
          duration_ms: response.duration_ms
        }
      });

      // Open sidebar to show result
      browser.sidebarAction.open();
    } catch (error) {
      console.error('Failed to explain selection:', error);
    }
  }
});

console.log('Fire Claude background script loaded');
