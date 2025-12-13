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
  const token = getCookie(c, 'token');

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
