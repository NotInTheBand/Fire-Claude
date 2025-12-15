/**
 * Fire Claude Sidebar Controller
 */

class FireClaudeSidebar {
  constructor() {
    this.currentTabId = null;
    this.isLoading = false;
    this.pendingChanges = null;
    this.logs = [];
    this.selectedModel = 'sonnet'; // Default to Sonnet 4.5

    this.init();
  }

  getSelectedModel() {
    return document.getElementById('modelSelect')?.value || this.selectedModel;
  }

  async init() {
    // Get current tab
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) {
      this.currentTabId = tabs[0].id;
    }

    this.bindEvents();
    this.checkConnection();

    // Listen for tab changes
    browser.tabs.onActivated.addListener(async (activeInfo) => {
      this.currentTabId = activeInfo.tabId;
    });

    // Listen for context menu results
    browser.runtime.onMessage.addListener((message) => {
      if (message.type === 'CONTEXT_MENU_RESULT') {
        this.switchPanel('chat');
        this.addMessage('user', `Explain: "${message.selection.substring(0, 100)}${message.selection.length > 100 ? '...' : ''}"`);
        this.addMessage('assistant', message.result);

        // Log the context menu action
        if (message.log) {
          this.addLog(message.log);
        }
      }
    });
  }

  bindEvents() {
    // Navigation
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.switchPanel(e.target.dataset.panel));
    });

    // Chat
    document.getElementById('sendBtn').addEventListener('click', () => this.sendQuestion());
    document.getElementById('cancelBtn').addEventListener('click', () => this.cancelRequest());
    document.getElementById('chatInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendQuestion();
      }
    });

    // Quick actions
    document.getElementById('summarizeBtn').addEventListener('click', () => this.summarizePage());
    document.getElementById('suggestBtn').addEventListener('click', () => this.suggestChanges());

    // Network
    document.getElementById('analyzeNetworkBtn').addEventListener('click', () => this.analyzeNetwork());
    document.getElementById('refreshNetworkBtn').addEventListener('click', () => this.refreshNetworkList());
    document.getElementById('clearNetworkBtn').addEventListener('click', () => this.clearNetworkAnalysis());

    // Logs
    document.getElementById('clearLogsBtn').addEventListener('click', () => this.clearLogs());

    // Modal
    document.getElementById('modalClose').addEventListener('click', () => this.hideModal());
    document.getElementById('cancelChangesBtn').addEventListener('click', () => this.hideModal());
    document.getElementById('applyChangesBtn').addEventListener('click', () => this.applyChanges());
  }

  async checkConnection() {
    const status = document.getElementById('connectionStatus');
    try {
      const response = await browser.runtime.sendMessage({ type: 'PING_NATIVE' });
      if (response.success) {
        status.textContent = 'Connected';
        status.className = 'connection-status connected';
      } else {
        throw new Error(response.error);
      }
    } catch (error) {
      status.textContent = 'Disconnected';
      status.className = 'connection-status error';
      console.error('Connection check failed:', error);
    }
  }

  switchPanel(panelName) {
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.panel === panelName);
    });

    document.querySelectorAll('.panel').forEach(panel => {
      panel.classList.toggle('active', panel.id === `${panelName}Panel`);
    });

    if (panelName === 'network') {
      this.refreshNetworkList();
    } else if (panelName === 'logs') {
      this.renderLogs();
    }
  }

  addMessage(role, content) {
    const container = document.getElementById('chatMessages');
    const messageEl = document.createElement('div');
    messageEl.className = `message ${role}`;
    messageEl.textContent = content;
    container.appendChild(messageEl);
    container.scrollTop = container.scrollHeight;
  }

  setLoading(loading) {
    this.isLoading = loading;
    document.getElementById('sendBtn').disabled = loading;
    document.getElementById('summarizeBtn').disabled = loading;
    document.getElementById('suggestBtn').disabled = loading;

    // Show/hide cancel button
    document.getElementById('cancelBtn').style.display = loading ? 'block' : 'none';
    document.getElementById('sendBtn').style.display = loading ? 'none' : 'block';

    const existingLoader = document.getElementById('loadingIndicator');
    if (existingLoader) {
      existingLoader.remove();
    }

    if (loading) {
      const container = document.getElementById('chatMessages');
      const loadingEl = document.createElement('div');
      loadingEl.className = 'message system';
      loadingEl.id = 'loadingIndicator';
      loadingEl.innerHTML = '<span class="loading"></span> Claude is thinking...';
      container.appendChild(loadingEl);
      container.scrollTop = container.scrollHeight;
    }
  }

  async cancelRequest() {
    try {
      const response = await browser.runtime.sendMessage({ type: 'CANCEL_REQUEST' });
      if (response.success && response.cancelled) {
        this.addMessage('system', 'Request cancelled.');
        this.addLog({
          action: 'cancel',
          duration_ms: 0,
          status: 'cancelled'
        });
      }
    } catch (error) {
      console.error('Failed to cancel:', error);
    }
    this.setLoading(false);
  }

  async sendQuestion() {
    const input = document.getElementById('chatInput');
    const question = input.value.trim();

    if (!question || this.isLoading) return;

    input.value = '';
    this.addMessage('user', question);
    this.setLoading(true);

    try {
      const response = await browser.runtime.sendMessage({
        type: 'ASK_QUESTION',
        tabId: this.currentTabId,
        question,
        model: this.getSelectedModel()
      });

      if (response.success) {
        this.addMessage('assistant', response.result);
      } else {
        this.addMessage('error', `Error: ${response.error}`);
      }

      // Log the request
      if (response.log) {
        this.addLog(response.log);
      }
    } catch (error) {
      if (error.message !== 'Request cancelled by user') {
        this.addMessage('error', `Error: ${error.message}`);
      }
      this.addLog({
        action: 'ask',
        error: error.message,
        duration_ms: 0
      });
    }

    this.setLoading(false);
  }

  async summarizePage() {
    if (this.isLoading) return;

    this.addMessage('system', 'Summarizing page...');
    this.setLoading(true);

    try {
      const response = await browser.runtime.sendMessage({
        type: 'SUMMARIZE_PAGE',
        tabId: this.currentTabId,
        model: this.getSelectedModel()
      });

      if (response.success) {
        this.addMessage('assistant', response.result);
      } else {
        this.addMessage('error', `Error: ${response.error}`);
      }

      // Log the request
      if (response.log) {
        this.addLog(response.log);
      }
    } catch (error) {
      if (error.message !== 'Request cancelled by user') {
        this.addMessage('error', `Error: ${error.message}`);
      }
      this.addLog({
        action: 'summarize',
        error: error.message,
        duration_ms: 0
      });
    }

    this.setLoading(false);
  }

  async suggestChanges() {
    const request = prompt('What changes would you like Claude to suggest?');
    if (!request) return;

    this.addMessage('user', `Suggest changes: ${request}`);
    this.setLoading(true);

    try {
      const response = await browser.runtime.sendMessage({
        type: 'SUGGEST_DOM_CHANGES',
        tabId: this.currentTabId,
        request,
        model: this.getSelectedModel()
      });

      if (response.success) {
        this.addMessage('assistant', response.result);

        // Try to parse JSON changes
        try {
          let jsonText = response.result;
          console.log('Parsing DOM changes from:', jsonText.substring(0, 200));

          // First, try to extract JSON from markdown code blocks
          const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (codeBlockMatch) {
            jsonText = codeBlockMatch[1].trim();
            console.log('Extracted from code block:', jsonText.substring(0, 200));
          }

          // Try to parse the extracted text directly first
          let changes = null;
          try {
            const parsed = JSON.parse(jsonText);
            if (Array.isArray(parsed)) {
              changes = parsed;
              console.log('Parsed directly as JSON array:', changes.length, 'changes');
            }
          } catch {
            // If direct parse fails, try to find JSON array in text
            // Find opening bracket, then find matching closing bracket (skip strings)
            const startIdx = jsonText.indexOf('[');
            if (startIdx !== -1) {
              let depth = 0;
              let endIdx = -1;
              let inString = false;
              let escapeNext = false;
              for (let i = startIdx; i < jsonText.length; i++) {
                const ch = jsonText[i];
                if (escapeNext) {
                  escapeNext = false;
                  continue;
                }
                if (ch === '\\' && inString) {
                  escapeNext = true;
                  continue;
                }
                if (ch === '"') {
                  inString = !inString;
                  continue;
                }
                if (!inString) {
                  if (ch === '[') depth++;
                  else if (ch === ']') {
                    depth--;
                    if (depth === 0) {
                      endIdx = i;
                      break;
                    }
                  }
                }
              }
              if (endIdx !== -1) {
                const jsonStr = jsonText.substring(startIdx, endIdx + 1);
                console.log('Found JSON via bracket matching:', jsonStr.substring(0, 200));
                changes = JSON.parse(jsonStr);
                console.log('Parsed via bracket matching:', changes.length, 'changes');
              }
            }
          }

          if (Array.isArray(changes) && changes.length > 0) {
            console.log('Showing modal with', changes.length, 'changes');
            this.pendingChanges = changes;
            this.showModal(changes);
          } else {
            console.log('No valid changes array found');
          }
        } catch (parseError) {
          console.log('Could not parse changes as JSON:', parseError);
        }
      } else {
        this.addMessage('error', `Error: ${response.error}`);
      }

      // Log the request
      if (response.log) {
        this.addLog(response.log);
      }
    } catch (error) {
      if (error.message !== 'Request cancelled by user') {
        this.addMessage('error', `Error: ${error.message}`);
      }
      this.addLog({
        action: 'suggest_dom_changes',
        error: error.message,
        duration_ms: 0
      });
    }

    this.setLoading(false);
  }

  showModal(changes) {
    document.getElementById('changesPreview').textContent = JSON.stringify(changes, null, 2);
    document.getElementById('domChangesModal').classList.add('active');
  }

  hideModal() {
    document.getElementById('domChangesModal').classList.remove('active');
    this.pendingChanges = null;
  }

  async applyChanges() {
    if (!this.pendingChanges) return;

    try {
      const response = await browser.runtime.sendMessage({
        type: 'APPLY_DOM_CHANGES',
        tabId: this.currentTabId,
        changes: this.pendingChanges
      });

      if (response.success && response.result) {
        const results = response.result.results || [];
        const succeeded = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success);

        if (failed.length === 0) {
          this.addMessage('system', `All ${succeeded} change(s) applied successfully!`);
        } else if (succeeded > 0) {
          const errors = failed.map(f => f.error).join(', ');
          this.addMessage('system', `${succeeded} change(s) applied. ${failed.length} failed: ${errors}`);
        } else {
          const errors = failed.map(f => f.error).join(', ');
          this.addMessage('error', `Failed to apply changes: ${errors}`);
        }
      } else {
        this.addMessage('error', `Failed to apply changes: ${response.error || 'Unknown error'}`);
      }
    } catch (error) {
      this.addMessage('error', `Error applying changes: ${error.message}`);
    }

    this.hideModal();
  }

  async refreshNetworkList() {
    const list = document.getElementById('networkList');

    try {
      const response = await browser.runtime.sendMessage({
        type: 'GET_NETWORK_DATA',
        tabId: this.currentTabId
      });

      list.innerHTML = '';

      if (!response.success || !response.data || response.data.length === 0) {
        list.innerHTML = '<div class="network-empty">No network requests recorded yet. Navigate to a page to start tracking.</div>';
        return;
      }

      // Show last 20 requests, newest first
      response.data.slice(-20).reverse().forEach(req => {
        const item = document.createElement('div');
        item.className = 'network-item';

        const url = new URL(req.url);
        const shortUrl = url.pathname.length > 50
          ? url.pathname.substring(0, 50) + '...'
          : url.pathname || '/';

        const statusClass = req.statusCode >= 200 && req.statusCode < 400 ? 'status-ok' : 'status-error';

        item.innerHTML = `
          <div class="url" title="${req.url}">${shortUrl}</div>
          <div class="meta">
            <span class="${statusClass}">${req.statusCode}</span>
            <span>${req.type}</span>
            <span>${req.method || 'GET'}</span>
          </div>
        `;
        list.appendChild(item);
      });
    } catch (error) {
      list.innerHTML = '<div class="network-empty">Error loading network data</div>';
    }
  }

  async analyzeNetwork() {
    const analysisEl = document.getElementById('networkAnalysis');
    analysisEl.innerHTML = '<span class="loading"></span> Analyzing network activity...';
    this.setLoading(true);

    try {
      const response = await browser.runtime.sendMessage({
        type: 'ANALYZE_NETWORK',
        tabId: this.currentTabId,
        model: this.getSelectedModel()
      });

      if (response.success) {
        analysisEl.textContent = response.result;
      } else {
        analysisEl.textContent = `Error: ${response.error}`;
      }

      // Log the request
      if (response.log) {
        this.addLog(response.log);
      }
    } catch (error) {
      analysisEl.textContent = `Error: ${error.message}`;
      this.addLog({
        action: 'analyze_network',
        error: error.message,
        duration_ms: 0
      });
    }

    this.setLoading(false);
  }

  clearNetworkAnalysis() {
    document.getElementById('networkAnalysis').textContent = '';
  }

  // Logging methods
  addLog(logData) {
    const timestamp = new Date().toISOString();
    const entry = {
      ...logData,
      timestamp,
      id: Date.now()
    };

    this.logs.unshift(entry); // Add to beginning

    // Keep only last 50 logs
    if (this.logs.length > 50) {
      this.logs.pop();
    }

    this.updateLogCount();
  }

  updateLogCount() {
    document.getElementById('logCount').textContent = `${this.logs.length} entries`;
  }

  clearLogs() {
    this.logs = [];
    this.renderLogs();
    this.updateLogCount();
  }

  renderLogs() {
    const list = document.getElementById('logsList');

    if (this.logs.length === 0) {
      list.innerHTML = '<div class="logs-empty">No requests logged yet. Make a request to see logs here.</div>';
      return;
    }

    list.innerHTML = '';

    this.logs.forEach(log => {
      const entry = document.createElement('div');
      entry.className = 'log-entry';
      entry.dataset.id = log.id;

      // Format duration
      const duration = log.duration_ms ? `${log.duration_ms}ms` : '-';
      const durationClass = log.error ? 'error' : (log.status === 'cancelled' ? 'cancelled' : 'duration');

      // Estimate tokens (~4 chars per token)
      const promptTokens = log.prompt_size ? Math.ceil(log.prompt_size / 4) : 0;
      const responseTokens = log.response_size ? Math.ceil(log.response_size / 4) : 0;

      // Format timestamp
      const time = new Date(log.timestamp).toLocaleTimeString();

      entry.innerHTML = `
        <div class="log-header">
          <span class="log-action">${log.action || 'unknown'}</span>
          <div class="log-meta">
            <span class="${durationClass}">${log.error ? 'Error' : (log.status === 'cancelled' ? 'Cancelled' : duration)}</span>
            <span>${time}</span>
          </div>
        </div>
        <div class="log-details">
          <div class="log-stats">
            <div class="log-stat">
              <span class="log-stat-label">Duration</span>
              <span class="log-stat-value">${duration}</span>
            </div>
            <div class="log-stat">
              <span class="log-stat-label">Prompt</span>
              <span class="log-stat-value">${log.prompt_size ? this.formatBytes(log.prompt_size) : '-'}</span>
            </div>
            <div class="log-stat">
              <span class="log-stat-label">Response</span>
              <span class="log-stat-value">${log.response_size ? this.formatBytes(log.response_size) : '-'}</span>
            </div>
            <div class="log-stat">
              <span class="log-stat-label">Est. Tokens</span>
              <span class="log-stat-value tokens">~${promptTokens + responseTokens}</span>
            </div>
          </div>
          ${log.prompt_preview ? `
          <div class="log-section">
            <div class="log-section-title">Context Sent</div>
            <div class="log-section-content">${this.escapeHtml(log.prompt_preview)}</div>
          </div>
          ` : ''}
          ${log.response_preview ? `
          <div class="log-section">
            <div class="log-section-title">Response Received</div>
            <div class="log-section-content">${this.escapeHtml(log.response_preview)}</div>
          </div>
          ` : ''}
          ${log.error ? `
          <div class="log-section">
            <div class="log-section-title">Error</div>
            <div class="log-section-content" style="color: var(--error-color);">${this.escapeHtml(log.error)}</div>
          </div>
          ` : ''}
        </div>
      `;

      // Toggle expand on click
      entry.querySelector('.log-header').addEventListener('click', () => {
        entry.classList.toggle('expanded');
      });

      list.appendChild(entry);
    });
  }

  formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize sidebar
new FireClaudeSidebar();
