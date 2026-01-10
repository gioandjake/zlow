// multiplayer.js: WebSocket client for multiplayer cycling sessions
export class MultiplayerClient {
  constructor({ serverUrl = 'ws://localhost:8081', getToken = () => null } = {}) {
    this.serverUrl = serverUrl;
    this.getToken = getToken;
    this.ws = null;
    this.roomId = null;
    this.isConnected = false;
    this.listeners = new Map();
    this.messageQueue = [];
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 2000;
  }

  /**
   * Join a multiplayer lobby/room
   * @param {string} roomId - The room ID to join
   * @returns {Promise<boolean>} - True if successfully joined
   */
  async joinRoom(roomId) {
    this.roomId = roomId;
    return this._connectWebSocket();
  }

  /**
   * Connect to the WebSocket server
   * @private
   */
  _connectWebSocket() {
    return this._ensureFreshToken().then((token) => {
      if (!token) {
        console.error('[Multiplayer] No authentication token available');
        return false;
      }

      return new Promise((resolve) => {
        let wsUrl = this.serverUrl;
        if (!wsUrl.endsWith('/ws')) {
          wsUrl = wsUrl.endsWith('/') ? wsUrl + 'ws' : wsUrl + '/ws';
        }
        const url = new URL(wsUrl);
        url.searchParams.set('token', token);
        url.searchParams.set('room', this.roomId);
        
        const fullUrl = url.toString();
        console.log(`[Multiplayer] Connecting to: ${fullUrl}`);

        try {
          this.ws = new WebSocket(fullUrl);

          this.ws.onopen = () => {
            console.log(`[Multiplayer] Connected to room: ${this.roomId}`);
            this.isConnected = true;
            this.reconnectAttempts = 0;
            this._flushMessageQueue();
            this._emit('connected', { roomId: this.roomId });
            resolve(true);
          };

          this.ws.onmessage = (event) => {
            console.log('[Multiplayer] Received message:', event.data);
            try {
              const message = JSON.parse(event.data);
              console.log('[Multiplayer] Parsed message:', message);
              this._handleMessage(message);
            } catch (err) {
              console.error('[Multiplayer] Failed to parse message:', err);
            }
          };

          this.ws.onerror = (error) => {
            console.error('[Multiplayer] WebSocket error:', error);
            this._emit('error', { error });
          };

          this.ws.onclose = (event) => {
            console.log(`[Multiplayer] Disconnected from server. Code: ${event.code}, Reason: ${event.reason}, Clean: ${event.wasClean}`);
            this.isConnected = false;
            this._emit('disconnected');
            if (this.reconnectAttempts === 0) {
              // First attempt failed, likely server not running or connection rejected
              const reason = event.reason || 'Unknown reason';
              console.error(`[Multiplayer] First connection attempt failed. Reason: ${reason}`);
              this._showErrorMessage(`Unable to connect to multiplayer server (${reason}). Make sure the server is running on localhost:8081`);
            }
            this._attemptReconnect();
          };
        } catch (err) {
          console.error('Failed to create WebSocket:', err);
          resolve(false);
        }
      });
    });
  }

  /**
   * Handle incoming message from server
   * @private
   */
  _handleMessage(message) {
    const { type } = message;
    console.log('[Multiplayer] Handling message type:', type, 'Content:', message);
    
    // Emit all message types as events
    this._emit(type, message);
  }

  /**
   * Send rider state to other players
   * @param {Object} state - { power, speed, position, ... }
   */
  sendState(state) {
    this._sendMessage({
      type: 'state_update',
      content: state
    });
  }

  /**
   * Send a chat message
   * @param {string} message - The message text
   */
  sendChat(message) {
    this._sendMessage({
      type: 'message',
      content: message
    });
  }

  /**
   * Send a message through WebSocket
   * @private
   */
  _sendMessage(message) {
    console.log('[Multiplayer] Attempting to send message:', message, 'Connected:', this.isConnected, 'WS:', this.ws);
    if (this.isConnected && this.ws) {
      const msgStr = JSON.stringify(message);
      console.log('[Multiplayer] Sending message:', msgStr);
      this.ws.send(msgStr);
    } else {
      // Queue message for when connected
      console.log('[Multiplayer] Not connected, queueing message');
      this.messageQueue.push(message);
    }
  }

