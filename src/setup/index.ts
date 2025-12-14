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

function isLocalhost(req: Request): boolean {
  const url = new URL(req.url);
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
}

// 1. POST /setup/init - Initialize setup and return token
setupRoutes.post('/init', async (c) => {
  // Generate setup token (UUID)
  const token = crypto.randomUUID();
  const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

  // Save to KV
  await c.env.KV.put(
    `setup:${token}`,
    JSON.stringify({
      status: 'pending',
      expiresAt,
    }),
    { expirationTtl: 300 } // Auto-expire after 5 minutes
  );

  const baseUrl = getBaseUrl(c.req.raw);
  return c.json({
    token,
    url: `${baseUrl}/setup/${token}`,
  });
});

// 5. GET /setup/poll - Poll for setup completion status
// NOTE: This must come before /:token route to avoid matching "poll" as a token
setupRoutes.get('/poll', async (c) => {
  const token = c.req.query('token');

  if (!token) {
    return c.text('Missing token parameter', 400);
  }

  // Get setup data from KV
  const setupData = await c.env.KV.get(`setup:${token}`, 'json');

  if (!setupData) {
    return c.text('Setup token not found or expired', 404);
  }

  const data = setupData as {
    status: string;
    expiresAt: number;
    apiKey?: string;
    appId?: string;
    refreshToken?: string;
  };

  // Check expiration
  if (Date.now() > data.expiresAt) {
    await c.env.KV.delete(`setup:${token}`);
    return c.text('Setup token expired', 404);
  }

  // Return status based on current state
  if (data.status === 'complete') {
    return c.json({
      status: 'complete',
      apiKey: data.apiKey,
      appId: data.appId,
      refreshToken: data.refreshToken,
    });
  } else {
    return c.json({
      status: 'pending',
    });
  }
});

// 2. GET /setup/:token - Validate token and redirect to OAuth
setupRoutes.get('/:token', async (c) => {
  const token = c.req.param('token');

  // Validate token from KV
  const setupData = await c.env.KV.get(`setup:${token}`, 'json');

  if (!setupData) {
    return c.text('Setup token not found or expired', 404);
  }

  const data = setupData as { status: string; expiresAt: number };

  // Check expiration
  if (Date.now() > data.expiresAt) {
    await c.env.KV.delete(`setup:${token}`);
    return c.text('Setup token expired', 404);
  }

  // Store token in cookie for later use
  const secure = !isLocalhost(c.req.raw);
  setCookie(c, 'setup_token', token, {
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    maxAge: 600, // 10 minutes
    path: '/',
  });

  // Redirect to OAuth with return to /setup/:token/complete
  const baseUrl = getBaseUrl(c.req.raw);
  return c.redirect(`${baseUrl}/auth/login?return=/setup/${token}/complete`);
});

// 3. GET /setup/:token/complete - Show app registration form after OAuth
setupRoutes.get('/:token/complete', async (c) => {
  const token = c.req.param('token');
  const jwtToken = getCookie(c, 'token');
  const setupToken = getCookie(c, 'setup_token') || token;

  // Check JWT authentication
  if (!jwtToken) {
    return c.text('Not authenticated', 401);
  }

  const payload = await verifyJWT(jwtToken, c.env.JWT_SECRET);
  if (!payload) {
    return c.text('Invalid token', 401);
  }

  // Validate setup token
  const setupData = await c.env.KV.get(`setup:${setupToken}`, 'json');
  if (!setupData) {
    return c.text('Setup token not found or expired', 404);
  }

  const data = setupData as { status: string; expiresAt: number };

  // Check expiration
  if (Date.now() > data.expiresAt) {
    await c.env.KV.delete(`setup:${setupToken}`);
    return c.text('Setup token expired', 404);
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

  <form method="POST" action="/setup/${setupToken}/register">
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

// 4. POST /setup/:token/register - Handle app registration
setupRoutes.post('/:token/register', async (c) => {
  const token = c.req.param('token');
  const jwtToken = getCookie(c, 'token');
  const setupToken = getCookie(c, 'setup_token') || token;

  // Check JWT authentication
  if (!jwtToken) {
    return c.text('Not authenticated', 401);
  }

  const payload = await verifyJWT(jwtToken, c.env.JWT_SECRET);
  if (!payload) {
    return c.text('Invalid token', 401);
  }

  // Validate setup token
  const setupData = await c.env.KV.get(`setup:${setupToken}`, 'json');
  if (!setupData) {
    return c.text('Setup token not found or expired', 404);
  }

  const data = setupData as { status: string; expiresAt: number };

  // Check expiration
  if (Date.now() > data.expiresAt) {
    await c.env.KV.delete(`setup:${setupToken}`);
    return c.text('Setup token expired', 404);
  }

  // Get form data
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

  // Generate refresh token
  const refreshToken = generateRefreshToken();

  // Save refresh token mapping (long-lived)
  await c.env.KV.put(
    `refreshtoken:${refreshToken}`,
    JSON.stringify({
      appId,
      apiKey,
      userId: payload.sub,
      createdAt: Date.now(),
    })
  );

  // Update setup status to complete
  await c.env.KV.put(
    `setup:${setupToken}`,
    JSON.stringify({
      status: 'complete',
      apiKey,
      appId,
      refreshToken,
      expiresAt: data.expiresAt,
    }),
    { expirationTtl: 300 } // Keep for 5 more minutes for polling
  );

  // Clear setup cookie
  deleteCookie(c, 'setup_token');

  // Show completion page
  return c.html(`
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Setup Complete</title>
  <style>
    body {
      font-family: sans-serif;
      max-width: 400px;
      margin: 50px auto;
      padding: 20px;
      text-align: center;
    }
    h1 {
      font-size: 1.5rem;
      color: #38a169;
    }
    p {
      margin: 20px 0;
      color: #666;
    }
    .success-icon {
      font-size: 4rem;
      color: #38a169;
      margin: 20px 0;
    }
  </style>
</head>
<body>
  <div class="success-icon">✓</div>
  <h1>Setup Complete!</h1>
  <p>Your app has been successfully registered.</p>
  <p>You can now close this window.</p>
</body>
</html>
  `);
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
