import { describe, it, expect, beforeEach } from 'vitest';
import { SELF } from 'cloudflare:test';
import { signJWT } from '../src/auth/jwt';
import { env } from 'cloudflare:test';

describe('App Management API', () => {
  const TEST_SECRET = 'test-jwt-secret';
  const TEST_USER = {
    sub: 'user123',
    email: 'test@example.com',
    name: 'Test User',
  };

  let authToken: string;

  beforeEach(async () => {
    // Clear KV before each test
    const kv = env.KV as KVNamespace;
    await kv.delete(`user:${TEST_USER.sub}:apps`);

    // Generate auth token for testing
    authToken = await signJWT(TEST_USER, TEST_SECRET);
  });

  describe('GET /api/me', () => {
    it('should return current user info when authenticated', async () => {
      const response = await SELF.fetch('http://localhost/api/me', {
        headers: {
          Cookie: `token=${authToken}`,
        },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.id).toBe(TEST_USER.sub);
      expect(data.email).toBe(TEST_USER.email);
      expect(data.name).toBe(TEST_USER.name);
    });

    it('should return 401 when not authenticated', async () => {
      const response = await SELF.fetch('http://localhost/api/me');

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe('Unauthorized');
    });

    it('should return 401 with invalid token', async () => {
      const response = await SELF.fetch('http://localhost/api/me', {
        headers: {
          Cookie: 'token=invalid-token',
        },
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe('Invalid token');
    });
  });

  describe('GET /api/apps', () => {
    it('should return empty list when user has no apps', async () => {
      const response = await SELF.fetch('http://localhost/api/apps', {
        headers: {
          Cookie: `token=${authToken}`,
        },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.apps).toEqual([]);
    });

    it('should return list of user apps', async () => {
      // Create some apps first
      const app1Response = await SELF.fetch('http://localhost/api/apps', {
        method: 'POST',
        headers: {
          Cookie: `token=${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Test App 1',
          capabilities: ['print', 'scrape'],
        }),
      });
      expect(app1Response.status).toBe(200);

      const app2Response = await SELF.fetch('http://localhost/api/apps', {
        method: 'POST',
        headers: {
          Cookie: `token=${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Test App 2',
          capabilities: ['print'],
        }),
      });
      expect(app2Response.status).toBe(200);

      // Get app list
      const response = await SELF.fetch('http://localhost/api/apps', {
        headers: {
          Cookie: `token=${authToken}`,
        },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.apps).toHaveLength(2);
      expect(data.apps[0].name).toBe('Test App 1');
      expect(data.apps[1].name).toBe('Test App 2');
    });
  });

  describe('POST /api/apps', () => {
    it('should create a new app', async () => {
      const response = await SELF.fetch('http://localhost/api/apps', {
        method: 'POST',
        headers: {
          Cookie: `token=${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'My Print Server',
          capabilities: ['print', 'scrape'],
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data.app).toBeDefined();
      expect(data.app.id).toBeDefined();
      expect(data.app.name).toBe('My Print Server');
      expect(data.app.capabilities).toEqual(['print', 'scrape']);
      expect(data.app.userId).toBe(TEST_USER.sub);
      expect(data.app.createdAt).toBeDefined();

      expect(data.apiKey).toBeDefined();
      expect(typeof data.apiKey).toBe('string');
      expect(data.apiKey.length).toBeGreaterThan(0);
    });

    it('should create app with empty capabilities', async () => {
      const response = await SELF.fetch('http://localhost/api/apps', {
        method: 'POST',
        headers: {
          Cookie: `token=${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Basic App',
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.app.capabilities).toEqual([]);
    });

    it('should return 400 when name is missing', async () => {
      const response = await SELF.fetch('http://localhost/api/apps', {
        method: 'POST',
        headers: {
          Cookie: `token=${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          capabilities: ['print'],
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Name is required');
    });

    it('should store API key in KV', async () => {
      const response = await SELF.fetch('http://localhost/api/apps', {
        method: 'POST',
        headers: {
          Cookie: `token=${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Test App',
          capabilities: ['print'],
        }),
      });

      const data = await response.json();
      const kv = env.KV as KVNamespace;

      // Verify API key is stored
      const keyData = await kv.get(`apikey:${data.apiKey}`, 'json');
      expect(keyData).toBeDefined();
      expect((keyData as any).appId).toBe(data.app.id);
      expect((keyData as any).userId).toBe(TEST_USER.sub);
    });

    it('should add app to user app list', async () => {
      const response = await SELF.fetch('http://localhost/api/apps', {
        method: 'POST',
        headers: {
          Cookie: `token=${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Test App',
          capabilities: ['print'],
        }),
      });

      const data = await response.json();
      const kv = env.KV as KVNamespace;

      // Verify app is in user's list
      const userApps = await kv.get(`user:${TEST_USER.sub}:apps`, 'json');
      expect(userApps).toBeDefined();
      expect(Array.isArray(userApps)).toBe(true);
      expect((userApps as string[]).includes(data.app.id)).toBe(true);
    });
  });

  describe('DELETE /api/apps/:appId', () => {
    it('should delete an app', async () => {
      // Create an app first
      const createResponse = await SELF.fetch('http://localhost/api/apps', {
        method: 'POST',
        headers: {
          Cookie: `token=${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'App to Delete',
          capabilities: ['print'],
        }),
      });
      const createData = await createResponse.json();
      const appId = createData.app.id;

      // Delete the app
      const deleteResponse = await SELF.fetch(
        `http://localhost/api/apps/${appId}`,
        {
          method: 'DELETE',
          headers: {
            Cookie: `token=${authToken}`,
          },
        }
      );

      expect(deleteResponse.status).toBe(200);
      const deleteData = await deleteResponse.json();
      expect(deleteData.ok).toBe(true);

      // Verify app is deleted from KV
      const kv = env.KV as KVNamespace;
      const app = await kv.get(`app:${appId}`);
      expect(app).toBeNull();
    });

    it('should remove app from user list', async () => {
      // Create an app
      const createResponse = await SELF.fetch('http://localhost/api/apps', {
        method: 'POST',
        headers: {
          Cookie: `token=${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'App to Delete',
          capabilities: ['print'],
        }),
      });
      const createData = await createResponse.json();
      const appId = createData.app.id;

      // Delete the app
      await SELF.fetch(`http://localhost/api/apps/${appId}`, {
        method: 'DELETE',
        headers: {
          Cookie: `token=${authToken}`,
        },
      });

      // Verify app is removed from user's list
      const kv = env.KV as KVNamespace;
      const userApps = await kv.get(`user:${TEST_USER.sub}:apps`, 'json');
      expect(userApps).toBeDefined();
      expect((userApps as string[]).includes(appId)).toBe(false);
    });

    it('should return 404 for non-existent app', async () => {
      const response = await SELF.fetch(
        'http://localhost/api/apps/non-existent-id',
        {
          method: 'DELETE',
          headers: {
            Cookie: `token=${authToken}`,
          },
        }
      );

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe('App not found');
    });

    it('should return 403 when trying to delete another user app', async () => {
      // Create app for user1
      const createResponse = await SELF.fetch('http://localhost/api/apps', {
        method: 'POST',
        headers: {
          Cookie: `token=${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'User1 App',
          capabilities: ['print'],
        }),
      });
      const createData = await createResponse.json();
      const appId = createData.app.id;

      // Create token for different user
      const otherUserToken = await signJWT(
        {
          sub: 'other-user',
          email: 'other@example.com',
          name: 'Other User',
        },
        TEST_SECRET
      );

      // Try to delete with different user
      const deleteResponse = await SELF.fetch(
        `http://localhost/api/apps/${appId}`,
        {
          method: 'DELETE',
          headers: {
            Cookie: `token=${otherUserToken}`,
          },
        }
      );

      expect(deleteResponse.status).toBe(403);
      const data = await deleteResponse.json();
      expect(data.error).toBe('Forbidden');
    });
  });

  describe('POST /api/apps/:appId/regenerate', () => {
    it('should regenerate API key', async () => {
      // Create an app
      const createResponse = await SELF.fetch('http://localhost/api/apps', {
        method: 'POST',
        headers: {
          Cookie: `token=${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Test App',
          capabilities: ['print'],
        }),
      });
      const createData = await createResponse.json();
      const appId = createData.app.id;
      const oldApiKey = createData.apiKey;

      // Regenerate API key
      const regenResponse = await SELF.fetch(
        `http://localhost/api/apps/${appId}/regenerate`,
        {
          method: 'POST',
          headers: {
            Cookie: `token=${authToken}`,
          },
        }
      );

      expect(regenResponse.status).toBe(200);
      const regenData = await regenResponse.json();
      expect(regenData.apiKey).toBeDefined();
      expect(regenData.apiKey).not.toBe(oldApiKey);

      // Verify new key is stored in KV
      const kv = env.KV as KVNamespace;
      const keyData = await kv.get(`apikey:${regenData.apiKey}`, 'json');
      expect(keyData).toBeDefined();
      expect((keyData as any).appId).toBe(appId);
    });

    it('should return 404 for non-existent app', async () => {
      const response = await SELF.fetch(
        'http://localhost/api/apps/non-existent/regenerate',
        {
          method: 'POST',
          headers: {
            Cookie: `token=${authToken}`,
          },
        }
      );

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe('App not found');
    });

    it('should return 403 when trying to regenerate another user app key', async () => {
      // Create app for user1
      const createResponse = await SELF.fetch('http://localhost/api/apps', {
        method: 'POST',
        headers: {
          Cookie: `token=${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'User1 App',
          capabilities: ['print'],
        }),
      });
      const createData = await createResponse.json();
      const appId = createData.app.id;

      // Create token for different user
      const otherUserToken = await signJWT(
        {
          sub: 'other-user',
          email: 'other@example.com',
          name: 'Other User',
        },
        TEST_SECRET
      );

      // Try to regenerate with different user
      const regenResponse = await SELF.fetch(
        `http://localhost/api/apps/${appId}/regenerate`,
        {
          method: 'POST',
          headers: {
            Cookie: `token=${otherUserToken}`,
          },
        }
      );

      expect(regenResponse.status).toBe(403);
      const data = await regenResponse.json();
      expect(data.error).toBe('Forbidden');
    });
  });

  describe('Integration: Multiple Apps Workflow', () => {
    it('should handle creating, listing, and deleting multiple apps', async () => {
      // Create 3 apps
      const app1 = await SELF.fetch('http://localhost/api/apps', {
        method: 'POST',
        headers: {
          Cookie: `token=${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'App 1',
          capabilities: ['print'],
        }),
      });
      const app1Data = await app1.json();

      const app2 = await SELF.fetch('http://localhost/api/apps', {
        method: 'POST',
        headers: {
          Cookie: `token=${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'App 2',
          capabilities: ['scrape'],
        }),
      });
      const app2Data = await app2.json();

      const app3 = await SELF.fetch('http://localhost/api/apps', {
        method: 'POST',
        headers: {
          Cookie: `token=${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'App 3',
          capabilities: ['print', 'scrape'],
        }),
      });
      const app3Data = await app3.json();

      // List apps
      const listResponse = await SELF.fetch('http://localhost/api/apps', {
        headers: {
          Cookie: `token=${authToken}`,
        },
      });
      const listData = await listResponse.json();
      expect(listData.apps).toHaveLength(3);

      // Delete one app
      await SELF.fetch(`http://localhost/api/apps/${app2Data.app.id}`, {
        method: 'DELETE',
        headers: {
          Cookie: `token=${authToken}`,
        },
      });

      // List again
      const listResponse2 = await SELF.fetch('http://localhost/api/apps', {
        headers: {
          Cookie: `token=${authToken}`,
        },
      });
      const listData2 = await listResponse2.json();
      expect(listData2.apps).toHaveLength(2);
      expect(listData2.apps.find((a: any) => a.id === app1Data.app.id)).toBeDefined();
      expect(listData2.apps.find((a: any) => a.id === app3Data.app.id)).toBeDefined();
      expect(listData2.apps.find((a: any) => a.id === app2Data.app.id)).toBeUndefined();
    });
  });
});
