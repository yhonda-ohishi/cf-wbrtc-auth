import { Hono } from 'hono';
import { authRoutes } from './auth/oauth';
import { setupRoutes } from './setup';
import { appRoutes } from './api/apps';
import { SignalingDO } from './do/signaling';

type Env = {
  KV: KVNamespace;
  SIGNALING_DO: DurableObjectNamespace;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  JWT_SECRET: string;
};

const app = new Hono<{ Bindings: Env }>();

// Auth routes
app.route('/auth', authRoutes);

// Setup routes (Go App initial setup)
app.route('/setup', setupRoutes);

// API routes
app.route('/api', appRoutes);

// WebSocket routes
app.get('/ws', async (c) => {
  const upgradeHeader = c.req.header('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return c.text('Expected WebSocket', 426);
  }

  const token = c.req.query('token');
  if (!token) {
    return c.text('Missing token', 401);
  }

  const id = c.env.SIGNALING_DO.idFromName('global');
  const stub = c.env.SIGNALING_DO.get(id);
  return stub.fetch(c.req.raw);
});

app.get('/ws/app', async (c) => {
  const upgradeHeader = c.req.header('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return c.text('Expected WebSocket', 426);
  }

  const apiKey = c.req.query('apiKey');
  if (!apiKey) {
    return c.text('Missing API key', 401);
  }

  // Validate API key
  const keyData = await c.env.KV.get(`apikey:${apiKey}`, 'json');
  if (!keyData) {
    return c.text('Invalid API key', 401);
  }

  const id = c.env.SIGNALING_DO.idFromName('global');
  const stub = c.env.SIGNALING_DO.get(id);
  return stub.fetch(c.req.raw);
});

// Static files fallback
app.get('/*', async (c) => {
  return c.text('Static file serving - implement with Assets binding');
});

export default app;
export { SignalingDO };
