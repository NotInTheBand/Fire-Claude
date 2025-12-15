/**
 * Fire Claude Sidebar Controller
 */

class FireClaudeSidebar {
  constructor() {
    this.currentTabId = null;
    this.isLoading = false;
    this.pendingChanges = null;

    this.init();
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
        question
      });

      if (response.success) {
        this.addMessage('assistant', response.result);
      } else {
        this.addMessage('error', `Error: ${response.error}`);
      }
    } catch (error) {
      this.addMessage('error', `Error: ${error.message}`);
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
        tabId: this.currentTabId
      });

      if (response.success) {
        this.addMessage('assistant', response.result);
      } else {
        this.addMessage('error', `Error: ${response.error}`);
      }
    } catch (error) {
      this.addMessage('error', `Error: ${error.message}`);
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
        request
      });

      if (response.success) {
        this.addMessage('assistant', response.result);

        // Try to parse JSON changes
        try {
          const jsonMatch = response.result.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const changes = JSON.parse(jsonMatch[0]);
            if (Array.isArray(changes) && changes.length > 0) {
              this.pendingChanges = changes;
              this.showModal(changes);
            }
          }
        } catch (parseError) {
          console.log('Could not parse changes as JSON:', parseError);
        }
      } else {
        this.addMessage('error', `Error: ${response.error}`);
      }
    } catch (error) {
      this.addMessage('error', `Error: ${error.message}`);
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

      if (response.success) {
        this.addMessage('system', 'Changes applied successfully!');
      } else {
        this.addMessage('error', `Failed to apply changes: ${response.error}`);
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

    try {
      const response = await browser.runtime.sendMessage({
        type: 'ANALYZE_NETWORK',
        tabId: this.currentTabId
      });

      if (response.success) {
        analysisEl.textContent = response.result;
      } else {
        analysisEl.textContent = `Error: ${response.error}`;
      }
    } catch (error) {
      analysisEl.textContent = `Error: ${error.message}`;
    }
  }

  clearNetworkAnalysis() {
    document.getElementById('networkAnalysis').textContent = '';
  }
}

// Initialize sidebar
new FireClaudeSidebar();
