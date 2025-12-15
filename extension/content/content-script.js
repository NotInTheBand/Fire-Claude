/**
 * Fire Claude Content Script
 * Handles DOM access, extraction, and manipulation
 */

(function() {
  'use strict';

  // Store original state for undo functionality
  let undoStack = [];

  /**
   * Page content extractor
   */
  const PageExtractor = {
    /**
     * Extract main content from the page
     */
    getContent() {
      // Try to find main content area
      const mainSelectors = [
        'main',
        'article',
        '[role="main"]',
        '.content',
        '.main-content',
        '#content',
        '#main',
        '.post-content',
        '.article-content'
      ];

      let mainElement = null;
      for (const selector of mainSelectors) {
        mainElement = document.querySelector(selector);
        if (mainElement) break;
      }

      // Fall back to body if no main content found
      if (!mainElement) {
        mainElement = document.body;
      }

      return this.extractText(mainElement);
    },

    /**
     * Extract text with basic structure preservation
     */
    extractText(element) {
      const textParts = [];
      const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
        {
          acceptNode(node) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const style = window.getComputedStyle(node);
              if (style.display === 'none' || style.visibility === 'hidden') {
                return NodeFilter.FILTER_REJECT;
              }
              const tagName = node.tagName.toLowerCase();
              if (['script', 'style', 'noscript', 'iframe', 'svg', 'path'].includes(tagName)) {
                return NodeFilter.FILTER_REJECT;
              }
            }
            return NodeFilter.FILTER_ACCEPT;
          }
        }
      );

      let node;
      while (node = walker.nextNode()) {
        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent.trim();
          if (text) {
            textParts.push(text);
          }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const tagName = node.tagName.toLowerCase();
          if (['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'br', 'tr'].includes(tagName)) {
            textParts.push('\n');
          }
        }
      }

      let content = textParts.join(' ')
        .replace(/\s+/g, ' ')
        .replace(/\n\s+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      // Limit to ~50KB
      if (content.length > 50000) {
        content = content.substring(0, 50000) + '\n\n[Content truncated...]';
      }

      return content;
    },

    /**
     * Get simplified HTML for DOM modification suggestions
     */
    getSimplifiedHTML() {
      const clone = document.body.cloneNode(true);

      // Remove non-essential elements
      const removeSelectors = ['script', 'style', 'noscript', 'iframe', 'svg'];
      removeSelectors.forEach(selector => {
        clone.querySelectorAll(selector).forEach(el => el.remove());
      });

      // Simplify attributes - keep only essential ones
      const keepAttrs = ['id', 'class', 'href', 'src', 'alt', 'type', 'name', 'value', 'placeholder'];
      clone.querySelectorAll('*').forEach(el => {
        Array.from(el.attributes).forEach(attr => {
          if (!keepAttrs.includes(attr.name)) {
            el.removeAttribute(attr.name);
          }
        });
      });

      let html = clone.innerHTML;

      // Limit size
      if (html.length > 100000) {
        html = html.substring(0, 100000) + '\n<!-- Content truncated -->';
      }

      return html;
    }
  };

  /**
   * DOM modifier with undo support
   */
  const DOMModifier = {
    /**
     * Apply DOM changes based on Claude's suggestions
     */
    applyChanges(changes) {
      const results = [];
      const undoBatch = [];

      changes.forEach((change, index) => {
        try {
          const undoInfo = this.applyChange(change);
          if (undoInfo) {
            undoBatch.push(undoInfo);
          }
          results.push({ index, success: true });
        } catch (error) {
          results.push({ index, success: false, error: error.message });
        }
      });

      // Save undo batch
      if (undoBatch.length > 0) {
        undoStack.push(undoBatch);
      }

      return results;
    },

    applyChange(change) {
      const el = document.querySelector(change.selector);
      if (!el) {
        throw new Error(`Element not found: ${change.selector}`);
      }

      let undoInfo = {
        selector: change.selector,
        action: change.action
      };

      switch (change.action) {
        case 'setText':
          undoInfo.originalValue = el.textContent;
          el.textContent = change.value;
          break;

        case 'setHTML':
          undoInfo.originalValue = el.innerHTML;
          el.innerHTML = change.value;
          break;

        case 'setAttribute':
          undoInfo.attribute = change.attribute;
          undoInfo.originalValue = el.getAttribute(change.attribute);
          el.setAttribute(change.attribute, change.value);
          break;

        case 'addClass':
          undoInfo.className = change.className;
          undoInfo.hadClass = el.classList.contains(change.className);
          el.classList.add(change.className);
          break;

        case 'removeClass':
          undoInfo.className = change.className;
          undoInfo.hadClass = el.classList.contains(change.className);
          el.classList.remove(change.className);
          break;

        case 'setStyle':
          undoInfo.property = change.property;
          undoInfo.originalValue = el.style[change.property];
          el.style[change.property] = change.value;
          break;

        case 'remove':
          undoInfo.parent = el.parentNode;
          undoInfo.nextSibling = el.nextSibling;
          undoInfo.element = el.cloneNode(true);
          el.remove();
          break;

        default:
          throw new Error(`Unknown action: ${change.action}`);
      }

      return undoInfo;
    },

    /**
     * Undo last batch of changes
     */
    undo() {
      if (undoStack.length === 0) {
        return { success: false, error: 'Nothing to undo' };
      }

      const batch = undoStack.pop();
      const results = [];

      // Undo in reverse order
      for (let i = batch.length - 1; i >= 0; i--) {
        const undo = batch[i];
        try {
          this.undoChange(undo);
          results.push({ success: true });
        } catch (error) {
          results.push({ success: false, error: error.message });
        }
      }

      return { success: true, results };
    },

    undoChange(undo) {
      if (undo.action === 'remove') {
        // Re-insert removed element
        if (undo.nextSibling) {
          undo.parent.insertBefore(undo.element, undo.nextSibling);
        } else {
          undo.parent.appendChild(undo.element);
        }
        return;
      }

      const el = document.querySelector(undo.selector);
      if (!el) return;

      switch (undo.action) {
        case 'setText':
          el.textContent = undo.originalValue;
          break;

        case 'setHTML':
          el.innerHTML = undo.originalValue;
          break;

        case 'setAttribute':
          if (undo.originalValue === null) {
            el.removeAttribute(undo.attribute);
          } else {
            el.setAttribute(undo.attribute, undo.originalValue);
          }
          break;

        case 'addClass':
          if (!undo.hadClass) {
            el.classList.remove(undo.className);
          }
          break;

        case 'removeClass':
          if (undo.hadClass) {
            el.classList.add(undo.className);
          }
          break;

        case 'setStyle':
          el.style[undo.property] = undo.originalValue || '';
          break;
      }
    }
  };

  /**
   * Element highlighter
   */
  const Highlighter = {
    overlay: null,

    init() {
      if (this.overlay) return;

      this.overlay = document.createElement('div');
      this.overlay.id = 'fire-claude-highlight';
      this.overlay.style.cssText = `
        position: fixed;
        pointer-events: none;
        background: rgba(218, 119, 86, 0.2);
        border: 2px solid #da7756;
        border-radius: 4px;
        z-index: 2147483647;
        display: none;
        transition: all 0.15s ease;
      `;
      document.body.appendChild(this.overlay);
    },

    highlight(selector) {
      this.init();

      const el = document.querySelector(selector);
      if (!el) return false;

      const rect = el.getBoundingClientRect();
      this.overlay.style.top = rect.top + 'px';
      this.overlay.style.left = rect.left + 'px';
      this.overlay.style.width = rect.width + 'px';
      this.overlay.style.height = rect.height + 'px';
      this.overlay.style.display = 'block';

      return true;
    },

    clear() {
      if (this.overlay) {
        this.overlay.style.display = 'none';
      }
    }
  };

  /**
   * Message handler
   */
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
      switch (message.type) {
        case 'GET_PAGE_CONTENT':
          sendResponse({
            content: PageExtractor.getContent(),
            url: window.location.href,
            title: document.title
          });
          break;

        case 'GET_PAGE_HTML':
          sendResponse({
            html: PageExtractor.getSimplifiedHTML()
          });
          break;

        case 'APPLY_DOM_CHANGES':
          const results = DOMModifier.applyChanges(message.changes);
          sendResponse({ success: true, results });
          break;

        case 'UNDO_CHANGES':
          const undoResult = DOMModifier.undo();
          sendResponse(undoResult);
          break;

        case 'HIGHLIGHT_ELEMENT':
          const highlighted = Highlighter.highlight(message.selector);
          sendResponse({ success: highlighted });
          break;

        case 'CLEAR_HIGHLIGHT':
          Highlighter.clear();
          sendResponse({ success: true });
          break;

        default:
          sendResponse({ success: false, error: `Unknown message type: ${message.type}` });
      }
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }

    return true;
  });

  console.log('Fire Claude content script loaded');
})();
