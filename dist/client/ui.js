/**
 * Browser Management UI Logic
 * Initializes SignalingClient and WebRTCClient, manages UI state
 */
import { SignalingClient } from './ws-client';
import { WebRTCClient } from './webrtc-client';
class UIManager {
    constructor() {
        this.signalingClient = null;
        this.webrtcClient = null;
        this.apps = new Map();
        this.userInfo = null;
        this.messageLog = [];
        this.initializeDOM();
        this.checkAuthStatus();
    }
    initializeDOM() {
        // Get all DOM elements
        this.loginSection = document.getElementById('login-section');
        this.userSection = document.getElementById('user-section');
        this.appListSection = document.getElementById('app-list-section');
        this.connectionSection = document.getElementById('connection-section');
        this.messageSection = document.getElementById('message-section');
        this.userEmailSpan = document.getElementById('user-email');
        this.appListDiv = document.getElementById('app-list');
        this.messageLogDiv = document.getElementById('message-log');
        this.wsStatusSpan = document.getElementById('ws-status');
        this.logoutBtn = document.getElementById('logout-btn');
        // Set up event listeners
        this.logoutBtn.addEventListener('click', () => this.handleLogout());
        document.getElementById('login-btn')?.addEventListener('click', () => this.handleLogin());
        document.getElementById('refresh-apps-btn')?.addEventListener('click', () => this.refreshApps());
        document.getElementById('send-message-btn')?.addEventListener('click', () => this.handleSendMessage());
        document.getElementById('clear-log-btn')?.addEventListener('click', () => this.clearMessageLog());
    }
    async checkAuthStatus() {
        try {
            // Check /api/me endpoint - httpOnly cookie sent automatically
            const response = await fetch('/api/me');
            if (response.ok) {
                this.userInfo = await response.json();
                this.showUserInterface();
                // Cookie will be sent with WebSocket connection
                this.initializeWebSocket();
            }
            else {
                this.showLogin();
            }
        }
        catch (error) {
            console.error('Auth check failed:', error);
            this.showLogin();
        }
    }
    getToken() {
        // Try cookie first
        const cookies = document.cookie.split(';');
        for (const cookie of cookies) {
            const [name, value] = cookie.trim().split('=');
            if (name === 'token') {
                return value;
            }
        }
        // Try localStorage
        return localStorage.getItem('token');
    }
    clearToken() {
        document.cookie = 'token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
        localStorage.removeItem('token');
    }
    showLogin() {
        this.loginSection.style.display = 'block';
        this.userSection.style.display = 'none';
        this.appListSection.style.display = 'none';
        this.connectionSection.style.display = 'none';
        this.messageSection.style.display = 'none';
    }
    showUserInterface() {
        this.loginSection.style.display = 'none';
        this.userSection.style.display = 'block';
        this.appListSection.style.display = 'block';
        this.connectionSection.style.display = 'block';
        this.messageSection.style.display = 'block';
        if (this.userInfo) {
            this.userEmailSpan.textContent = this.userInfo.email;
        }
    }
    handleLogin() {
        window.location.href = '/auth/login';
    }
    handleLogout() {
        this.clearToken();
        if (this.signalingClient) {
            this.signalingClient.disconnect();
        }
        if (this.webrtcClient) {
            this.webrtcClient.disconnect();
        }
        this.showLogin();
    }
    async initializeWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;
        // Token not needed - cookie is sent automatically with WebSocket connection
        this.signalingClient = new SignalingClient(wsUrl);
        // Set up event handlers
        this.signalingClient.onConnected = () => {
            this.updateWSStatus('connected');
        };
        this.signalingClient.onDisconnected = () => {
            this.updateWSStatus('disconnected');
        };
        this.signalingClient.onAuthenticated = (payload) => {
            console.log('Authenticated:', payload);
            this.updateWSStatus('authenticated');
            // Request app list
            this.signalingClient?.getApps();
        };
        this.signalingClient.onAuthError = (payload) => {
            console.error('Auth error:', payload);
            this.updateWSStatus('error');
            alert('Authentication failed: ' + payload.error);
            this.handleLogout();
        };
        this.signalingClient.onAppsListReceived = (payload) => {
            console.log('Apps list received:', payload);
            payload.apps.forEach(app => {
                this.apps.set(app.appId, {
                    id: app.appId,
                    name: app.name,
                    capabilities: app.capabilities,
                    status: app.status,
                });
            });
            this.renderAppList();
        };
        this.signalingClient.onAppStatus = (payload) => {
            console.log('App status update:', payload);
            const app = this.apps.get(payload.appId);
            if (app) {
                app.status = payload.status;
                if (payload.name)
                    app.name = payload.name;
                if (payload.capabilities)
                    app.capabilities = payload.capabilities;
            }
            else {
                this.apps.set(payload.appId, {
                    id: payload.appId,
                    name: payload.name || payload.appId,
                    capabilities: payload.capabilities,
                    status: payload.status,
                });
            }
            this.renderAppList();
        };
        this.signalingClient.onError = (payload) => {
            console.error('WebSocket error:', payload);
            this.addLog('System', 'Error: ' + payload.message, 'received');
        };
        // Initialize WebRTC client
        this.webrtcClient = new WebRTCClient(this.signalingClient);
        this.webrtcClient.onDataChannelOpen = ({ appId }) => {
            console.log('Data channel opened:', appId);
            this.addLog(appId, 'Connection established', 'received');
            this.renderAppList();
        };
        this.webrtcClient.onDataChannelClose = ({ appId }) => {
            console.log('Data channel closed:', appId);
            this.addLog(appId, 'Connection closed', 'received');
            this.renderAppList();
        };
        this.webrtcClient.onDataChannelMessage = ({ appId, data }) => {
            console.log('Message from app:', appId, data);
            const message = typeof data === 'string' ? data : `[Binary data: ${data.byteLength} bytes]`;
            this.addLog(appId, message, 'received');
        };
        this.webrtcClient.onConnectionStateChange = ({ appId, state }) => {
            console.log('Connection state change:', appId, state);
            this.renderAppList();
        };
        this.webrtcClient.onError = ({ appId, message }) => {
            console.error('WebRTC error:', appId, message);
            this.addLog(appId || 'System', 'Error: ' + message, 'received');
        };
        // Connect to WebSocket
        try {
            await this.signalingClient.connect();
        }
        catch (error) {
            console.error('Failed to connect to WebSocket:', error);
            this.updateWSStatus('error');
        }
    }
    updateWSStatus(status) {
        this.wsStatusSpan.textContent = status;
        this.wsStatusSpan.className = `status-${status}`;
    }
    async refreshApps() {
        if (this.signalingClient?.isConnected()) {
            this.signalingClient.getApps();
        }
        else {
            // Fallback to API
            try {
                const token = this.getToken();
                const response = await fetch('/api/apps', {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                    },
                });
                if (response.ok) {
                    const data = await response.json();
                    this.apps.clear();
                    data.apps.forEach((app) => {
                        this.apps.set(app.id, {
                            id: app.id,
                            name: app.name,
                            capabilities: app.capabilities,
                            status: 'offline',
                        });
                    });
                    this.renderAppList();
                }
            }
            catch (error) {
                console.error('Failed to fetch apps:', error);
            }
        }
    }
    renderAppList() {
        const appArray = Array.from(this.apps.values());
        if (appArray.length === 0) {
            this.appListDiv.innerHTML = '<p class="no-apps">No apps registered. Register an app to get started.</p>';
            return;
        }
        this.appListDiv.innerHTML = appArray.map(app => {
            const isOnline = app.status === 'online';
            const connectionState = this.webrtcClient?.getConnectionState(app.id);
            const dataChannelState = this.webrtcClient?.getDataChannelState(app.id);
            const isConnected = dataChannelState === 'open';
            return `
        <div class="app-card ${isOnline ? 'online' : 'offline'}">
          <div class="app-header">
            <span class="app-name">${this.escapeHtml(app.name)}</span>
            <span class="app-status ${isOnline ? 'status-online' : 'status-offline'}">
              ${isOnline ? '● Online' : '○ Offline'}
            </span>
          </div>
          <div class="app-details">
            <div class="app-id">ID: ${this.escapeHtml(app.id)}</div>
            ${app.capabilities && app.capabilities.length > 0
                ? `<div class="app-capabilities">Capabilities: ${app.capabilities.join(', ')}</div>`
                : ''}
            ${connectionState
                ? `<div class="app-connection-state">WebRTC: ${connectionState}</div>`
                : ''}
            ${dataChannelState
                ? `<div class="app-datachannel-state">DataChannel: ${dataChannelState}</div>`
                : ''}
          </div>
          <div class="app-actions">
            ${isOnline && !isConnected
                ? `<button class="btn btn-primary" onclick="window.uiManager.connectToApp('${app.id}')">Connect</button>`
                : ''}
            ${isConnected
                ? `<button class="btn btn-danger" onclick="window.uiManager.disconnectFromApp('${app.id}')">Disconnect</button>`
                : ''}
          </div>
        </div>
      `;
        }).join('');
    }
    async connectToApp(appId) {
        if (!this.webrtcClient) {
            alert('WebRTC client not initialized');
            return;
        }
        try {
            this.addLog(appId, 'Connecting...', 'sent');
            await this.webrtcClient.connectToApp(appId);
            this.addLog(appId, 'Connected successfully', 'received');
        }
        catch (error) {
            console.error('Failed to connect to app:', error);
            this.addLog(appId, 'Connection failed: ' + error, 'received');
            alert('Failed to connect to app: ' + error);
        }
    }
    disconnectFromApp(appId) {
        if (!this.webrtcClient) {
            return;
        }
        this.webrtcClient.disconnect(appId);
        this.addLog(appId, 'Disconnected', 'sent');
        this.renderAppList();
    }
    handleSendMessage() {
        const input = document.getElementById('message-input');
        const appSelect = document.getElementById('target-app');
        const message = input.value.trim();
        const targetAppId = appSelect.value;
        if (!message) {
            alert('Please enter a message');
            return;
        }
        if (!targetAppId) {
            alert('Please select a target app');
            return;
        }
        if (!this.webrtcClient) {
            alert('WebRTC client not initialized');
            return;
        }
        try {
            this.webrtcClient.sendMessage(targetAppId, message);
            this.addLog(targetAppId, message, 'sent');
            input.value = '';
        }
        catch (error) {
            console.error('Failed to send message:', error);
            alert('Failed to send message: ' + error);
        }
    }
    addLog(appId, data, direction) {
        const entry = {
            timestamp: new Date(),
            appId,
            direction,
            data,
        };
        this.messageLog.push(entry);
        // Limit log size
        if (this.messageLog.length > 100) {
            this.messageLog.shift();
        }
        this.renderMessageLog();
        // Update target app dropdown
        this.updateTargetAppDropdown();
    }
    renderMessageLog() {
        this.messageLogDiv.innerHTML = this.messageLog
            .slice()
            .reverse()
            .map(entry => {
            const time = entry.timestamp.toLocaleTimeString();
            const directionClass = entry.direction === 'sent' ? 'log-sent' : 'log-received';
            const directionLabel = entry.direction === 'sent' ? '→' : '←';
            return `
          <div class="log-entry ${directionClass}">
            <span class="log-time">${time}</span>
            <span class="log-direction">${directionLabel}</span>
            <span class="log-app">${this.escapeHtml(entry.appId)}</span>
            <span class="log-data">${this.escapeHtml(entry.data)}</span>
          </div>
        `;
        })
            .join('');
    }
    updateTargetAppDropdown() {
        const select = document.getElementById('target-app');
        const currentValue = select.value;
        const connectedApps = this.webrtcClient?.getConnectedApps() || [];
        select.innerHTML = '<option value="">-- Select App --</option>' +
            connectedApps.map(appId => {
                const app = this.apps.get(appId);
                const name = app ? app.name : appId;
                return `<option value="${appId}">${this.escapeHtml(name)}</option>`;
            }).join('');
        // Restore previous selection if still valid
        if (connectedApps.includes(currentValue)) {
            select.value = currentValue;
        }
    }
    clearMessageLog() {
        this.messageLog = [];
        this.renderMessageLog();
    }
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
// Global initialization function
export function initializeUI() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            window.uiManager = new UIManager();
        });
    }
    else {
        window.uiManager = new UIManager();
    }
}
// Auto-initialize
initializeUI();
