class PageContentCapture {
  constructor() {
    this.isCapturing = false;
    this.captureTimeout = null;
    this.init();
  }

  init() {
    if (document.readyState === 'complete') {
      this.scheduleCapture(1000);
    } else if (document.readyState === 'interactive') {
      this.scheduleCapture(2000);
    } else {
      document.addEventListener('DOMContentLoaded', () => this.scheduleCapture(2000));
      window.addEventListener('load', () => this.scheduleCapture(3000));
    }

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.scheduleCapture(1000);
    });

    // for spas
    let lastUrl = location.href;
    new MutationObserver(() => {
      const url = location.href;
      if (url !== lastUrl) {
        lastUrl = url;
        this.scheduleCapture(3000);
      }
    }).observe(document, { subtree: true, childList: true });
  }

  scheduleCapture(delay = 2000) {
    if (this.captureTimeout) clearTimeout(this.captureTimeout);
    
    this.captureTimeout = setTimeout(() => {
      this.capturePageContent();
    }, delay);
  }

  async capturePageContent() {
    if (this.isCapturing || !document.body) return;

    const url = window.location.href;
    

    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || 
        url.startsWith('about:') || url.startsWith('moz-extension://')) {
      return;
    }

    this.isCapturing = true;

    try {
      const content = this.extractPageContent();
      
      if (content.text.length > 50) {
        await this.storePageContent(content);
      }
    } catch (error) {} finally {
      this.isCapturing = false;
    }
  }

  extractPageContent() {
    const url = window.location.href;
    const title = document.title || 'Untitled';

    let mainContent = this.findMainContent();
    
    if (!mainContent) {
      mainContent = document.body;
    }

    const extractedText = this.extractCleanText(mainContent);

    return {
      url: url,
      title: title,
      text: extractedText,
      timestamp: Date.now(),
      wordCount: extractedText.split(/\s+/).filter(w => w.length > 0).length,
      summary: this.createSummary(extractedText),
      captured: true
    };
  }

  findMainContent() {
    const strategies = [
      () => {
        const candidates = ['article', 'main', '[role="main"]'];
        for (const selector of candidates) {
          const elements = document.querySelectorAll(selector);
          for (const el of elements) {
            const text = el.textContent || '';
            if (text.length > 200) return el;
          }
        }
        return null;
      },
      
      () => {
        const candidates = [
          '.post-content', '.entry-content', '.article-body', '.content',
          '.post-body', '#content', '.story-body', '.article-text',
          '.post', '.article', '.blog-post', '.news-article', '.page-content'
        ];
        
        for (const selector of candidates) {
          const elements = document.querySelectorAll(selector);
          for (const el of elements) {
            const text = el.textContent || '';
            if (text.length > 200) return el;
          }
        }
        return null;
      },
      
      () => {
        const candidates = document.querySelectorAll('div, section, article');
        let bestElement = null;
        let bestScore = 0;
        
        for (const el of candidates) {
          const classes = el.className.toLowerCase();
          const id = el.id.toLowerCase();
          
          if (classes.includes('nav') || classes.includes('menu') || 
              classes.includes('sidebar') || classes.includes('footer') ||
              classes.includes('header') || id.includes('nav') ||
              id.includes('menu') || id.includes('sidebar')) {
            continue;
          }
          
          const textLength = (el.textContent || '').length;
          if (textLength > bestScore && textLength > 300) {
            bestScore = textLength;
            bestElement = el;
          }
        }
        
        return bestElement;
      }
    ];

    for (const strategy of strategies) {
      const result = strategy();
      if (result) return result;
    }

    return null;
  }

  extractCleanText(element) {
    const clone = element.cloneNode(true);

    const unwantedSelectors = [
      'script', 'style', 'noscript', 'iframe', 'embed', 'object',
      'nav', 'header', 'footer', 'aside', '.nav', '.menu', '.sidebar',
      '.advertisement', '.ad', '.ads', '.social-share', '.comments',
      '.related-posts', '.newsletter', '.popup', '.modal', '.overlay',
      '[class*="ad-"]', '[id*="ad-"]', '[class*="advertisement"]',
      '.cookie-banner', '.gdpr', '.privacy-notice', 'button'
    ];

    unwantedSelectors.forEach(selector => {
      const elements = clone.querySelectorAll(selector);
      elements.forEach(el => el.remove());
    });

    const textContent = clone.textContent || clone.innerText || '';
    
    const cleanText = textContent
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .trim();

    return cleanText.substring(0, 8000);
  }

  createSummary(text) {
    if (!text || text.length < 50) return text;
    
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 20);
    let summary = '';
    let wordCount = 0;
    
    for (const sentence of sentences.slice(0, 5)) {
      const sentenceWords = sentence.trim().split(/\s+/).length;
      if (wordCount + sentenceWords > 100) break;
      
      summary += sentence.trim() + '. ';
      wordCount += sentenceWords;
    }
    
    return summary.trim() || text.substring(0, 200) + '...';
  }

  async storePageContent(content) {
    const urlKey = this.createUrlKey(content.url);
    const storageKey = `content_${urlKey}`;
    
    const storageData = {};
    storageData[storageKey] = content;
    
    await chrome.storage.local.set(storageData);
    
    try {
      chrome.runtime.sendMessage({
        action: 'storePageContent',
        content: content
      });
    } catch (error) {}
  }

  createUrlKey(url) {
    try {
      const cleanUrl = url.split('?')[0].split('#')[0];
      return btoa(cleanUrl).replace(/[^a-zA-Z0-9]/g, '').substring(0, 50);
    } catch (e) {
      return url.replace(/[^a-zA-Z0-9]/g, '').substring(0, 50);
    }
  }
}


if (typeof window !== 'undefined' && window.location && 
    !window.location.href.startsWith('chrome://') && 
    !window.location.href.startsWith('chrome-extension://') &&
    !window.location.href.startsWith('about:') &&
    !window.location.href.startsWith('moz-extension://')) {
  
  new PageContentCapture();
}