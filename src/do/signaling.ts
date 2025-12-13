interface WSMessage {
  type: string;
  payload: unknown;
  requestId?: string;
}

// Connection metadata stored in WebSocket attachment (survives hibernate)
interface ConnectionAttachment {
  connId: string;
  type: 'browser' | 'app';
  userId?: string;
  appId?: string;
  appName?: string;
  connectedAt: number;
  pendingToken?: string;
}

interface Env {
  KV: KVNamespace;
  JWT_SECRET: string;
}

export class SignalingDO implements DurableObject {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const upgradeHeader = request.headers.get('Upgrade');

    console.log(`[DO:fetch] path=${url.pathname}, upgrade=${upgradeHeader}`);

    if (upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const connId = crypto.randomUUID();
    const isAppConnection = url.pathname === '/ws/app';
    console.log(`[DO:fetch] new connection connId=${connId}, isApp=${isAppConnection}`);
    const apiKey = url.searchParams.get('apiKey');
    // Token can come from query param or cookie
    let token = url.searchParams.get('token');
    if (!token) {
      const cookieHeader = request.headers.get('Cookie');
      if (cookieHeader) {
        const cookies = cookieHeader.split(';').map((c) => c.trim());
        for (const cookie of cookies) {
          const [name, value] = cookie.split('=');
          if (name === 'token') {
            token = value;
            break;
          }
        }
      }
    }

    // Create attachment with connection metadata
    const attachment: ConnectionAttachment = {
      connId,
      type: isAppConnection ? 'app' : 'browser',
      connectedAt: Date.now(),
    };

    // Pre-validate API key for app connections
    if (isAppConnection && apiKey) {
      const keyData = (await this.env.KV.get(`apikey:${apiKey}`, 'json')) as {
        appId: string;
        userId: string;
      } | null;
      if (keyData) {
        attachment.userId = keyData.userId;
        attachment.appId = keyData.appId;
      }
    }

    // Store token from cookie/query for browser auto-auth
    if (!isAppConnection && token) {
      attachment.pendingToken = token;
    }

    // Accept WebSocket with tags and store attachment
    this.state.acceptWebSocket(server, [connId]);
    server.serializeAttachment(attachment);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const attachment = this.getAttachment(ws);
    if (!attachment) {
      console.log('[DO:webSocketMessage] No attachment found');
      return;
    }

    try {
      const msg: WSMessage =
        typeof message === 'string' ? JSON.parse(message) : JSON.parse(new TextDecoder().decode(message));

      await this.handleMessage(ws, attachment, msg);
    } catch (e) {
      this.send(ws, { type: 'error', payload: { message: 'Invalid message format' } });
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
    const attachment = this.getAttachment(ws);
    if (!attachment) return;

    console.log(`[DO:webSocketClose] connId=${attachment.connId}, type=${attachment.type}`);

    if (attachment.type === 'app' && attachment.userId) {
      // Notify browsers that app disconnected
      this.broadcastToUser(attachment.userId, 'browser', {
        type: 'app_status',
        payload: { appId: attachment.appId, status: 'offline' },
      });
    }
  }

  async webSocketError(ws: WebSocket, error: unknown) {
    const attachment = this.getAttachment(ws);
    console.log(`[DO:webSocketError] connId=${attachment?.connId}, error=${error}`);
  }

  private getAttachment(ws: WebSocket): ConnectionAttachment | null {
    try {
      return ws.deserializeAttachment() as ConnectionAttachment;
    } catch {
      return null;
    }
  }

  private updateAttachment(ws: WebSocket, updates: Partial<ConnectionAttachment>): ConnectionAttachment | null {
    const attachment = this.getAttachment(ws);
    if (!attachment) return null;

    const updated = { ...attachment, ...updates };
    ws.serializeAttachment(updated);
    return updated;
  }

  private async handleMessage(ws: WebSocket, attachment: ConnectionAttachment, msg: WSMessage) {
    switch (msg.type) {
      case 'auth':
        await this.handleAuth(ws, attachment, msg);
        break;

      case 'app_register':
        await this.handleAppRegister(ws, attachment, msg);
        break;

      case 'offer':
        await this.handleOffer(ws, attachment, msg);
        break;

      case 'answer':
        await this.handleAnswer(ws, attachment, msg);
        break;

      case 'ice':
        await this.handleICE(ws, attachment, msg);
        break;

      case 'get_apps':
        await this.handleGetApps(ws, attachment);
        break;

      default:
        this.send(ws, { type: 'error', payload: { message: `Unknown message type: ${msg.type}` } });
    }
  }

  private async handleAuth(ws: WebSocket, attachment: ConnectionAttachment, msg: WSMessage) {
    const payload = msg.payload as { apiKey?: string; token?: string };

    if (attachment.type === 'app' && payload.apiKey) {
      const keyData = (await this.env.KV.get(`apikey:${payload.apiKey}`, 'json')) as {
        appId: string;
        userId: string;
      } | null;

      if (!keyData) {
        this.send(ws, { type: 'auth_error', payload: { error: 'Invalid API key' } });
        return;
      }

      this.updateAttachment(ws, { userId: keyData.userId, appId: keyData.appId });
      this.send(ws, { type: 'auth_ok', payload: { userId: keyData.userId, type: 'app' } });
    } else if (attachment.type === 'browser') {
      // Use token from payload or from cookie (pendingToken)
      const token = payload.token || attachment.pendingToken;
      if (!token) {
        this.send(ws, { type: 'auth_error', payload: { error: 'Missing token' } });
        return;
      }
      // Verify JWT for browser connections
      const jwtPayload = await this.verifyToken(token);
      if (!jwtPayload) {
        this.send(ws, { type: 'auth_error', payload: { error: 'Invalid token' } });
        return;
      }

      const updatedAttachment = this.updateAttachment(ws, { userId: jwtPayload.sub });
      this.send(ws, { type: 'auth_ok', payload: { userId: jwtPayload.sub, type: 'browser' } });

      // Send current app status
      if (updatedAttachment) {
        await this.handleGetApps(ws, updatedAttachment);
      }
    } else {
      this.send(ws, { type: 'auth_error', payload: { error: 'Missing credentials' } });
    }
  }

  private async handleAppRegister(ws: WebSocket, attachment: ConnectionAttachment, msg: WSMessage) {
    if (attachment.type !== 'app' || !attachment.userId || !attachment.appId) {
      this.send(ws, { type: 'error', payload: { message: 'Not authenticated as app' } });
      return;
    }

    const payload = msg.payload as { name: string; capabilities: string[] };
    this.updateAttachment(ws, { appName: payload.name });

    this.send(ws, { type: 'app_registered', payload: { appId: attachment.appId } });

    // Notify browsers
    this.broadcastToUser(attachment.userId, 'browser', {
      type: 'app_status',
      payload: {
        appId: attachment.appId,
        name: payload.name,
        capabilities: payload.capabilities,
        status: 'online',
      },
    });
  }

  private async handleOffer(ws: WebSocket, attachment: ConnectionAttachment, msg: WSMessage) {
    if (!attachment.userId) return;

    const payload = msg.payload as { targetAppId: string; sdp: string };

    // Find target app connection from all WebSockets
    const webSockets = this.state.getWebSockets();
    for (const appWs of webSockets) {
      const appAttachment = this.getAttachment(appWs);
      if (appAttachment?.type === 'app' &&
          appAttachment.appId === payload.targetAppId &&
          appAttachment.userId === attachment.userId) {
        this.send(appWs, {
          type: 'offer',
          payload: { sdp: payload.sdp },
          requestId: msg.requestId,
        });
        return;
      }
    }

    this.send(ws, { type: 'error', payload: { message: 'Target app not found' } });
  }

  private async handleAnswer(ws: WebSocket, attachment: ConnectionAttachment, msg: WSMessage) {
    if (attachment.type !== 'app' || !attachment.userId) return;

    const payload = msg.payload as { sdp: string };

    // Find browser connection for this user from all WebSockets
    const webSockets = this.state.getWebSockets();
    for (const browserWs of webSockets) {
      const browserAttachment = this.getAttachment(browserWs);
      if (browserAttachment?.type === 'browser' && browserAttachment.userId === attachment.userId) {
        this.send(browserWs, {
          type: 'answer',
          payload: { sdp: payload.sdp, appId: attachment.appId },
          requestId: msg.requestId,
        });
        return;
      }
    }
  }

  private async handleICE(ws: WebSocket, attachment: ConnectionAttachment, msg: WSMessage) {
    if (!attachment.userId) return;

    const payload = msg.payload as { candidate: unknown; targetAppId?: string };
    const webSockets = this.state.getWebSockets();

    if (attachment.type === 'browser') {
      // Browser sending ICE to app
      for (const appWs of webSockets) {
        const appAttachment = this.getAttachment(appWs);
        if (appAttachment?.type === 'app' &&
            appAttachment.appId === payload.targetAppId &&
            appAttachment.userId === attachment.userId) {
          this.send(appWs, { type: 'ice', payload: { candidate: payload.candidate } });
          return;
        }
      }
    } else {
      // App sending ICE to browser
      for (const browserWs of webSockets) {
        const browserAttachment = this.getAttachment(browserWs);
        if (browserAttachment?.type === 'browser' && browserAttachment.userId === attachment.userId) {
          this.send(browserWs, { type: 'ice', payload: { candidate: payload.candidate, appId: attachment.appId } });
          return;
        }
      }
    }
  }

  private async handleGetApps(ws: WebSocket, attachment: ConnectionAttachment) {
    if (!attachment.userId) return;

    const webSockets = this.state.getWebSockets();
    console.log(`[DO:handleGetApps] userId=${attachment.userId}, total websockets=${webSockets.length}`);

    const onlineApps: Array<{ appId: string; name: string; status: string }> = [];

    for (const appWs of webSockets) {
      const appAttachment = this.getAttachment(appWs);
      console.log(`[DO:handleGetApps] checking ws, type=${appAttachment?.type}, userId=${appAttachment?.userId}, appId=${appAttachment?.appId}`);
      if (appAttachment?.type === 'app' && appAttachment.userId === attachment.userId) {
        onlineApps.push({
          appId: appAttachment.appId!,
          name: appAttachment.appName || 'Unknown',
          status: 'online',
        });
      }
    }

    console.log(`[DO:handleGetApps] found ${onlineApps.length} online apps`);
    this.send(ws, { type: 'apps_list', payload: { apps: onlineApps } });
  }

  private broadcastToUser(userId: string, targetType: 'browser' | 'app', msg: WSMessage) {
    const webSockets = this.state.getWebSockets();
    for (const ws of webSockets) {
      const attachment = this.getAttachment(ws);
      if (attachment?.userId === userId && attachment.type === targetType) {
        this.send(ws, msg);
      }
    }
  }

  private send(ws: WebSocket, msg: WSMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Connection might be closed
    }
  }

  private async verifyToken(token: string): Promise<{ sub: string } | null> {
    // Simple JWT verification - reuse the logic from auth/jwt.ts
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;

      const [headerB64, payloadB64, signatureB64] = parts;

      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(this.env.JWT_SECRET),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['verify']
      );

      const signature = this.base64UrlDecode(signatureB64);
      const valid = await crypto.subtle.verify('HMAC', key, signature, encoder.encode(`${headerB64}.${payloadB64}`));

      if (!valid) return null;

      const payload = JSON.parse(new TextDecoder().decode(this.base64UrlDecode(payloadB64)));

      if (payload.exp < Math.floor(Date.now() / 1000)) {
        return null;
      }

      return { sub: payload.sub };
    } catch {
      return null;
    }
  }

  private base64UrlDecode(str: string): Uint8Array {
    const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  }
}
