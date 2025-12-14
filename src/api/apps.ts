import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authMiddleware, AuthUser } from '../middleware/auth';

type Env = {
  KV: KVNamespace;
  JWT_SECRET: string;
};

type Variables = {
  user: AuthUser;
};

interface App {
  id: string;
  userId: string;
  name: string;
  capabilities: string[];
  createdAt: number;
}

export const appRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// CORS for cross-origin requests from external frontends
appRoutes.use(
  '/*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })
);

// Apply auth middleware to all routes
appRoutes.use('/*', authMiddleware);

// Get current user info
appRoutes.get('/me', (c) => {
  const user = c.get('user');
  return c.json(user);
});

// List user's apps
appRoutes.get('/apps', async (c) => {
  const user = c.get('user');

  const appIds = (await c.env.KV.get(`user:${user.id}:apps`, 'json')) as string[] | null;

  if (!appIds || appIds.length === 0) {
    return c.json({ apps: [] });
  }

  const apps = await Promise.all(
    appIds.map(async (appId) => {
      const app = await c.env.KV.get(`app:${appId}`, 'json');
      return app;
    })
  );

  return c.json({ apps: apps.filter(Boolean) });
});

// Create new app
appRoutes.post('/apps', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ name: string; capabilities: string[] }>();

  if (!body.name) {
    return c.json({ error: 'Name is required' }, 400);
  }

  const appId = crypto.randomUUID();
  const apiKey = generateApiKey();

  const app: App = {
    id: appId,
    userId: user.id,
    name: body.name,
    capabilities: body.capabilities || [],
    createdAt: Date.now(),
  };

  await c.env.KV.put(`app:${appId}`, JSON.stringify(app));

  await c.env.KV.put(
    `apikey:${apiKey}`,
    JSON.stringify({
      appId,
      userId: user.id,
    })
  );

  const userApps = (await c.env.KV.get(`user:${user.id}:apps`, 'json')) as string[] | null;
  const apps = userApps || [];
  apps.push(appId);
  await c.env.KV.put(`user:${user.id}:apps`, JSON.stringify(apps));

  return c.json({ app, apiKey });
});

// Delete app
appRoutes.delete('/apps/:appId', async (c) => {
  const user = c.get('user');
  const appId = c.req.param('appId');

  const app = (await c.env.KV.get(`app:${appId}`, 'json')) as App | null;

  if (!app) {
    return c.json({ error: 'App not found' }, 404);
  }

  if (app.userId !== user.id) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  // Delete app
  await c.env.KV.delete(`app:${appId}`);

  // Remove from user's app list
  const userApps = (await c.env.KV.get(`user:${user.id}:apps`, 'json')) as string[] | null;
  if (userApps) {
    const filtered = userApps.filter((id) => id !== appId);
    await c.env.KV.put(`user:${user.id}:apps`, JSON.stringify(filtered));
  }

  // Note: API key cleanup would require storing the key reference in app data
  // For now, orphaned API keys will fail validation when app is deleted

  return c.json({ ok: true });
});

// Regenerate API key
appRoutes.post('/apps/:appId/regenerate', async (c) => {
  const user = c.get('user');
  const appId = c.req.param('appId');

  const app = (await c.env.KV.get(`app:${appId}`, 'json')) as App | null;

  if (!app) {
    return c.json({ error: 'App not found' }, 404);
  }

  if (app.userId !== user.id) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const newApiKey = generateApiKey();

  await c.env.KV.put(
    `apikey:${newApiKey}`,
    JSON.stringify({
      appId,
      userId: user.id,
    })
  );

  return c.json({ apiKey: newApiKey });
});

function generateApiKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function generateRefreshToken(): string {
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  return 'rt_' + Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Refresh API key using refresh token (no auth middleware - uses refresh token for auth)
// This is a separate route that doesn't use authMiddleware
export const appRefreshRoute = new Hono<{ Bindings: Env }>();

appRefreshRoute.use(
  '/*',
  cors({
    origin: '*',
    allowMethods: ['POST', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
  })
);

appRefreshRoute.post('/refresh', async (c) => {
  const body = await c.req.json<{ refreshToken: string }>();
  const { refreshToken } = body;

  if (!refreshToken) {
    return c.json({ error: 'Missing refreshToken' }, 400);
  }

  // Look up refresh token
  const tokenData = (await c.env.KV.get(`refreshtoken:${refreshToken}`, 'json')) as {
    appId: string;
    apiKey: string;
    userId: string;
    createdAt: number;
  } | null;

  if (!tokenData) {
    return c.json({ error: 'Invalid or expired refresh token' }, 401);
  }

  // Verify app still exists
  const app = (await c.env.KV.get(`app:${tokenData.appId}`, 'json')) as App | null;
  if (!app) {
    // App was deleted, invalidate refresh token
    await c.env.KV.delete(`refreshtoken:${refreshToken}`);
    return c.json({ error: 'App no longer exists' }, 401);
  }

  // Delete old API key
  await c.env.KV.delete(`apikey:${tokenData.apiKey}`);

  // Generate new API key
  const newApiKey = generateApiKey();

  // Save new API key mapping
  await c.env.KV.put(
    `apikey:${newApiKey}`,
    JSON.stringify({
      appId: tokenData.appId,
      userId: tokenData.userId,
    })
  );

  // Generate new refresh token
  const newRefreshToken = generateRefreshToken();

  // Delete old refresh token
  await c.env.KV.delete(`refreshtoken:${refreshToken}`);

  // Save new refresh token
  await c.env.KV.put(
    `refreshtoken:${newRefreshToken}`,
    JSON.stringify({
      appId: tokenData.appId,
      apiKey: newApiKey,
      userId: tokenData.userId,
      createdAt: Date.now(),
    })
  );

  return c.json({
    apiKey: newApiKey,
    refreshToken: newRefreshToken,
    appId: tokenData.appId,
  });
});
