import { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { verifyJWT } from '../auth/jwt';

type Env = {
  JWT_SECRET: string;
};

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export async function authMiddleware(
  c: Context<{ Bindings: Env; Variables: { user: AuthUser } }>,
  next: Next
) {
  // Try Authorization header first, then cookie
  let token: string | undefined;

  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else {
    token = getCookie(c, 'token');
  }

  if (!token) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const payload = await verifyJWT(token, c.env.JWT_SECRET);

  if (!payload) {
    return c.json({ error: 'Invalid token' }, 401);
  }

  c.set('user', {
    id: payload.sub,
    email: payload.email,
    name: payload.name,
  });

  await next();
}
