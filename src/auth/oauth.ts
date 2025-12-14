import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { signJWT } from './jwt';

type Env = {
  KV: KVNamespace;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  JWT_SECRET: string;
};

export const authRoutes = new Hono<{ Bindings: Env }>();

function getBaseUrl(req: Request): string {
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

function isLocalhost(req: Request): boolean {
  const url = new URL(req.url);
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
}

function isExternalUrl(returnUrl: string, baseUrl: string): boolean {
  // Check if returnUrl is an absolute URL pointing to a different origin
  try {
    const returnOrigin = new URL(returnUrl).origin;
    const currentOrigin = new URL(baseUrl).origin;
    return returnOrigin !== currentOrigin;
  } catch {
    // Not a valid absolute URL, treat as relative path
    return false;
  }
}

authRoutes.get('/login', async (c) => {
  const baseUrl = getBaseUrl(c.req.raw);
  const redirectUri = `${baseUrl}/auth/callback`;

  // Store state for CSRF protection
  const state = crypto.randomUUID();
  const secure = !isLocalhost(c.req.raw);
  setCookie(c, 'oauth_state', state, {
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    maxAge: 600,
    path: '/',
  });

  // Store return URL if provided
  const returnUrl = c.req.query('return') || '/';
  setCookie(c, 'oauth_return', returnUrl, {
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    maxAge: 600,
    path: '/',
  });

  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'offline',
    prompt: 'consent',
  });

  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

authRoutes.get('/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const storedState = getCookie(c, 'oauth_state');
  const returnUrl = getCookie(c, 'oauth_return') || '/';

  // Clear state cookies
  deleteCookie(c, 'oauth_state');
  deleteCookie(c, 'oauth_return');

  if (!code || !state || state !== storedState) {
    return c.text('Invalid OAuth state', 400);
  }

  const baseUrl = getBaseUrl(c.req.raw);
  const redirectUri = `${baseUrl}/auth/callback`;

  // Exchange code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    return c.text('Failed to exchange code', 500);
  }

  const tokens = (await tokenRes.json()) as { access_token: string };

  // Get user info
  const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userRes.ok) {
    return c.text('Failed to get user info', 500);
  }

  const googleUser = (await userRes.json()) as {
    id: string;
    email: string;
    name: string;
  };

  // Check or create user
  let userId = await c.env.KV.get(`user:email:${googleUser.email}`);

  if (!userId) {
    userId = crypto.randomUUID();
    await c.env.KV.put(`user:email:${googleUser.email}`, userId);
    await c.env.KV.put(
      `user:${userId}`,
      JSON.stringify({
        id: userId,
        email: googleUser.email,
        name: googleUser.name,
        createdAt: Date.now(),
      })
    );
  }

  // Issue JWT
  const jwt = await signJWT(
    { sub: userId, email: googleUser.email, name: googleUser.name },
    c.env.JWT_SECRET,
    86400 * 7 // 7 days
  );

  const secure = !isLocalhost(c.req.raw);

  // Check if returnUrl is external (different origin)
  if (isExternalUrl(returnUrl, baseUrl)) {
    // External redirect: issue short-lived auth code instead of JWT
    const authCode = crypto.randomUUID();

    // Store auth code with user data (expires in 60 seconds)
    await c.env.KV.put(
      `authcode:${authCode}`,
      JSON.stringify({
        userId,
        email: googleUser.email,
        name: googleUser.name,
      }),
      { expirationTtl: 60 }
    );

    const redirectUrl = new URL(returnUrl);
    redirectUrl.searchParams.set('code', authCode);
    return c.redirect(redirectUrl.toString());
  }

  // Same origin: set httpOnly cookie
  setCookie(c, 'token', jwt, {
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    maxAge: 86400 * 7,
    path: '/',
  });

  return c.redirect(returnUrl);
});

authRoutes.post('/logout', (c) => {
  deleteCookie(c, 'token');
  return c.json({ ok: true });
});

// Token exchange endpoint: exchange auth code for JWT
authRoutes.post('/token', async (c) => {
  const body = await c.req.json<{ code: string }>();
  const { code } = body;

  if (!code) {
    return c.json({ error: 'Missing code' }, 400);
  }

  // Retrieve and delete auth code (one-time use)
  const authCodeData = await c.env.KV.get(`authcode:${code}`, 'json') as {
    userId: string;
    email: string;
    name: string;
  } | null;

  if (!authCodeData) {
    return c.json({ error: 'Invalid or expired code' }, 400);
  }

  // Delete the code immediately (one-time use)
  await c.env.KV.delete(`authcode:${code}`);

  // Issue JWT
  const jwt = await signJWT(
    { sub: authCodeData.userId, email: authCodeData.email, name: authCodeData.name },
    c.env.JWT_SECRET,
    86400 * 7 // 7 days
  );

  return c.json({
    token: jwt,
    user: {
      userId: authCodeData.userId,
      email: authCodeData.email,
      name: authCodeData.name,
    },
  });
});
