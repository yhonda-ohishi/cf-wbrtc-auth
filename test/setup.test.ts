import { describe, it, expect, beforeEach } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import { signJWT } from '../src/auth/jwt';

describe('Setup API (Polling-based)', () => {
  const TEST_SECRET = 'test-jwt-secret';
  const TEST_USER = {
    sub: 'user123',
    email: 'test@example.com',
    name: 'Test User',
  };

  // Helper to create a setup token
  async function createSetupToken(): Promise<string> {
    const response = await SELF.fetch('http://localhost/setup/init', {
      method: 'POST',
    });

    expect(response.status).toBe(200);
    const data = (await response.json()) as { token: string; url: string };
    return data.token;
  }

  describe('POST /setup/init', () => {
    it('should create a new setup token', async () => {
      const response = await SELF.fetch('http://localhost/setup/init', {
        method: 'POST',
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as { token: string; url: string };

      // Check response structure
      expect(data).toHaveProperty('token');
      expect(data).toHaveProperty('url');

      // Token should be a UUID
      expect(data.token).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );

      // URL should contain the token
      expect(data.url).toContain(data.token);
      expect(data.url).toContain('/setup/');
    });

    it('should create unique tokens for each request', async () => {
      const response1 = await SELF.fetch('http://localhost/setup/init', {
        method: 'POST',
      });
      const data1 = (await response1.json()) as { token: string };

      const response2 = await SELF.fetch('http://localhost/setup/init', {
        method: 'POST',
      });
      const data2 = (await response2.json()) as { token: string };

      expect(data1.token).not.toBe(data2.token);
    });

    it('should store token in KV with pending status', async () => {
      const response = await SELF.fetch('http://localhost/setup/init', {
        method: 'POST',
      });
      const data = (await response.json()) as { token: string };

      // Verify token is stored in KV
      const kvData = await env.KV.get(`setup:${data.token}`, 'json');
      expect(kvData).toBeTruthy();
      expect((kvData as any).status).toBe('pending');
      expect((kvData as any).expiresAt).toBeGreaterThan(Date.now());
    });
  });

  describe('GET /setup/:token', () => {
    it('should redirect to OAuth when token is valid', async () => {
      const token = await createSetupToken();

      const response = await SELF.fetch(`http://localhost/setup/${token}`, {
        redirect: 'manual',
      });

      expect(response.status).toBe(302);
      const location = response.headers.get('Location');
      expect(location).toContain('/auth/login');
      expect(location).toContain(`return=/setup/${token}/complete`);
    });

    it('should return 404 for non-existent token', async () => {
      const fakeToken = '00000000-0000-0000-0000-000000000000';

      const response = await SELF.fetch(`http://localhost/setup/${fakeToken}`);

      expect(response.status).toBe(404);
      const text = await response.text();
      expect(text).toContain('not found or expired');
    });

    it('should set setup_token cookie', async () => {
      const token = await createSetupToken();

      const response = await SELF.fetch(`http://localhost/setup/${token}`, {
        redirect: 'manual',
      });

      const setCookie = response.headers.get('Set-Cookie');
      expect(setCookie).toContain('setup_token=');
      expect(setCookie).toContain(token);
    });
  });

  describe('GET /setup/:token/complete', () => {
    it('should return 401 without JWT authentication', async () => {
      const token = await createSetupToken();

      const response = await SELF.fetch(
        `http://localhost/setup/${token}/complete`
      );

      expect(response.status).toBe(401);
      const text = await response.text();
      expect(text).toContain('Not authenticated');
    });

    it('should return 404 for invalid setup token', async () => {
      const jwtToken = await signJWT(TEST_USER, TEST_SECRET);
      const fakeToken = '00000000-0000-0000-0000-000000000000';

      const response = await SELF.fetch(
        `http://localhost/setup/${fakeToken}/complete`,
        {
          headers: {
            Cookie: `token=${jwtToken}`,
          },
        }
      );

      expect(response.status).toBe(404);
    });

    it('should show registration form with valid auth and token', async () => {
      const setupToken = await createSetupToken();
      const jwtToken = await signJWT(TEST_USER, TEST_SECRET);

      const response = await SELF.fetch(
        `http://localhost/setup/${setupToken}/complete`,
        {
          headers: {
            Cookie: `token=${jwtToken}; setup_token=${setupToken}`,
          },
        }
      );

      expect(response.status).toBe(200);
      const html = await response.text();

      // Check HTML contains registration form
      expect(html).toContain('App Registration');
      expect(html).toContain('Welcome, Test User');
      expect(html).toContain('name="name"');
      expect(html).toContain('name="capabilities"');
      expect(html).toContain(`action="/setup/${setupToken}/register"`);
    });
  });

  describe('POST /setup/:token/register', () => {
    it('should return 401 without JWT authentication', async () => {
      const token = await createSetupToken();

      const response = await SELF.fetch(
        `http://localhost/setup/${token}/register`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: 'name=Test App',
        }
      );

      expect(response.status).toBe(401);
    });

    it('should return 404 for invalid setup token', async () => {
      const jwtToken = await signJWT(TEST_USER, TEST_SECRET);
      const fakeToken = '00000000-0000-0000-0000-000000000000';

      const response = await SELF.fetch(
        `http://localhost/setup/${fakeToken}/register`,
        {
          method: 'POST',
          headers: {
            Cookie: `token=${jwtToken}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: 'name=Test App',
        }
      );

      expect(response.status).toBe(404);
    });

    it('should return 400 without app name', async () => {
      const setupToken = await createSetupToken();
      const jwtToken = await signJWT(TEST_USER, TEST_SECRET);

      const response = await SELF.fetch(
        `http://localhost/setup/${setupToken}/register`,
        {
          method: 'POST',
          headers: {
            Cookie: `token=${jwtToken}; setup_token=${setupToken}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: '',
        }
      );

      expect(response.status).toBe(400);
      const text = await response.text();
      expect(text).toContain('Name is required');
    });

    it('should register app and update setup status', async () => {
      const setupToken = await createSetupToken();
      const jwtToken = await signJWT(TEST_USER, TEST_SECRET);

      const response = await SELF.fetch(
        `http://localhost/setup/${setupToken}/register`,
        {
          method: 'POST',
          headers: {
            Cookie: `token=${jwtToken}; setup_token=${setupToken}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: 'name=Test App&capabilities=print&capabilities=scrape',
        }
      );

      expect(response.status).toBe(200);

      // Check completion page
      const html = await response.text();
      expect(html).toContain('Setup Complete');
      expect(html).toContain('successfully registered');

      // Verify setup status is updated in KV
      const setupData = (await env.KV.get(`setup:${setupToken}`, 'json')) as any;
      expect(setupData).toBeTruthy();
      expect(setupData.status).toBe('complete');
      expect(setupData.apiKey).toBeTruthy();
      expect(setupData.appId).toBeTruthy();

      // Verify app is created in KV
      const appData = (await env.KV.get(`app:${setupData.appId}`, 'json')) as any;
      expect(appData).toBeTruthy();
      expect(appData.name).toBe('Test App');
      expect(appData.capabilities).toEqual(['print', 'scrape']);
      expect(appData.userId).toBe(TEST_USER.sub);

      // Verify API key is created
      const keyData = (await env.KV.get(`apikey:${setupData.apiKey}`, 'json')) as any;
      expect(keyData).toBeTruthy();
      expect(keyData.appId).toBe(setupData.appId);
      expect(keyData.userId).toBe(TEST_USER.sub);
    });

    it('should handle app registration without capabilities', async () => {
      const setupToken = await createSetupToken();
      const jwtToken = await signJWT(TEST_USER, TEST_SECRET);

      const response = await SELF.fetch(
        `http://localhost/setup/${setupToken}/register`,
        {
          method: 'POST',
          headers: {
            Cookie: `token=${jwtToken}; setup_token=${setupToken}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: 'name=Simple App',
        }
      );

      expect(response.status).toBe(200);

      // Verify app has empty capabilities
      const setupData = (await env.KV.get(`setup:${setupToken}`, 'json')) as any;
      const appData = (await env.KV.get(`app:${setupData.appId}`, 'json')) as any;
      expect(appData.capabilities).toEqual([]);
    });
  });

  describe('GET /setup/poll', () => {
    it('should return 400 without token parameter', async () => {
      const response = await SELF.fetch('http://localhost/setup/poll');

      expect(response.status).toBe(400);
      const text = await response.text();
      expect(text).toContain('Missing token parameter');
    });

    it('should return 404 for non-existent token', async () => {
      const fakeToken = '00000000-0000-0000-0000-000000000000';

      const response = await SELF.fetch(
        `http://localhost/setup/poll?token=${fakeToken}`
      );

      expect(response.status).toBe(404);
    });

    it('should return pending status for incomplete setup', async () => {
      const token = await createSetupToken();

      const response = await SELF.fetch(
        `http://localhost/setup/poll?token=${token}`
      );

      expect(response.status).toBe(200);
      const data = (await response.json()) as { status: string };
      expect(data.status).toBe('pending');
      expect(data).not.toHaveProperty('apiKey');
      expect(data).not.toHaveProperty('appId');
    });

    it('should return complete status with credentials after registration', async () => {
      const setupToken = await createSetupToken();
      const jwtToken = await signJWT(TEST_USER, TEST_SECRET);

      // Complete registration
      await SELF.fetch(`http://localhost/setup/${setupToken}/register`, {
        method: 'POST',
        headers: {
          Cookie: `token=${jwtToken}; setup_token=${setupToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'name=Test App&capabilities=print',
      });

      // Poll for status
      const response = await SELF.fetch(
        `http://localhost/setup/poll?token=${setupToken}`
      );

      expect(response.status).toBe(200);
      const data = (await response.json()) as {
        status: string;
        apiKey: string;
        appId: string;
      };

      expect(data.status).toBe('complete');
      expect(data.apiKey).toBeTruthy();
      expect(data.appId).toBeTruthy();

      // Verify API key format (64 hex characters)
      expect(data.apiKey).toMatch(/^[0-9a-f]{64}$/);
      // Verify appId format (UUID)
      expect(data.appId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });
  });

  describe('End-to-End Flow', () => {
    it('should complete full setup flow', async () => {
      // Step 1: Initialize setup
      const initResponse = await SELF.fetch('http://localhost/setup/init', {
        method: 'POST',
      });
      const { token } = (await initResponse.json()) as { token: string };

      // Step 2: Poll - should be pending
      let pollResponse = await SELF.fetch(
        `http://localhost/setup/poll?token=${token}`
      );
      let pollData = (await pollResponse.json()) as { status: string };
      expect(pollData.status).toBe('pending');

      // Step 3: Access setup URL (would redirect to OAuth in real flow)
      // In test, we skip OAuth and go directly to complete

      // Step 4: Register app (simulating post-OAuth flow)
      const jwtToken = await signJWT(TEST_USER, TEST_SECRET);
      const registerResponse = await SELF.fetch(
        `http://localhost/setup/${token}/register`,
        {
          method: 'POST',
          headers: {
            Cookie: `token=${jwtToken}; setup_token=${token}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: 'name=My PC&capabilities=print&capabilities=scrape',
        }
      );
      expect(registerResponse.status).toBe(200);

      // Step 5: Poll - should be complete
      pollResponse = await SELF.fetch(
        `http://localhost/setup/poll?token=${token}`
      );
      pollData = (await pollResponse.json()) as any;
      expect(pollData.status).toBe('complete');
      expect(pollData.apiKey).toBeTruthy();
      expect(pollData.appId).toBeTruthy();

      // Step 6: Verify app can connect with API key
      const wsResponse = await SELF.fetch(
        `http://localhost/ws/app?apiKey=${pollData.apiKey}`,
        {
          headers: {
            Upgrade: 'websocket',
          },
        }
      );

      // Should not return 401 (API key is valid)
      expect(wsResponse.status).not.toBe(401);
    });
  });

  describe('Security', () => {
    it('should not allow registration with expired token', async () => {
      const setupToken = await createSetupToken();

      // Manually expire the token in KV
      const setupData = (await env.KV.get(`setup:${setupToken}`, 'json')) as any;
      setupData.expiresAt = Date.now() - 1000; // Expired 1 second ago
      await env.KV.put(`setup:${setupToken}`, JSON.stringify(setupData));

      const jwtToken = await signJWT(TEST_USER, TEST_SECRET);
      const response = await SELF.fetch(
        `http://localhost/setup/${setupToken}/register`,
        {
          method: 'POST',
          headers: {
            Cookie: `token=${jwtToken}; setup_token=${setupToken}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: 'name=Test App',
        }
      );

      expect(response.status).toBe(404);
      const text = await response.text();
      expect(text).toContain('expired');
    });

    it('should not allow polling with expired token', async () => {
      const setupToken = await createSetupToken();

      // Manually expire the token
      const setupData = (await env.KV.get(`setup:${setupToken}`, 'json')) as any;
      setupData.expiresAt = Date.now() - 1000;
      await env.KV.put(`setup:${setupToken}`, JSON.stringify(setupData));

      const response = await SELF.fetch(
        `http://localhost/setup/poll?token=${setupToken}`
      );

      expect(response.status).toBe(404);
    });

    it('should generate unique API keys for each app', async () => {
      const jwtToken = await signJWT(TEST_USER, TEST_SECRET);

      // Register first app
      const token1 = await createSetupToken();
      await SELF.fetch(`http://localhost/setup/${token1}/register`, {
        method: 'POST',
        headers: {
          Cookie: `token=${jwtToken}; setup_token=${token1}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'name=App 1',
      });

      // Register second app
      const token2 = await createSetupToken();
      await SELF.fetch(`http://localhost/setup/${token2}/register`, {
        method: 'POST',
        headers: {
          Cookie: `token=${jwtToken}; setup_token=${token2}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'name=App 2',
      });

      // Get both API keys
      const poll1 = await SELF.fetch(
        `http://localhost/setup/poll?token=${token1}`
      );
      const data1 = (await poll1.json()) as any;

      const poll2 = await SELF.fetch(
        `http://localhost/setup/poll?token=${token2}`
      );
      const data2 = (await poll2.json()) as any;

      // API keys should be different
      expect(data1.apiKey).not.toBe(data2.apiKey);
      expect(data1.appId).not.toBe(data2.appId);
    });
  });
});
