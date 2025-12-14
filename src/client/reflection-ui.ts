/**
 * gRPC Server Reflection Test UI
 * Allows users to connect to a Go App and list available gRPC services
 */

import { SignalingClient } from './ws-client';
import { WebRTCClient } from './webrtc-client';
import { ReflectionClient } from '../grpc/reflection/reflection';

interface App {
  id: string;
  name: string;
  capabilities?: string[];
  status?: 'online' | 'offline';
}

interface UserInfo {
  id: string;
  email: string;
  name: string;
}

// Debug helper
function debug(context: string, ...args: any[]) {
  console.log(`[ReflectionUI:${context}]`, ...args);
}

class ReflectionUIManager {
  private signalingClient: SignalingClient | null = null;
  private webrtcClient: WebRTCClient | null = null;
  private reflectionClient: ReflectionClient | null = null;
  private apps: Map<string, App> = new Map();
  private userInfo: UserInfo | null = null;
  private connectedAppId: string | null = null;

  // DOM Elements
  private loginSection!: HTMLElement;
  private userSection!: HTMLElement;
  private appListSection!: HTMLElement;
  private reflectionSection!: HTMLElement;
  private userEmailSpan!: HTMLElement;
  private appSelectElement!: HTMLSelectElement;
  private wsStatusSpan!: HTMLElement;
  private logoutBtn!: HTMLElement;
  private connectBtn!: HTMLElement;
  private resultsDiv!: HTMLElement;
  private statusDiv!: HTMLElement;

