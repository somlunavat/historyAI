class BrowseChatPopup {
  constructor() {
    console.log('BrowseChatPopup constructor called');
    this.initializeUI();
    this.checkApiKey();
    this.loadChatHistory();
  }

  async initializeUI() {
    console.log('Initializing UI...');
    
    const sendBtn = document.getElementById('sendBtn');
    const clearBtn = document.getElementById('clearBtn');
    const chatInput = document.getElementById('chatInput');
    
    console.log('Elements found:', { sendBtn, clearBtn, chatInput });
    
    if (sendBtn) {
      sendBtn.addEventListener('click', () => {
        console.log('Send button clicked');
        this.sendMessage();
      });
    }
    
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        console.log('Clear button clicked');
        this.clearHistory();
      });
    }
    
    if (chatInput) {
      chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          console.log('Enter key pressed');
          this.sendMessage();
        }
      });

      chatInput.addEventListener('input', () => this.autoResizeInput());
      chatInput.focus();
    }
  }

  autoResizeInput() {
    const input = document.getElementById('chatInput');
    if (input) {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 80) + 'px';
    }
  }

  async loadChatHistory() {
    console.log('Loading chat history...');
    try {
      const response = await this.sendMessageWithRetry({ action: 'getChatHistory' });
      console.log('Chat history response:', response);
      
      if (response && response.chatHistory && response.chatHistory.length > 0) {
        const messagesContainer = document.getElementById('chatMessages');
        const welcomeMessage = messagesContainer.querySelector('.welcome-message');
        if (welcomeMessage) {
          welcomeMessage.remove();
        }
        
        response.chatHistory.forEach(message => {
          if (message.role === 'user') {
            this.addMessage(message.content, 'user');
          } else if (message.role === 'assistant') {
            this.addMessage(message.content, 'assistant', message.sources || []);
          }
        });
      }
    } catch (error) {
      console.error('Error loading chat history:', error);
    }
  }

  async clearHistory() {
    console.log('Clearing history...');
    if (confirm('Clear your chat history? This cannot be undone.')) {
      try {
        await this.sendMessageWithRetry({ action: 'clearHistory' });
        const messagesContainer = document.getElementById('chatMessages');
        messagesContainer.innerHTML = `
          <div class="welcome-message">
            <span class="welcome-icon">✨</span>
            <p>History cleared. Start a fresh conversation!</p>
          </div>
        `;
      } catch (error) {
        console.error('Error clearing history:', error);
        this.showSystemMessage(`Error clearing history: ${error.message}`);
      }
    }
  }

  async checkApiKey() {
    console.log('Checking API key...');
    try {
      const testResponse = await this.sendMessageWithRetry({ action: 'checkApiKey' });
      console.log('API key check response:', testResponse);
      
      if (!testResponse || !testResponse.hasApiKey) {
        this.showSetupMessage();
      }
    } catch (error) {
      console.error('Error checking API key:', error);
      this.showSystemMessage(`Setup required: ${error.message}`);
      this.showSetupMessage();
    }
  }

  showSetupMessage() {
    document.getElementById('chatInput').disabled = true;
    document.getElementById('sendBtn').disabled = true;
    this.showSystemMessage('Please configure your OpenAI API key in background.js to get started.');
  }

  showSystemMessage(message) {
    this.addMessage(message, 'system');
  }

  async sendMessage() {
    console.log('Sending message...');
    const input = document.getElementById('chatInput');
    const query = input.value.trim();
    
    console.log('Query:', query);
    
    if (!query) return;

    input.value = '';
    input.style.height = 'auto';
    this.setSendButtonState(false);

    this.addMessage(query, 'user');

    const welcomeMessage = document.querySelector('.welcome-message');
    if (welcomeMessage) {
      welcomeMessage.remove();
    }

    const loadingMsg = this.addMessage('Searching your history...', 'system');

    try {
      const response = await this.sendMessageWithRetry({ 
        action: 'chatQuery', 
        query 
      });

      console.log('Chat response:', response);
      loadingMsg.remove();

      if (!response) {
        this.showSystemMessage('No response received. Extension may need to be reloaded.');
      } else if (response.error) {
        this.showSystemMessage(`Error: ${response.error}`);
      } else if (response.answer) {
        this.addMessage(response.answer, 'assistant', response.sources || []);
      } else if (typeof response === 'string') {
        this.addMessage(response, 'assistant');
      } else if (response.message) {
        this.addMessage(response.message, 'assistant');
      } else if (response.choices && response.choices[0] && response.choices[0].message) {
        this.addMessage(response.choices[0].message.content, 'assistant');
      } else {
        this.showSystemMessage('Received unexpected response format.');
      }
    } catch (error) {
      console.error('Error sending message:', error);
      loadingMsg.remove();
      
      if (error.message && error.message.includes('Receiving end does not exist')) {
        this.showSystemMessage('Extension service unavailable. Try reloading the extension.');
      } else if (error.message && error.message.includes('Extension context invalidated')) {
        this.showSystemMessage('Extension context lost. Please reopen this popup.');
      } else {
        this.showSystemMessage(`Error: ${error.message || 'Unknown error occurred'}`);
      }
    }

    this.setSendButtonState(true);
    if (input) input.focus();
  }

  async sendMessageWithRetry(message, maxRetries = 3, timeoutMs = 30000) {
    let lastError;
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
          throw new Error('Chrome runtime not available');
        }
        
        const response = await Promise.race([
          new Promise((resolve, reject) => {
            try {
              chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message || 'Chrome runtime error'));
                  return;
                }
                resolve(response);
              });
            } catch (syncError) {
              reject(syncError);
            }
          }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Request timeout')), timeoutMs)
          )
        ]);
        
        return response;
      } catch (error) {
        lastError = error;
        
        if (error.message.includes('timeout') || 
            error.message.includes('port closed') ||
            error.message.includes('Extension context invalidated')) {
          throw error;
        }
        
        if (i === maxRetries - 1) {
          throw lastError;
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      }
    }
  }

  addMessage(content, type, sources = null) {
    console.log('Adding message:', { content, type, sources });
    
    const messagesContainer = document.getElementById('chatMessages');
    if (!messagesContainer) {
      console.error('Messages container not found');
      return;
    }
    
    const messageEl = document.createElement('div');
    messageEl.className = `message ${type}`;
    
    const contentEl = document.createElement('div');
    contentEl.className = 'message-content';
    contentEl.textContent = content;
    messageEl.appendChild(contentEl);

    if (sources && sources.length > 0) {
      const sourcesEl = document.createElement('div');
      sourcesEl.className = 'sources';
      
      const titleEl = document.createElement('div');
      titleEl.className = 'sources-title';
      titleEl.textContent = 'Sources';
      sourcesEl.appendChild(titleEl);
      
      sources.forEach(source => {
        const sourceEl = document.createElement('div');
        sourceEl.className = 'source';
        
        const relevanceScore = source.relevanceScore ? 
          ` (${(parseFloat(source.relevanceScore) * 100).toFixed(0)}%)` : '';
        
        sourceEl.innerHTML = `
          <a href="${source.url}" target="_blank" title="${source.url}">
            ${this.truncateText(source.title, 40)}
          </a>
          <span class="source-meta">• ${source.lastVisit}</span>
        `;
        
        sourcesEl.appendChild(sourceEl);
      });
      
      contentEl.appendChild(sourcesEl);
    }

    messagesContainer.appendChild(messageEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    
    return messageEl;
  }

  truncateText(text, maxLength) {
    if (!text || text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }

  setSendButtonState(enabled) {
    const sendBtn = document.getElementById('sendBtn');
    if (!sendBtn) {
      console.error('Send button not found');
      return;
    }
    
    sendBtn.disabled = !enabled;
    
    if (enabled) {
      sendBtn.innerHTML = '<span class="send-icon">↗</span>';
    } else {
      sendBtn.innerHTML = '<div class="loading"></div>';
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM loaded, initializing popup...');
  new BrowseChatPopup();
});