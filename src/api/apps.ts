import { Hono } from 'hono';
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