  constructor() {
    debug('constructor', 'Initializing ReflectionUIManager');
    // Ensure DOM is ready before initializing
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.initialize());
    } else {
      this.initialize();
    }
  }

  private initialize(): void {
    debug('initialize', 'DOM ready, initializing...');
    this.initializeDOM();
    this.checkAuthStatus();
  }

  private initializeDOM(): void {
    // Get all DOM elements
    this.loginSection = document.getElementById('login-section')!;
    this.userSection = document.getElementById('user-section')!;
    this.appListSection = document.getElementById('app-list-section')!;
    this.reflectionSection = document.getElementById('reflection-section')!;
    this.userEmailSpan = document.getElementById('user-email')!;
    this.appSelectElement = document.getElementById('app-select') as HTMLSelectElement;
    this.wsStatusSpan = document.getElementById('ws-status')!;
    this.logoutBtn = document.getElementById('logout-btn')!;
    this.connectBtn = document.getElementById('connect-btn')!;
    this.resultsDiv = document.getElementById('results')!;
    this.statusDiv = document.getElementById('status')!;

    // Set up event listeners
    this.logoutBtn.addEventListener('click', () => this.handleLogout());
    document.getElementById('login-btn')?.addEventListener('click', () => this.handleLogin());
    this.connectBtn.addEventListener('click', () => this.handleConnectAndList());
  }

  private async checkAuthStatus(): Promise<void> {
    debug('checkAuthStatus', 'Checking auth status...');
    try {
      // Check /api/me endpoint - httpOnly cookie sent automatically
      const response = await fetch('/api/me');
      debug('checkAuthStatus', 'Response status:', response.status);

      if (response.ok) {
        this.userInfo = await response.json();
        debug('checkAuthStatus', 'User info:', this.userInfo);
        this.showUserInterface();
        // Cookie will be sent with WebSocket connection
        this.initializeWebSocket();
      } else {
        debug('checkAuthStatus', 'Not authenticated, showing login');
        this.showLogin();
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      debug('checkAuthStatus', 'Error:', error);
      this.showLogin();
    }
  }

  private clearToken(): void {
    document.cookie = 'token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    localStorage.removeItem('token');
  }

  private showLogin(): void {
    this.loginSection.style.display = 'block';
    this.userSection.style.display = 'none';
    this.appListSection.style.display = 'none';
    this.reflectionSection.style.display = 'none';
  }

  private showUserInterface(): void {
    this.loginSection.style.display = 'none';
    this.userSection.style.display = 'block';
    this.appListSection.style.display = 'block';
    this.reflectionSection.style.display = 'block';

    if (this.userInfo) {
      this.userEmailSpan.textContent = this.userInfo.email;
    }
  }

  private handleLogin(): void {
    window.location.href = '/auth/login';
  }

  private handleLogout(): void {
    this.clearToken();
    if (this.signalingClient) {
      this.signalingClient.disconnect();
    }
    if (this.webrtcClient) {
      this.webrtcClient.disconnect();
    }
    this.showLogin();
  }

  private async initializeWebSocket(): Promise<void> {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    debug('initializeWebSocket', 'WebSocket URL:', wsUrl);

    // Token not needed - cookie is sent automatically with WebSocket connection
    this.signalingClient = new SignalingClient(wsUrl);

    // Set up event handlers
    this.signalingClient.onConnected = () => {
      debug('WS:onConnected', 'WebSocket connected');
      this.updateWSStatus('connected');
    };

    this.signalingClient.onDisconnected = () => {
      debug('WS:onDisconnected', 'WebSocket disconnected');
      this.updateWSStatus('disconnected');
    };

    this.signalingClient.onAuthenticated = (payload) => {
      debug('WS:onAuthenticated', 'Authenticated:', payload);
      this.updateWSStatus('authenticated');
      // Request app list
      debug('WS:onAuthenticated', 'Requesting app list...');
      this.signalingClient?.getApps();
    };

    this.signalingClient.onAuthError = (payload) => {
      debug('WS:onAuthError', 'Auth error:', payload);
      this.updateWSStatus('error');
      alert('Authentication failed: ' + payload.error);
      this.handleLogout();
    };

    this.signalingClient.onAppsListReceived = (payload) => {
      debug('WS:onAppsListReceived', 'Apps list received:', JSON.stringify(payload, null, 2));
      debug('WS:onAppsListReceived', 'Number of apps:', payload.apps?.length ?? 0);
      payload.apps.forEach((app, index) => {
        debug('WS:onAppsListReceived', `App ${index}:`, app);
        this.apps.set(app.appId, {
          id: app.appId,
          name: app.name,
          capabilities: app.capabilities,
          status: app.status,
        });
      });
      debug('WS:onAppsListReceived', 'Total apps in map:', this.apps.size);
      this.renderAppList();
    };

    this.signalingClient.onAppStatus = (payload) => {
      debug('WS:onAppStatus', 'App status update:', payload);
      const app = this.apps.get(payload.appId);
      if (app) {
        app.status = payload.status;
        if (payload.name) app.name = payload.name;
        if (payload.capabilities) app.capabilities = payload.capabilities;
      } else {
        this.apps.set(payload.appId, {
          id: payload.appId,
          name: payload.name || payload.appId,
          capabilities: payload.capabilities,
          status: payload.status,
        });
      }
      debug('WS:onAppStatus', 'Apps map after update:', Array.from(this.apps.entries()));
      this.renderAppList();
    };

    this.signalingClient.onError = (payload) => {
      debug('WS:onError', 'WebSocket error:', payload);
      this.setStatus('Error: ' + payload.message, 'error');
    };

    // Initialize WebRTC client
    debug('initializeWebSocket', 'Initializing WebRTC client');
    this.webrtcClient = new WebRTCClient(this.signalingClient);

    this.webrtcClient.onDataChannelOpen = ({ appId }) => {
      debug('WebRTC:onDataChannelOpen', 'Data channel opened:', appId);
      this.setStatus('Connected to ' + appId, 'success');
    };

    this.webrtcClient.onDataChannelClose = ({ appId }) => {
      debug('WebRTC:onDataChannelClose', 'Data channel closed:', appId);
      this.setStatus('Disconnected from ' + appId, 'info');
      if (this.connectedAppId === appId) {
        this.connectedAppId = null;
        this.reflectionClient = null;
      }
    };

    this.webrtcClient.onError = ({ appId, message }) => {
      debug('WebRTC:onError', 'WebRTC error:', appId, message);
      this.setStatus('Error: ' + message, 'error');
    };

    // Connect to WebSocket
    try {
      debug('initializeWebSocket', 'Connecting to WebSocket...');
      await this.signalingClient.connect();
      debug('initializeWebSocket', 'WebSocket connect() returned');
    } catch (error) {
      debug('initializeWebSocket', 'Failed to connect to WebSocket:', error);
      this.updateWSStatus('error');
    }
  }

  private updateWSStatus(status: string): void {
    this.wsStatusSpan.textContent = status;
    this.wsStatusSpan.className = `status-${status}`;
  }

  private renderAppList(): void {
    debug('renderAppList', 'Rendering app list...');
    debug('renderAppList', 'All apps:', Array.from(this.apps.values()));
    const appArray = Array.from(this.apps.values()).filter(app => app.status === 'online');
    debug('renderAppList', 'Online apps:', appArray);

    // Update select dropdown
    this.appSelectElement.innerHTML = '<option value="">-- Select an Online App --</option>' +
      appArray.map(app =>
        `<option value="${app.id}">${this.escapeHtml(app.name)} (${this.escapeHtml(app.id)})</option>`
      ).join('');

    // Enable/disable connect button
    this.connectBtn.disabled = appArray.length === 0;
    debug('renderAppList', 'Connect button disabled:', this.connectBtn.disabled);
  }

  private async handleConnectAndList(): Promise<void> {
    const selectedAppId = this.appSelectElement.value;
    debug('handleConnectAndList', 'Selected app ID:', selectedAppId);

    if (!selectedAppId) {
      alert('Please select an app');
      return;
    }

    if (!this.webrtcClient) {
      debug('handleConnectAndList', 'WebRTC client not initialized');
      alert('WebRTC client not initialized');
      return;
    }

    try {
      this.setStatus('Connecting to app...', 'info');
      this.connectBtn.disabled = true;

      // Connect to app via WebRTC
      debug('handleConnectAndList', 'Calling webrtcClient.connectToApp...');
      await this.webrtcClient.connectToApp(selectedAppId);
      this.connectedAppId = selectedAppId;
      debug('handleConnectAndList', 'Connected to app via WebRTC');

      this.setStatus('Connected! Listing services...', 'info');

      // Get transport
      debug('handleConnectAndList', 'Getting transport...');
      const transport = this.webrtcClient.getTransport(selectedAppId);
      debug('handleConnectAndList', 'Transport:', transport);
      if (!transport) {
        throw new Error('Failed to get transport');
      }

      // Create reflection client
      debug('handleConnectAndList', 'Creating ReflectionClient...');
      this.reflectionClient = new ReflectionClient(transport);

      // List services
      debug('handleConnectAndList', 'Calling listServices...');
      const response = await this.reflectionClient.listServices({ timeout: 10000 });
      debug('handleConnectAndList', 'listServices response:', response);

      // Display results
      this.displayResults(response);
      this.setStatus('Services listed successfully', 'success');

    } catch (error) {
      debug('handleConnectAndList', 'Error:', error);
      console.error('Failed to connect or list services:', error);
      this.setStatus('Error: ' + error, 'error');
      alert('Failed to list services: ' + error);
    } finally {
      this.connectBtn.disabled = false;
    }
  }

  private displayResults(response: any): void {
    if (!response.services || response.services.length === 0) {
      this.resultsDiv.innerHTML = '<div class="no-results">No services found</div>';
      return;
    }

    // Create a tree view of services
    const servicesHtml = response.services.map((service: any) => {
      const methodsHtml = service.methods && service.methods.length > 0
        ? `<ul class="methods-list">
            ${service.methods.map((method: string) =>
              `<li class="method-item">${this.escapeHtml(method)}</li>`
            ).join('')}
          </ul>`
        : '<div class="no-methods">No methods</div>';

      return `
        <div class="service-card">
          <div class="service-name">${this.escapeHtml(service.name)}</div>
          <div class="service-methods">
            <div class="methods-header">Methods:</div>
            ${methodsHtml}
          </div>
        </div>
      `;
    }).join('');

    this.resultsDiv.innerHTML = `
      <div class="results-header">Found ${response.services.length} service(s)</div>
      <div class="services-container">${servicesHtml}</div>
      <div class="results-footer">
        <button class="btn btn-secondary" onclick="window.reflectionUI.showRawJSON()">
          Show Raw JSON
        </button>
      </div>
    `;

    // Store response for raw JSON display
    (window as any).reflectionResponse = response;
  }

  public showRawJSON(): void {
    const response = (window as any).reflectionResponse;
    if (!response) {
      alert('No response data available');
      return;
    }

    const jsonString = JSON.stringify(response, null, 2);
    this.resultsDiv.innerHTML = `
      <div class="results-header">Raw JSON Response</div>
      <pre class="raw-json">${this.escapeHtml(jsonString)}</pre>
      <div class="results-footer">
        <button class="btn btn-secondary" onclick="location.reload()">
          Refresh Page
        </button>
      </div>
    `;
  }

  private setStatus(message: string, type: 'info' | 'success' | 'error'): void {
    this.statusDiv.textContent = message;
    this.statusDiv.className = `status-message status-${type}`;
    this.statusDiv.style.display = 'block';
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Global initialization function
export function initializeReflectionUI(): void {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      (window as any).reflectionUI = new ReflectionUIManager();
    });
  } else {
    (window as any).reflectionUI = new ReflectionUIManager();
  }
}

// Auto-initialize
initializeReflectionUI();
