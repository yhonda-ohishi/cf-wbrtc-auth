import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { verifyJWT } from '../auth/jwt';

type Env = {
  KV: KVNamespace;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  JWT_SECRET: string;
};

export const setupRoutes = new Hono<{ Bindings: Env }>();

function getBaseUrl(req: Request): string {
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

// Go App calls this to start setup
setupRoutes.get('/', async (c) => {
  const callback = c.req.query('callback');

  if (!callback) {
    return c.text('Missing callback URL', 400);
  }

  // Store callback URL
  setCookie(c, 'setup_callback', callback, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: 600,
    path: '/',
  });

  // Redirect to OAuth with return to /setup/complete
  const baseUrl = getBaseUrl(c.req.raw);
  return c.redirect(`${baseUrl}/auth/login?return=/setup/complete`);
});

// After OAuth, show app registration form
setupRoutes.get('/complete', async (c) => {
  const token = getCookie(c, 'token');
  const callback = getCookie(c, 'setup_callback');

  if (!token) {
    return c.text('Not authenticated', 401);
  }

  if (!callback) {
    return c.text('Setup session expired', 400);
  }

  const payload = await verifyJWT(token, c.env.JWT_SECRET);
  if (!payload) {
    return c.text('Invalid token', 401);
  }

  // Return HTML form for app registration
  return c.html(`
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>App Setup</title>
  <style>
    body { font-family: sans-serif; max-width: 400px; margin: 50px auto; padding: 20px; }
    h1 { font-size: 1.5rem; }
    label { display: block; margin-top: 1rem; font-weight: bold; }
    input, select { width: 100%; padding: 8px; margin-top: 4px; box-sizing: border-box; }
    button { margin-top: 1.5rem; padding: 12px 24px; background: #0070f3; color: white; border: none; cursor: pointer; width: 100%; }
    button:hover { background: #0051a8; }
    .checkbox-group { margin-top: 0.5rem; }
    .checkbox-group label { display: inline; font-weight: normal; margin-left: 4px; }
  </style>
</head>
<body>
  <h1>App Registration</h1>
  <p>Welcome, ${payload.name}!</p>

  <form method="POST" action="/setup/register">
    <label for="name">App Name</label>
    <input type="text" id="name" name="name" placeholder="e.g., My PC" required>

    <label>Capabilities</label>
    <div class="checkbox-group">
      <input type="checkbox" id="print" name="capabilities" value="print">
      <label for="print">Print</label>
    </div>
    <div class="checkbox-group">
      <input type="checkbox" id="scrape" name="capabilities" value="scrape">
      <label for="scrape">Scrape</label>
    </div>

    <button type="submit">Register App</button>
  </form>
</body>
</html>
  `);
});

// Handle app registration form submission
setupRoutes.post('/register', async (c) => {
  const token = getCookie(c, 'token');
  const callback = getCookie(c, 'setup_callback');

  if (!token || !callback) {
    return c.text('Session expired', 400);
  }

  const payload = await verifyJWT(token, c.env.JWT_SECRET);
  if (!payload) {
    return c.text('Invalid token', 401);
  }

  const formData = await c.req.formData();
  const name = formData.get('name') as string;
  const capabilities = formData.getAll('capabilities') as string[];

  if (!name) {
    return c.text('Name is required', 400);
  }

  // Generate app ID and API key
  const appId = crypto.randomUUID();
  const apiKey = generateApiKey();

  // Save app info
  await c.env.KV.put(
    `app:${appId}`,
    JSON.stringify({
      id: appId,
      userId: payload.sub,
      name,
      capabilities,
      createdAt: Date.now(),
    })
  );

  // Save API key mapping
  await c.env.KV.put(
    `apikey:${apiKey}`,
    JSON.stringify({
      appId,
      userId: payload.sub,
    })
  );

  // Add app to user's app list
  const userApps = (await c.env.KV.get(`user:${payload.sub}:apps`, 'json')) as string[] | null;
  const apps = userApps || [];
  apps.push(appId);
  await c.env.KV.put(`user:${payload.sub}:apps`, JSON.stringify(apps));

  // Clear setup cookie
  deleteCookie(c, 'setup_callback');

  // Redirect to Go App callback with API key
  const redirectUrl = new URL(callback);
  redirectUrl.searchParams.set('apikey', apiKey);
  redirectUrl.searchParams.set('appid', appId);

  return c.redirect(redirectUrl.toString());
});

function generateApiKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