  /**
   * Flush queued messages when connection is established
   * @private
   */
  _flushMessageQueue() {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Ensure we have a fresh, valid token
   * @private
   */
  async _ensureFreshToken() {
    let token = this.getToken();
    
    // Check if token exists and is valid
    if (token) {
      try {
        const parts = token.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(atob(parts[1]));
          const expiresAt = payload.exp * 1000; // Convert to milliseconds
          const now = Date.now();
          
          // If token is still valid for at least 1 minute, use it
          if (now + 60000 < expiresAt) {
            console.log('[MultiplayerClient] Using existing valid token');
            return token;
          }
        }
      } catch (e) {
        // If parsing fails, try to get a fresh token anyway
        console.log('[MultiplayerClient] Token parsing failed, fetching fresh token');
      }
    }

    // Token is missing, invalid, or expired - we need to get one
    console.log('[MultiplayerClient] Token missing or expired');
    return null;
  }

  /**
   * Attempt to reconnect to server
   * @private
   */
  _attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1);
      console.log(`Reconnecting in ${delay}ms... (attempt ${this.reconnectAttempts})`);
      setTimeout(() => this._connectWebSocket(), delay);
    } else {
      console.error('Max reconnection attempts reached');
      this._emit('reconnect_failed');
    }
  }

  /**
   * Register an event listener
   * @param {string} event - Event name
   * @param {Function} callback - Callback function
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  /**
   * Unregister an event listener
   * @param {string} event - Event name
   * @param {Function} callback - Callback function
   */
  off(event, callback) {
    if (!this.listeners.has(event)) return;
    const callbacks = this.listeners.get(event);
    const index = callbacks.indexOf(callback);
    if (index > -1) {
      callbacks.splice(index, 1);
    }
  }

  /**
   * Emit an event to all listeners
   * @private
   */
  _emit(event, data) {
    if (!this.listeners.has(event)) return;
    this.listeners.get(event).forEach(callback => {
      try {
        callback(data);
      } catch (err) {
        console.error(`Error in listener for ${event}:`, err);
      }
    });
  }

  /**
   * Disconnect from the server
   */
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.roomId = null;
  }

  /**
   * Show error message (to be overridden by modal)
   * @private
   */
  _showErrorMessage(message) {
    console.error('Connection Error:', message);
  }
}

/**
 * Multiplayer UI Modal
 * Handles joining rooms via WebSocket
 */
export class MultiplayerModal {
  constructor({
    getElement = (id) => document.getElementById(id),
    getToken = () => null,
    onJoinRoom = () => {},
    apiBase = 'http://localhost:8080'
  } = {}) {
    this.getElement = getElement;
    this.multiplayerClient = null;
    this.getToken = getToken;
    this.apiBase = apiBase;
    this.onJoinRoom = onJoinRoom;
    this.isVisible = false;
    this._initUI();
  }

  /**
   * Ensures we have a fresh, valid token
   * Fetches a new one if the current one is missing or expired
   * @private
   */
  async _ensureFreshToken() {
    let token = this.getToken();
    
    // Check if token exists and is valid
    if (token) {
      try {
        const parts = token.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(atob(parts[1]));
          const expiresAt = payload.exp * 1000; // Convert to milliseconds
          const now = Date.now();
          
          // If token is still valid for at least 1 minute, use it
          if (now + 60000 < expiresAt) {
            return token;
          }
        }
      } catch (e) {
        // If parsing fails, try to get a fresh token anyway
      }
    }

    // Token is missing, invalid, or expired - fetch a fresh one
    console.log('[MultiplayerModal] Token missing or expired. Fetching fresh token...');
    try {
      const response = await fetch(`${this.apiBase}/auth/test-token?t=${Date.now()}`);
      const data = await response.json();
      if (data.token) {
        localStorage.setItem('zlow_token', data.token);
        console.log('[MultiplayerModal] Fresh token obtained');
        return data.token;
      }
    } catch (err) {
      console.error('[MultiplayerModal] Failed to fetch fresh token:', err);
    }

