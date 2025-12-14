/**
 * Browser-side WebSocket client for Cloudflare Workers signaling server
 */
export class SignalingClient {
    constructor(wsUrl, token = null) {
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectTimeout = null;
        this.isManualDisconnect = false;
        this.isAuthenticated = false;
        // Event callbacks
        this.onAuthenticated = null;
        this.onAuthError = null;
        this.onAppStatus = null;
        this.onAppsListReceived = null;
        this.onOffer = null;
        this.onAnswer = null;
        this.onIce = null;
        this.onConnected = null;
        this.onDisconnected = null;
        this.onError = null;
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
                // Append token as query parameter if provided
                // Otherwise, httpOnly cookie will be sent automatically
                const url = new URL(this.wsUrl);
                if (this.token) {
                    url.searchParams.set('token', this.token);
                }
                this.ws = new WebSocket(url.toString());
                this.ws.onopen = () => {
                    this.reconnectAttempts = 0;
                    this.onConnected?.();
                    // Send auth message immediately after connection
                    this.sendAuth();
                    resolve();
                };
                this.ws.onmessage = (event) => {
                    this.handleMessage(event.data);
                };
                this.ws.onerror = (event) => {
                    console.error('WebSocket error:', event);
                    this.onError?.({ message: 'WebSocket error occurred' });
                    reject(new Error('WebSocket connection error'));
                };
                this.ws.onclose = (event) => {
                    this.isAuthenticated = false;
                    this.onDisconnected?.();
                    if (!this.isManualDisconnect) {
                        this.scheduleReconnect();
                    }
                };
            }
            catch (error) {
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
            type: 'auth',
            payload: { token: this.token },
        });
    }
    /**
     * Send WebRTC offer to a specific app
     */
    sendOffer(targetAppId, sdp) {
        this.send({
            type: 'offer',
            payload: { targetAppId, sdp },
        });
    }
    /**
     * Send WebRTC answer
     */
    sendAnswer(sdp) {
        this.send({
            type: 'answer',
            payload: { sdp },
        });
    }
    /**
     * Send ICE candidate
     */
    sendIce(candidate, targetAppId) {
        this.send({
            type: 'ice',
            payload: { candidate, targetAppId },
        });
    }
    /**
     * Request list of online apps
     */
    getApps() {
        this.send({
            type: 'get_apps',
            payload: {},
        });
    }
    /**
     * Send a message to the server
     */
    send(message) {
        if (this.ws?.readyState !== WebSocket.OPEN) {
            console.error('WebSocket is not open. Cannot send message:', message);
            return;
        }
        try {
            this.ws.send(JSON.stringify(message));
        }
        catch (error) {
            console.error('Failed to send message:', error);
            this.onError?.({ message: 'Failed to send message' });
        }
    }
    /**
     * Handle incoming WebSocket messages
     */
    handleMessage(data) {
        try {
            const message = JSON.parse(data);
            switch (message.type) {
                case 'auth_ok':
                    this.isAuthenticated = true;
                    this.onAuthenticated?.(message.payload);
                    break;
                case 'auth_error':
                    this.isAuthenticated = false;
                    this.onAuthError?.(message.payload);
                    break;
                case 'apps_list':
                    this.onAppsListReceived?.(message.payload);
                    break;
                case 'app_status':
                    this.onAppStatus?.(message.payload);
                    break;
                case 'offer':
                    this.onOffer?.(message.payload);
                    break;
                case 'answer':
                    this.onAnswer?.(message.payload);
                    break;
                case 'ice':
                    this.onIce?.(message.payload);
                    break;
                case 'error':
                    this.onError?.(message.payload);
                    break;
                default:
                    console.warn('Unknown message type:', message.type);
            }
        }
        catch (error) {
            console.error('Failed to parse message:', error);
            this.onError?.({ message: 'Failed to parse server message' });
        }
    }
    /**
     * Schedule reconnection with exponential backoff
     */
    scheduleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('Max reconnection attempts reached');
            this.onError?.({ message: 'Failed to reconnect after multiple attempts' });
            return;
        }
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        this.reconnectAttempts++;
        console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        this.reconnectTimeout = window.setTimeout(() => {
            this.connect().catch((error) => {
                console.error('Reconnection failed:', error);
            });
        }, delay);
    }
    /**
     * Update the JWT token (useful for token refresh)
     */
    updateToken(token) {
        this.token = token;
        // If currently connected, reconnect with new token
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.disconnect();
            this.connect().catch((error) => {
                console.error('Failed to reconnect with new token:', error);
            });
        }
    }
}
