"use strict";
var ClientUI = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/client/ui.ts
  var ui_exports = {};
  __export(ui_exports, {
    initializeUI: () => initializeUI
  });

  // src/client/ws-client.ts
  var SignalingClient = class {
    ws = null;
    wsUrl;
    token;
    reconnectAttempts = 0;
    maxReconnectAttempts = 10;
    reconnectTimeout = null;
    isManualDisconnect = false;
    isAuthenticated = false;
    // Event callbacks
    onAuthenticated = null;
    onAuthError = null;
    onAppStatus = null;
    onAppsListReceived = null;
    onOffer = null;
    onAnswer = null;
    onIce = null;
    onConnected = null;
    onDisconnected = null;
    onError = null;
    constructor(wsUrl, token = null) {
      this.wsUrl = wsUrl;
      this.token = token;
    }
    /**
     * Connect to the WebSocket signaling server
     */
    async connect() {
      if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
        return;
      }
      this.isManualDisconnect = false;
      return new Promise((resolve, reject) => {
        try {
          const url = new URL(this.wsUrl);
          if (this.token) {
            url.searchParams.set("token", this.token);
          }
          this.ws = new WebSocket(url.toString());
          this.ws.onopen = () => {
            this.reconnectAttempts = 0;
            this.onConnected?.();
            this.sendAuth();
            resolve();
          };
          this.ws.onmessage = (event) => {
            this.handleMessage(event.data);
          };
          this.ws.onerror = (event) => {
            console.error("WebSocket error:", event);
            this.onError?.({ message: "WebSocket error occurred" });
            reject(new Error("WebSocket connection error"));
          };
          this.ws.onclose = (event) => {
            this.isAuthenticated = false;
            this.onDisconnected?.();
            if (!this.isManualDisconnect) {
              this.scheduleReconnect();
            }
          };
        } catch (error) {
          reject(error);
        }
      });
    }
    /**
     * Disconnect from the WebSocket server
     */
    disconnect() {
      this.isManualDisconnect = true;
      this.isAuthenticated = false;
      if (this.reconnectTimeout !== null) {
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = null;
      }
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
    }
    /**
     * Check if the client is connected and authenticated
     */
    isConnected() {
      return this.ws?.readyState === WebSocket.OPEN && this.isAuthenticated;
    }
    /**
     * Send authentication message
     */
    sendAuth() {
      this.send({
        type: "auth",
        payload: { token: this.token }
      });
    }
    /**
     * Send WebRTC offer to a specific app
     */
    sendOffer(targetAppId, sdp) {
      this.send({
        type: "offer",
        payload: { targetAppId, sdp }
      });
    }
    /**
     * Send WebRTC answer
     */
    sendAnswer(sdp) {
      this.send({
        type: "answer",
        payload: { sdp }
      });
    }
    /**
     * Send ICE candidate
     */
    sendIce(candidate, targetAppId) {
      this.send({
        type: "ice",
        payload: { candidate, targetAppId }
      });
    }
    /**
     * Request list of online apps
     */
    getApps() {
      this.send({
        type: "get_apps",
        payload: {}
      });
    }
    /**
     * Send a message to the server
     */
    send(message) {
      if (this.ws?.readyState !== WebSocket.OPEN) {
        console.error("WebSocket is not open. Cannot send message:", message);
        return;
      }
      try {
        this.ws.send(JSON.stringify(message));
      } catch (error) {
        console.error("Failed to send message:", error);
        this.onError?.({ message: "Failed to send message" });
      }
    }
    /**
     * Handle incoming WebSocket messages
     */
    handleMessage(data) {
      try {
        const message = JSON.parse(data);
        switch (message.type) {
          case "auth_ok":
            this.isAuthenticated = true;
            this.onAuthenticated?.(message.payload);
            break;
          case "auth_error":
            this.isAuthenticated = false;
            this.onAuthError?.(message.payload);
            break;
          case "apps_list":
            this.onAppsListReceived?.(message.payload);
            break;
          case "app_status":
            this.onAppStatus?.(message.payload);
            break;
          case "offer":
            this.onOffer?.(message.payload);
            break;
          case "answer":
            this.onAnswer?.(message.payload);
            break;
          case "ice":
            this.onIce?.(message.payload);
            break;
          case "error":
            this.onError?.(message.payload);
            break;
          default:
            console.warn("Unknown message type:", message.type);
        }
      } catch (error) {
        console.error("Failed to parse message:", error);
        this.onError?.({ message: "Failed to parse server message" });
      }
    }
    /**
     * Schedule reconnection with exponential backoff
     */
    scheduleReconnect() {
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        console.error("Max reconnection attempts reached");
        this.onError?.({ message: "Failed to reconnect after multiple attempts" });
        return;
      }
      const delay = Math.min(1e3 * Math.pow(2, this.reconnectAttempts), 3e4);
      this.reconnectAttempts++;
      console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      this.reconnectTimeout = window.setTimeout(() => {
        this.connect().catch((error) => {
          console.error("Reconnection failed:", error);
        });
      }, delay);
    }
    /**
     * Update the JWT token (useful for token refresh)
     */
    updateToken(token) {
      this.token = token;
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.disconnect();
        this.connect().catch((error) => {
          console.error("Failed to reconnect with new token:", error);
        });
      }
    }
  };

  // src/client/webrtc-client.ts
  var DEFAULT_ICE_SERVERS = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ];
  var WebRTCClient = class {
    signalingClient;
    peerConnections = /* @__PURE__ */ new Map();
    iceServers;
    // Event callbacks
    onDataChannelOpen = null;
    onDataChannelClose = null;
    onDataChannelMessage = null;
    onConnectionStateChange = null;
    onError = null;
    constructor(signalingClient, iceServers = DEFAULT_ICE_SERVERS) {
      this.signalingClient = signalingClient;
      this.iceServers = iceServers;
      this.setupSignalingHandlers();
    }
    /**
     * Set up handlers for signaling messages
     */
    setupSignalingHandlers() {
      this.signalingClient.onAnswer = (payload) => {
        const { sdp, appId } = payload;
        this.handleAnswer(appId, sdp);
      };
      this.signalingClient.onIce = (payload) => {
        const { candidate, appId } = payload;
        if (appId) {
          this.handleIceCandidate(appId, candidate);
        }
      };
      this.signalingClient.onAppStatus = (payload) => {
        if (payload.status === "offline") {
          this.disconnect(payload.appId);
        }
      };
    }
    /**
     * Connect to a specific app by creating an offer
     */
    async connectToApp(appId) {
      if (this.peerConnections.has(appId)) {
        const existing = this.peerConnections.get(appId);
        if (existing.dataChannel?.readyState === "open") {
          return existing.dataChannel;
        }
        this.disconnect(appId);
      }
      const pc = new RTCPeerConnection({
        iceServers: this.iceServers
      });
      const dataChannel = pc.createDataChannel("data", {
        ordered: true
      });
      const peerConnection = {
        pc,
        dataChannel,
        appId
      };
      this.peerConnections.set(appId, peerConnection);
      this.setupPeerConnectionHandlers(appId, pc);
      this.setupDataChannelHandlers(appId, dataChannel);
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this.signalingClient.sendOffer(appId, offer.sdp);
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error("Data channel connection timeout"));
            this.disconnect(appId);
          }, 3e4);
          dataChannel.onopen = () => {
            clearTimeout(timeout);
            this.onDataChannelOpen?.({ appId });
            resolve(dataChannel);
          };
          dataChannel.onerror = (error) => {
            clearTimeout(timeout);
            this.onError?.({
              appId,
              message: `Data channel error: ${error}`
            });
            reject(error);
          };
        });
      } catch (error) {
        this.disconnect(appId);
        this.onError?.({
          appId,
          message: `Failed to create offer: ${error}`
        });
        throw error;
      }
    }
    /**
     * Disconnect from a specific app or all apps
     */
    disconnect(appId) {
      if (appId) {
        const peerConnection = this.peerConnections.get(appId);
        if (peerConnection) {
          this.closePeerConnection(peerConnection);
          this.peerConnections.delete(appId);
        }
      } else {
        for (const [id, pc] of this.peerConnections.entries()) {
          this.closePeerConnection(pc);
        }
        this.peerConnections.clear();
      }
    }
    /**
     * Send a message to a specific app
     */
    sendMessage(appId, data) {
      const peerConnection = this.peerConnections.get(appId);
      if (!peerConnection?.dataChannel) {
        this.onError?.({
          appId,
          message: "No data channel available for this app"
        });
        return;
      }
      if (peerConnection.dataChannel.readyState !== "open") {
        this.onError?.({
          appId,
          message: `Data channel is not open (state: ${peerConnection.dataChannel.readyState})`
        });
        return;
      }
      try {
        peerConnection.dataChannel.send(data);
      } catch (error) {
        this.onError?.({
          appId,
          message: `Failed to send message: ${error}`
        });
      }
    }
    /**
     * Get connection state for a specific app
     */
    getConnectionState(appId) {
      const peerConnection = this.peerConnections.get(appId);
      return peerConnection?.pc.connectionState || null;
    }
    /**
     * Get data channel state for a specific app
     */
    getDataChannelState(appId) {
      const peerConnection = this.peerConnections.get(appId);
      return peerConnection?.dataChannel?.readyState || null;
    }
    /**
     * Get list of connected app IDs
     */
    getConnectedApps() {
      return Array.from(this.peerConnections.keys()).filter((appId) => {
        const pc = this.peerConnections.get(appId);
        return pc?.dataChannel?.readyState === "open";
      });
    }
    /**
     * Handle incoming answer from app
     */
    async handleAnswer(appId, sdp) {
      const peerConnection = this.peerConnections.get(appId);
      if (!peerConnection) {
        console.warn(`Received answer for unknown app: ${appId}`);
        return;
      }
      try {
        const answer = new RTCSessionDescription({
          type: "answer",
          sdp
        });
        await peerConnection.pc.setRemoteDescription(answer);
      } catch (error) {
        this.onError?.({
          appId,
          message: `Failed to set remote description: ${error}`
        });
      }
    }
    /**
     * Handle incoming ICE candidate from app
     */
    async handleIceCandidate(appId, candidate) {
      const peerConnection = this.peerConnections.get(appId);
      if (!peerConnection) {
        console.warn(`Received ICE candidate for unknown app: ${appId}`);
        return;
      }
      try {
        await peerConnection.pc.addIceCandidate(candidate);
      } catch (error) {
        this.onError?.({
          appId,
          message: `Failed to add ICE candidate: ${error}`
        });
      }
    }
    /**
     * Set up event handlers for a peer connection
     */
    setupPeerConnectionHandlers(appId, pc) {
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          this.signalingClient.sendIce(event.candidate, appId);
        }
      };
      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        this.onConnectionStateChange?.({ appId, state });
        if (state === "failed" || state === "closed") {
          this.disconnect(appId);
        }
      };
      pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState;
        if (state === "failed" || state === "closed") {
          this.onError?.({
            appId,
            message: `ICE connection ${state}`
          });
        }
      };
      pc.ondatachannel = (event) => {
        console.warn("Unexpected data channel from remote peer:", event.channel.label);
      };
    }
    /**
     * Set up event handlers for a data channel
     */
    setupDataChannelHandlers(appId, dataChannel) {
      dataChannel.onopen = () => {
        this.onDataChannelOpen?.({ appId });
      };
      dataChannel.onclose = () => {
        this.onDataChannelClose?.({ appId });
      };
      dataChannel.onmessage = (event) => {
        this.onDataChannelMessage?.({
          appId,
          data: event.data
        });
      };
      dataChannel.onerror = (error) => {
        this.onError?.({
          appId,
          message: `Data channel error: ${error}`
        });
      };
    }
    /**
     * Close a peer connection and clean up resources
     */
    closePeerConnection(peerConnection) {
      const { pc, dataChannel, appId } = peerConnection;
      if (dataChannel) {
        try {
          dataChannel.close();
        } catch (error) {
          console.error("Error closing data channel:", error);
        }
      }
      try {
        pc.close();
      } catch (error) {
        console.error("Error closing peer connection:", error);
      }
      this.onDataChannelClose?.({ appId });
    }
  };

  // src/client/ui.ts
  var UIManager = class {
    signalingClient = null;
    webrtcClient = null;
    apps = /* @__PURE__ */ new Map();
    userInfo = null;
    messageLog = [];
    // DOM Elements
    loginSection;
    userSection;
    appListSection;
    connectionSection;
    messageSection;
    userEmailSpan;
    appListDiv;
    messageLogDiv;
    wsStatusSpan;
    logoutBtn;
    constructor() {
      this.initializeDOM();
      this.checkAuthStatus();
    }
    initializeDOM() {
      this.loginSection = document.getElementById("login-section");
      this.userSection = document.getElementById("user-section");
      this.appListSection = document.getElementById("app-list-section");
      this.connectionSection = document.getElementById("connection-section");
      this.messageSection = document.getElementById("message-section");
      this.userEmailSpan = document.getElementById("user-email");
      this.appListDiv = document.getElementById("app-list");
      this.messageLogDiv = document.getElementById("message-log");
      this.wsStatusSpan = document.getElementById("ws-status");
      this.logoutBtn = document.getElementById("logout-btn");
      this.logoutBtn.addEventListener("click", () => this.handleLogout());
      document.getElementById("login-btn")?.addEventListener("click", () => this.handleLogin());
      document.getElementById("refresh-apps-btn")?.addEventListener("click", () => this.refreshApps());
      document.getElementById("send-message-btn")?.addEventListener("click", () => this.handleSendMessage());
      document.getElementById("clear-log-btn")?.addEventListener("click", () => this.clearMessageLog());
    }
    async checkAuthStatus() {
      try {
        const response = await fetch("/api/me");
        if (response.ok) {
          this.userInfo = await response.json();
          this.showUserInterface();
          this.initializeWebSocket();
        } else {
          this.showLogin();
        }
      } catch (error) {
        console.error("Auth check failed:", error);
        this.showLogin();
      }
    }
    getToken() {
      const cookies = document.cookie.split(";");
      for (const cookie of cookies) {
        const [name, value] = cookie.trim().split("=");
        if (name === "token") {
          return value;
        }
      }
      return localStorage.getItem("token");
    }
    clearToken() {
      document.cookie = "token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
      localStorage.removeItem("token");
    }
    showLogin() {
      this.loginSection.style.display = "block";
      this.userSection.style.display = "none";
      this.appListSection.style.display = "none";
      this.connectionSection.style.display = "none";
      this.messageSection.style.display = "none";
    }
    showUserInterface() {
      this.loginSection.style.display = "none";
      this.userSection.style.display = "block";
      this.appListSection.style.display = "block";
      this.connectionSection.style.display = "block";
      this.messageSection.style.display = "block";
      if (this.userInfo) {
        this.userEmailSpan.textContent = this.userInfo.email;
      }
    }
    handleLogin() {
      window.location.href = "/auth/login";
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
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      this.signalingClient = new SignalingClient(wsUrl);
      this.signalingClient.onConnected = () => {
        this.updateWSStatus("connected");
      };
      this.signalingClient.onDisconnected = () => {
        this.updateWSStatus("disconnected");
      };
      this.signalingClient.onAuthenticated = (payload) => {
        console.log("Authenticated:", payload);
        this.updateWSStatus("authenticated");
        this.signalingClient?.getApps();
      };
      this.signalingClient.onAuthError = (payload) => {
        console.error("Auth error:", payload);
        this.updateWSStatus("error");
        alert("Authentication failed: " + payload.error);
        this.handleLogout();
      };
      this.signalingClient.onAppsListReceived = (payload) => {
        console.log("Apps list received:", payload);
        payload.apps.forEach((app) => {
          this.apps.set(app.appId, {
            id: app.appId,
            name: app.name,
            capabilities: app.capabilities,
            status: app.status
          });
        });
        this.renderAppList();
      };
      this.signalingClient.onAppStatus = (payload) => {
        console.log("App status update:", payload);
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
            status: payload.status
          });
        }
        this.renderAppList();
      };
      this.signalingClient.onError = (payload) => {
        console.error("WebSocket error:", payload);
        this.addLog("System", "Error: " + payload.message, "received");
      };
      this.webrtcClient = new WebRTCClient(this.signalingClient);
      this.webrtcClient.onDataChannelOpen = ({ appId }) => {
        console.log("Data channel opened:", appId);
        this.addLog(appId, "Connection established", "received");
        this.renderAppList();
      };
      this.webrtcClient.onDataChannelClose = ({ appId }) => {
        console.log("Data channel closed:", appId);
        this.addLog(appId, "Connection closed", "received");
        this.renderAppList();
      };
      this.webrtcClient.onDataChannelMessage = ({ appId, data }) => {
        console.log("Message from app:", appId, data);
        const message = typeof data === "string" ? data : `[Binary data: ${data.byteLength} bytes]`;
        this.addLog(appId, message, "received");
      };
      this.webrtcClient.onConnectionStateChange = ({ appId, state }) => {
        console.log("Connection state change:", appId, state);
        this.renderAppList();
      };
      this.webrtcClient.onError = ({ appId, message }) => {
        console.error("WebRTC error:", appId, message);
        this.addLog(appId || "System", "Error: " + message, "received");
      };
      try {
        await this.signalingClient.connect();
      } catch (error) {
        console.error("Failed to connect to WebSocket:", error);
        this.updateWSStatus("error");
      }
    }
    updateWSStatus(status) {
      this.wsStatusSpan.textContent = status;
      this.wsStatusSpan.className = `status-${status}`;
    }
    async refreshApps() {
      if (this.signalingClient?.isConnected()) {
        this.signalingClient.getApps();
      } else {
        try {
          const token = this.getToken();
          const response = await fetch("/api/apps", {
            headers: {
              "Authorization": `Bearer ${token}`
            }
          });
          if (response.ok) {
            const data = await response.json();
            this.apps.clear();
            data.apps.forEach((app) => {
              this.apps.set(app.id, {
                id: app.id,
                name: app.name,
                capabilities: app.capabilities,
                status: "offline"
              });
            });
            this.renderAppList();
          }
        } catch (error) {
          console.error("Failed to fetch apps:", error);
        }
      }
    }
    renderAppList() {
      const appArray = Array.from(this.apps.values());
      if (appArray.length === 0) {
        this.appListDiv.innerHTML = '<p class="no-apps">No apps registered. Register an app to get started.</p>';
        return;
      }
      this.appListDiv.innerHTML = appArray.map((app) => {
        const isOnline = app.status === "online";
        const connectionState = this.webrtcClient?.getConnectionState(app.id);
        const dataChannelState = this.webrtcClient?.getDataChannelState(app.id);
        const isConnected = dataChannelState === "open";
        return `
        <div class="app-card ${isOnline ? "online" : "offline"}">
          <div class="app-header">
            <span class="app-name">${this.escapeHtml(app.name)}</span>
            <span class="app-status ${isOnline ? "status-online" : "status-offline"}">
              ${isOnline ? "\u25CF Online" : "\u25CB Offline"}
            </span>
          </div>
          <div class="app-details">
            <div class="app-id">ID: ${this.escapeHtml(app.id)}</div>
            ${app.capabilities && app.capabilities.length > 0 ? `<div class="app-capabilities">Capabilities: ${app.capabilities.join(", ")}</div>` : ""}
            ${connectionState ? `<div class="app-connection-state">WebRTC: ${connectionState}</div>` : ""}
            ${dataChannelState ? `<div class="app-datachannel-state">DataChannel: ${dataChannelState}</div>` : ""}
          </div>
          <div class="app-actions">
            ${isOnline && !isConnected ? `<button class="btn btn-primary" onclick="window.uiManager.connectToApp('${app.id}')">Connect</button>` : ""}
            ${isConnected ? `<button class="btn btn-danger" onclick="window.uiManager.disconnectFromApp('${app.id}')">Disconnect</button>` : ""}
          </div>
        </div>
      `;
      }).join("");
    }
    async connectToApp(appId) {
      if (!this.webrtcClient) {
        alert("WebRTC client not initialized");
        return;
      }
      try {
        this.addLog(appId, "Connecting...", "sent");
        await this.webrtcClient.connectToApp(appId);
        this.addLog(appId, "Connected successfully", "received");
      } catch (error) {
        console.error("Failed to connect to app:", error);
        this.addLog(appId, "Connection failed: " + error, "received");
        alert("Failed to connect to app: " + error);
      }
    }
    disconnectFromApp(appId) {
      if (!this.webrtcClient) {
        return;
      }
      this.webrtcClient.disconnect(appId);
      this.addLog(appId, "Disconnected", "sent");
      this.renderAppList();
    }
    handleSendMessage() {
      const input = document.getElementById("message-input");
      const appSelect = document.getElementById("target-app");
      const message = input.value.trim();
      const targetAppId = appSelect.value;
      if (!message) {
        alert("Please enter a message");
        return;
      }
      if (!targetAppId) {
        alert("Please select a target app");
        return;
      }
      if (!this.webrtcClient) {
        alert("WebRTC client not initialized");
        return;
      }
      try {
        this.webrtcClient.sendMessage(targetAppId, message);
        this.addLog(targetAppId, message, "sent");
        input.value = "";
      } catch (error) {
        console.error("Failed to send message:", error);
        alert("Failed to send message: " + error);
      }
    }
    addLog(appId, data, direction) {
      const entry = {
        timestamp: /* @__PURE__ */ new Date(),
        appId,
        direction,
        data
      };
      this.messageLog.push(entry);
      if (this.messageLog.length > 100) {
        this.messageLog.shift();
      }
      this.renderMessageLog();
      this.updateTargetAppDropdown();
    }
    renderMessageLog() {
      this.messageLogDiv.innerHTML = this.messageLog.slice().reverse().map((entry) => {
        const time = entry.timestamp.toLocaleTimeString();
        const directionClass = entry.direction === "sent" ? "log-sent" : "log-received";
        const directionLabel = entry.direction === "sent" ? "\u2192" : "\u2190";
        return `
          <div class="log-entry ${directionClass}">
            <span class="log-time">${time}</span>
            <span class="log-direction">${directionLabel}</span>
            <span class="log-app">${this.escapeHtml(entry.appId)}</span>
            <span class="log-data">${this.escapeHtml(entry.data)}</span>
          </div>
        `;
      }).join("");
    }
    updateTargetAppDropdown() {
      const select = document.getElementById("target-app");
      const currentValue = select.value;
      const connectedApps = this.webrtcClient?.getConnectedApps() || [];
      select.innerHTML = '<option value="">-- Select App --</option>' + connectedApps.map((appId) => {
        const app = this.apps.get(appId);
        const name = app ? app.name : appId;
        return `<option value="${appId}">${this.escapeHtml(name)}</option>`;
      }).join("");
      if (connectedApps.includes(currentValue)) {
        select.value = currentValue;
      }
    }
    clearMessageLog() {
      this.messageLog = [];
      this.renderMessageLog();
    }
    escapeHtml(text) {
      const div = document.createElement("div");
      div.textContent = text;
      return div.innerHTML;
    }
  };
  function initializeUI() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        window.uiManager = new UIManager();
      });
    } else {
      window.uiManager = new UIManager();
    }
  }
  initializeUI();
  return __toCommonJS(ui_exports);
})();