    return null;
  }

  /**
   * Initialize the UI elements
   * @private
   */
  _initUI() {
    // Create modal container
    const modal = document.createElement('div');
    modal.id = 'multiplayer-modal';
    modal.style.cssText = `
      display: none;
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(255, 255, 255, 0.95);
      border: 3px solid #000;
      border-radius: 8px;
      padding: 30px;
      z-index: 1000;
      max-width: 600px;
      width: 90%;
      max-height: 80vh;
      overflow-y: auto;
      font-family: sans-serif;
      color: #000;
    `;

    modal.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <h1 style="margin: 0; font-size: 32px; font-weight: bold;">Multiplayer UX</h1>
        <button id="mp-close-btn" style="font-size: 20px; background: none; border: none; cursor: pointer; padding: 0; width: 30px; height: 30px;">✕</button>
      </div>

      <div style="margin-bottom: 30px;">
        <h2 style="font-size: 24px; margin-top: 0; margin-bottom: 15px;">Create Lobby</h2>
        <button id="mp-create-btn" style="background: #4CAF50; color: white; border: none; padding: 12px 24px; border-radius: 4px; cursor: pointer; font-size: 16px; font-weight: bold; width: 100%; margin-bottom: 10px;">
          ➕ Create Lobby
        </button>
        <div id="mp-created-info" style="display: none; padding: 12px; background: #e8f5e9; border-radius: 4px; border: 2px solid #4CAF50;">
          <div style="font-weight: bold; margin-bottom: 8px;">Lobby Created!</div>
          <div style="margin-bottom: 8px;">Share this Room ID with others:</div>
          <div style="display: flex; gap: 8px;">
            <input id="mp-room-id-display" type="text" readonly style="flex: 1; padding: 8px; border: 1px solid #ccc; border-radius: 4px; background: white; font-weight: bold;">
            <button id="mp-copy-btn" style="background: #2196F3; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: bold;">Copy</button>
          </div>
          <button id="mp-join-created-btn" style="background: #4CAF50; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; font-weight: bold; width: 100%; margin-top: 10px;">
            ✓ Join My Lobby
          </button>
        </div>
      </div>

      <div style="border-top: 2px solid #ddd; padding-top: 20px;">
        <h2 style="font-size: 24px; margin-top: 0; margin-bottom: 15px;">Join Lobby</h2>
        <div style="margin-bottom: 15px;">
          <label style="display: block; margin-bottom: 5px; font-weight: bold;">Room ID</label>
          <input id="mp-join-id" type="text" placeholder="Enter room ID to join" style="width: 100%; padding: 10px; border: 2px solid #ccc; border-radius: 4px; box-sizing: border-box; font-size: 16px;">
        </div>
        <button id="mp-join-btn" style="background: #2196F3; color: white; border: none; padding: 12px 24px; border-radius: 4px; cursor: pointer; font-size: 16px; font-weight: bold; width: 100%;">
          ✓ Join Lobby
        </button>
      </div>

      <div id="mp-status" style="margin-top: 20px; padding: 10px; background: #f0f0f0; border-radius: 4px; display: none; font-size: 14px;"></div>
    `;

    document.body.appendChild(modal);
    this.modal = modal;

    // Bind events
    this.getElement('mp-close-btn').addEventListener('click', () => this.hide());
    this.getElement('mp-create-btn').addEventListener('click', () => this._handleCreateLobby());
    this.getElement('mp-join-btn').addEventListener('click', () => this._handleJoinLobby());
    this.getElement('mp-copy-btn').addEventListener('click', () => this._copyRoomIdToClipboard());
    this.getElement('mp-join-created-btn').addEventListener('click', () => this._handleJoinCreatedLobby());

    // Close on outside click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.hide();
    });
  }

  /**
   * Generate a random room ID
   * @private
   */
  _generateRoomId() {
    return 'room-' + Math.random().toString(36).substr(2, 9).toUpperCase();
  }

  /**
   * Handle create lobby button click
   * @private
   */
  _handleCreateLobby() {
    const roomId = this._generateRoomId();
    this.createdRoomId = roomId;
    
    // Show the created info section
    this.getElement('mp-created-info').style.display = 'block';
    this.getElement('mp-room-id-display').value = roomId;
    
    this._showStatus(`Lobby created with ID: ${roomId}`, 'success');
  }

  /**
   * Copy room ID to clipboard
   * @private
   */
  _copyRoomIdToClipboard() {
    const roomId = this.getElement('mp-room-id-display').value;
    navigator.clipboard.writeText(roomId).then(() => {
      const btn = this.getElement('mp-copy-btn');
      const originalText = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => {
        btn.textContent = originalText;
      }, 2000);
    }).catch(() => {
      this._showStatus('Failed to copy to clipboard', 'error');
    });
  }

  /**
   * Join the lobby that was just created
   * @private
   */
  async _handleJoinCreatedLobby() {
    const roomId = this.createdRoomId;
    if (!roomId) return;

    this._showStatus('Connecting to your lobby...', 'info');

    try {
      // Ensure we have a fresh token before attempting to connect
      const token = await this._ensureFreshToken();
      if (!token) {
        this._showStatus('Failed to obtain authentication token', 'error');
        return;
      }

      // Create or reuse multiplayer client with fresh token getter
      if (!this.multiplayerClient) {
        this.multiplayerClient = new MultiplayerClient({
          serverUrl: 'ws://localhost:8081',
          getToken: () => localStorage.getItem('zlow_token') || token
        });
        
        // Set error handler on the client
        this.multiplayerClient._showErrorMessage = (msg) => this._showStatus(msg, 'error');
      }

      const joined = await this.multiplayerClient.joinRoom(roomId);
      if (joined) {
        this._showStatus(`Connected to lobby: ${roomId}`, 'success');
        console.log('[MultiplayerModal] Calling onJoinRoom with roomId:', roomId);
        this.onJoinRoom({ roomId });
        setTimeout(() => this.hide(), 1000);
      } else {
        this._showStatus('Failed to connect to server', 'error');
      }
    } catch (error) {
      this._showStatus(`Error: ${error.message}`, 'error');
    }
  }

  /**
   * Handle join lobby button click
   * @private
   */
  async _handleJoinLobby() {
    const roomId = this.getElement('mp-join-id').value.trim();

    if (!roomId) {
      this._showStatus('Please enter a room ID', 'error');
      return;
    }

    this._showStatus('Connecting to room...', 'info');

    try {
      // Ensure we have a fresh token before attempting to connect
      const token = await this._ensureFreshToken();
      if (!token) {
        this._showStatus('Failed to obtain authentication token', 'error');
        return;
      }

      // Create or reuse multiplayer client with fresh token getter
      if (!this.multiplayerClient) {
        this.multiplayerClient = new MultiplayerClient({
          serverUrl: 'ws://localhost:8081',
          getToken: () => localStorage.getItem('zlow_token') || token
        });
        
        // Set error handler on the client
        this.multiplayerClient._showErrorMessage = (msg) => this._showStatus(msg, 'error');
      }

      const joined = await this.multiplayerClient.joinRoom(roomId);
      if (joined) {
        this._showStatus(`Connected to room: ${roomId}`, 'success');
        this.onJoinRoom({ roomId });
        setTimeout(() => this.hide(), 1000);
      } else {
        this._showStatus('Failed to connect to server', 'error');
      }
    } catch (error) {
      this._showStatus(`Error: ${error.message}`, 'error');
    }
  }

  /**
   * Show status message
   * @private
   */
  _showStatus(message, type = 'info') {
    const statusEl = this.getElement('mp-status');
    statusEl.textContent = message;
    statusEl.style.display = 'block';
    statusEl.style.background = type === 'error' ? '#ffebee' : type === 'success' ? '#e8f5e9' : '#e3f2fd';
    statusEl.style.color = type === 'error' ? '#c62828' : type === 'success' ? '#2e7d32' : '#1565c0';
    
    if (type === 'success') {
      setTimeout(() => {
        statusEl.style.display = 'none';
      }, 2000);
    }
  }

  /**
   * Show the modal
   */
  show() {
    this.modal.style.display = 'block';
    this.isVisible = true;
  }

  /**
   * Hide the modal
   */
  hide() {
    this.modal.style.display = 'none';
    this.isVisible = false;
  }

  /**
   * Toggle modal visibility
   */
  toggle() {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }
}
