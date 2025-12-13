interface WSMessage {
  type: string;
  payload: unknown;
  requestId?: string;
}

interface Connection {
  type: 'browser' | 'app';
  ws: WebSocket;
  userId?: string;
  appId?: string;
  appName?: string;
  connectedAt: number;
  pendingToken?: string; // Token from cookie/query for auto-auth
}

interface Env {
  KV: KVNamespace;
  JWT_SECRET: string;
}

export class SignalingDO implements DurableObject {
  private connections: Map<string, Connection> = new Map();
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const upgradeHeader = request.headers.get('Upgrade');

    if (upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const connId = crypto.randomUUID();
    const isAppConnection = url.pathname === '/ws/app';
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

    this.state.acceptWebSocket(server, [connId]);

    const connection: Connection = {
      type: isAppConnection ? 'app' : 'browser',
      ws: server,
      connectedAt: Date.now(),
    };

    // Pre-validate API key for app connections
    if (isAppConnection && apiKey) {
      const keyData = (await this.env.KV.get(`apikey:${apiKey}`, 'json')) as {
        appId: string;
        userId: string;
      } | null;
      if (keyData) {
        connection.userId = keyData.userId;
        connection.appId = keyData.appId;
      }
    }

    // Store token from cookie/query for browser auto-auth
    if (!isAppConnection && token) {
      connection.pendingToken = token;
    }

    this.connections.set(connId, connection);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const connId = this.getConnId(ws);
    if (!connId) return;

    const conn = this.connections.get(connId);
    if (!conn) return;

    try {
      const msg: WSMessage =
        typeof message === 'string' ? JSON.parse(message) : JSON.parse(new TextDecoder().decode(message));

      await this.handleMessage(connId, conn, msg);
    } catch (e) {
      this.send(ws, { type: 'error', payload: { message: 'Invalid message format' } });
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
    const connId = this.getConnId(ws);
    if (!connId) return;

    const conn = this.connections.get(connId);
    if (conn?.type === 'app' && conn.userId) {
      // Notify browsers that app disconnected
      this.broadcastToUser(conn.userId, 'browser', {
        type: 'app_status',
        payload: { appId: conn.appId, status: 'offline' },
      });
    }

    this.connections.delete(connId);
  }

  async webSocketError(ws: WebSocket, error: unknown) {
    const connId = this.getConnId(ws);
    if (connId) {
      this.connections.delete(connId);
    }
  }

  private getConnId(ws: WebSocket): string | undefined {
    const tags = this.state.getTags(ws);
    return tags[0];
  }

  private async handleMessage(connId: string, conn: Connection, msg: WSMessage) {
    switch (msg.type) {
      case 'auth':
        await this.handleAuth(connId, conn, msg);
        break;

      case 'app_register':
        await this.handleAppRegister(connId, conn, msg);
        break;

      case 'offer':
        await this.handleOffer(conn, msg);
        break;

      case 'answer':
        await this.handleAnswer(conn, msg);
        break;

      case 'ice':
        await this.handleICE(conn, msg);
        break;

      case 'get_apps':
        await this.handleGetApps(conn);
        break;

      default:
        this.send(conn.ws, { type: 'error', payload: { message: `Unknown message type: ${msg.type}` } });
    }
  }

  private async handleAuth(connId: string, conn: Connection, msg: WSMessage) {
    const payload = msg.payload as { apiKey?: string; token?: string };

    if (conn.type === 'app' && payload.apiKey) {
      const keyData = (await this.env.KV.get(`apikey:${payload.apiKey}`, 'json')) as {
        appId: string;
        userId: string;
      } | null;

      if (!keyData) {
        this.send(conn.ws, { type: 'auth_error', payload: { error: 'Invalid API key' } });
        return;
      }

      conn.userId = keyData.userId;
      conn.appId = keyData.appId;
      this.send(conn.ws, { type: 'auth_ok', payload: { userId: keyData.userId, type: 'app' } });
    } else if (conn.type === 'browser') {
      // Use token from payload or from cookie (pendingToken)
      const token = payload.token || conn.pendingToken;
      if (!token) {
        this.send(conn.ws, { type: 'auth_error', payload: { error: 'Missing token' } });
        return;
      }
      // Verify JWT for browser connections
      const jwtPayload = await this.verifyToken(token);
      if (!jwtPayload) {
        this.send(conn.ws, { type: 'auth_error', payload: { error: 'Invalid token' } });
        return;
      }

      conn.userId = jwtPayload.sub;
      this.send(conn.ws, { type: 'auth_ok', payload: { userId: jwtPayload.sub, type: 'browser' } });

      // Send current app status
      await this.handleGetApps(conn);
    } else {
      this.send(conn.ws, { type: 'auth_error', payload: { error: 'Missing credentials' } });
    }
  }

  private async handleAppRegister(connId: string, conn: Connection, msg: WSMessage) {
    if (conn.type !== 'app' || !conn.userId || !conn.appId) {
      this.send(conn.ws, { type: 'error', payload: { message: 'Not authenticated as app' } });
      return;
    }

    const payload = msg.payload as { name: string; capabilities: string[] };
    conn.appName = payload.name;

    this.send(conn.ws, { type: 'app_registered', payload: { appId: conn.appId } });

    // Notify browsers
    this.broadcastToUser(conn.userId, 'browser', {
      type: 'app_status',
      payload: {
        appId: conn.appId,
        name: payload.name,
        capabilities: payload.capabilities,
        status: 'online',
      },
    });
  }

  private async handleOffer(conn: Connection, msg: WSMessage) {
    if (!conn.userId) return;

    const payload = msg.payload as { targetAppId: string; sdp: string };

    // Find target app connection
    for (const [, appConn] of this.connections) {
      if (appConn.type === 'app' && appConn.appId === payload.targetAppId && appConn.userId === conn.userId) {
        this.send(appConn.ws, {
          type: 'offer',
          payload: { sdp: payload.sdp },
          requestId: msg.requestId,
        });
        return;
      }
    }

    this.send(conn.ws, { type: 'error', payload: { message: 'Target app not found' } });
  }

  private async handleAnswer(conn: Connection, msg: WSMessage) {
    if (conn.type !== 'app' || !conn.userId) return;

    const payload = msg.payload as { sdp: string };

    // Find browser connection for this user
    for (const [, browserConn] of this.connections) {
      if (browserConn.type === 'browser' && browserConn.userId === conn.userId) {
        this.send(browserConn.ws, {
          type: 'answer',
          payload: { sdp: payload.sdp, appId: conn.appId },
          requestId: msg.requestId,
        });
        return;
      }
    }
  }

  private async handleICE(conn: Connection, msg: WSMessage) {
    if (!conn.userId) return;

    const payload = msg.payload as { candidate: unknown; targetAppId?: string };

    if (conn.type === 'browser') {
      // Browser sending ICE to app
      for (const [, appConn] of this.connections) {
        if (appConn.type === 'app' && appConn.appId === payload.targetAppId && appConn.userId === conn.userId) {
          this.send(appConn.ws, { type: 'ice', payload: { candidate: payload.candidate } });
          return;
        }
      }
    } else {
      // App sending ICE to browser
      for (const [, browserConn] of this.connections) {
        if (browserConn.type === 'browser' && browserConn.userId === conn.userId) {
          this.send(browserConn.ws, { type: 'ice', payload: { candidate: payload.candidate, appId: conn.appId } });
          return;
        }
      }
    }
  }

  private async handleGetApps(conn: Connection) {
    if (!conn.userId) return;

    const onlineApps: Array<{ appId: string; name: string; status: string }> = [];

    for (const [, appConn] of this.connections) {
      if (appConn.type === 'app' && appConn.userId === conn.userId) {
        onlineApps.push({
          appId: appConn.appId!,
          name: appConn.appName || 'Unknown',
          status: 'online',
        });
      }
    }

    this.send(conn.ws, { type: 'apps_list', payload: { apps: onlineApps } });
  }

  private broadcastToUser(userId: string, targetType: 'browser' | 'app', msg: WSMessage) {
    for (const [, conn] of this.connections) {
      if (conn.userId === userId && conn.type === targetType) {
        this.send(conn.ws, msg);
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
