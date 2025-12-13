/**
 * Browser-side WebSocket client for Cloudflare Workers signaling server
 */

interface WSMessage {
  type: string;
  payload: unknown;
  requestId?: string;
}

interface AppInfo {
  appId: string;
  name: string;
  capabilities?: string[];
  status: 'online' | 'offline';
}

interface AuthOkPayload {
  userId: string;
  type: 'browser' | 'app';
}

interface AuthErrorPayload {
  error: string;
}

interface AppsListPayload {
  apps: AppInfo[];
}

interface AppStatusPayload {
  appId: string;
  name?: string;
  capabilities?: string[];
  status: 'online' | 'offline';
}

interface OfferPayload {
  sdp: string;
}

interface AnswerPayload {
  sdp: string;
  appId: string;
}

interface IcePayload {
  candidate: RTCIceCandidate;
  appId?: string;
}

type EventCallback<T = unknown> = (data: T) => void;

export class SignalingClient {
  private ws: WebSocket | null = null;
  private wsUrl: string;
  private token: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectTimeout: number | null = null;
  private isManualDisconnect = false;
  private isAuthenticated = false;

  // Event callbacks
  public onAuthenticated: EventCallback<AuthOkPayload> | null = null;
  public onAuthError: EventCallback<AuthErrorPayload> | null = null;
  public onAppStatus: EventCallback<AppStatusPayload> | null = null;
  public onAppsListReceived: EventCallback<AppsListPayload> | null = null;
  public onOffer: EventCallback<OfferPayload> | null = null;
  public onAnswer: EventCallback<AnswerPayload> | null = null;
  public onIce: EventCallback<IcePayload> | null = null;
  public onConnected: EventCallback<void> | null = null;
  public onDisconnected: EventCallback<void> | null = null;
  public onError: EventCallback<{ message: string }> | null = null;

  constructor(wsUrl: string, token: string) {
    this.wsUrl = wsUrl;
    this.token = token;
  }

  /**
   * Connect to the WebSocket signaling server
   */
  public async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }

    this.isManualDisconnect = false;

    return new Promise((resolve, reject) => {
      try {
        // Append token as query parameter
        const url = new URL(this.wsUrl);
        url.searchParams.set('token', this.token);

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
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Disconnect from the WebSocket server
   */
  public disconnect(): void {
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
  public isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.isAuthenticated;
  }

  /**
   * Send authentication message
   */
  private sendAuth(): void {
    this.send({
      type: 'auth',
      payload: { token: this.token },
    });
  }

  /**
   * Send WebRTC offer to a specific app
   */
  public sendOffer(targetAppId: string, sdp: string): void {
    this.send({
      type: 'offer',
      payload: { targetAppId, sdp },
    });
  }

  /**
   * Send WebRTC answer
   */
  public sendAnswer(sdp: string): void {
    this.send({
      type: 'answer',
      payload: { sdp },
    });
  }

  /**
   * Send ICE candidate
   */
  public sendIce(candidate: RTCIceCandidate, targetAppId?: string): void {
    this.send({
      type: 'ice',
      payload: { candidate, targetAppId },
    });
  }

  /**
   * Request list of online apps
   */
  public getApps(): void {
    this.send({
      type: 'get_apps',
      payload: {},
    });
  }

  /**
   * Send a message to the server
   */
  private send(message: WSMessage): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      console.error('WebSocket is not open. Cannot send message:', message);
      return;
    }

    try {
      this.ws.send(JSON.stringify(message));
    } catch (error) {
      console.error('Failed to send message:', error);
      this.onError?.({ message: 'Failed to send message' });
    }
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(data: string): void {
    try {
      const message: WSMessage = JSON.parse(data);

      switch (message.type) {
        case 'auth_ok':
          this.isAuthenticated = true;
          this.onAuthenticated?.(message.payload as AuthOkPayload);
          break;

        case 'auth_error':
          this.isAuthenticated = false;
          this.onAuthError?.(message.payload as AuthErrorPayload);
          break;

        case 'apps_list':
          this.onAppsListReceived?.(message.payload as AppsListPayload);
          break;

        case 'app_status':
          this.onAppStatus?.(message.payload as AppStatusPayload);
          break;

        case 'offer':
          this.onOffer?.(message.payload as OfferPayload);
          break;

        case 'answer':
          this.onAnswer?.(message.payload as AnswerPayload);
          break;

        case 'ice':
          this.onIce?.(message.payload as IcePayload);
          break;

        case 'error':
          this.onError?.(message.payload as { message: string });
          break;

        default:
          console.warn('Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('Failed to parse message:', error);
      this.onError?.({ message: 'Failed to parse server message' });
    }
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
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
  public updateToken(token: string): void {
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
