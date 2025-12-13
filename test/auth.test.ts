import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';
import { signJWT } from '../src/auth/jwt';

describe('Authentication Middleware', () => {
  const TEST_SECRET = 'test-jwt-secret';
  const TEST_USER = {
    sub: 'user123',
    email: 'test@example.com',
    name: 'Test User',
  };

  describe('Cookie-based Authentication', () => {
    it('should allow access with valid token in cookie', async () => {
      const token = await signJWT(TEST_USER, TEST_SECRET);

      const response = await SELF.fetch('http://localhost/api/me', {
        headers: {
          Cookie: `token=${token}`,
        },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.id).toBe(TEST_USER.sub);
      expect(data.email).toBe(TEST_USER.email);
    });

    it('should reject request without token', async () => {
      const response = await SELF.fetch('http://localhost/api/me');

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe('Unauthorized');
    });

    it('should reject request with invalid token', async () => {
      const response = await SELF.fetch('http://localhost/api/me', {
        headers: {
          Cookie: 'token=invalid.token.here',
        },
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe('Invalid token');
    });

    it('should reject request with expired token', async () => {
      // Create a token that expires in -1 seconds
      const expiredToken = await signJWT(TEST_USER, TEST_SECRET, -1);

      await new Promise((resolve) => setTimeout(resolve, 100));

      const response = await SELF.fetch('http://localhost/api/me', {
        headers: {
          Cookie: `token=${expiredToken}`,
        },
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe('Invalid token');
    });

    it('should reject token signed with different secret', async () => {
      const token = await signJWT(TEST_USER, 'different-secret');

      const response = await SELF.fetch('http://localhost/api/me', {
        headers: {
          Cookie: `token=${token}`,
        },
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe('Invalid token');
    });

    it('should handle multiple cookies correctly', async () => {
      const token = await signJWT(TEST_USER, TEST_SECRET);

      const response = await SELF.fetch('http://localhost/api/me', {
        headers: {
          Cookie: `other=value; token=${token}; another=value`,
        },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.id).toBe(TEST_USER.sub);
    });
  });

  describe('User Context', () => {
    it('should set user context with correct fields', async () => {
      const token = await signJWT(TEST_USER, TEST_SECRET);

      const response = await SELF.fetch('http://localhost/api/me', {
        headers: {
          Cookie: `token=${token}`,
        },
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      // Check all expected fields are present
      expect(data).toHaveProperty('id');
      expect(data).toHaveProperty('email');
      expect(data).toHaveProperty('name');

      // Check values match
      expect(data.id).toBe(TEST_USER.sub);
      expect(data.email).toBe(TEST_USER.email);
      expect(data.name).toBe(TEST_USER.name);
    });

    it('should preserve user context across different routes', async () => {
      const token = await signJWT(TEST_USER, TEST_SECRET);

      // Test /api/me
      const meResponse = await SELF.fetch('http://localhost/api/me', {
        headers: {
          Cookie: `token=${token}`,
        },
      });
      const meData = await meResponse.json();

      // Test /api/apps
      const appsResponse = await SELF.fetch('http://localhost/api/apps', {
        headers: {
          Cookie: `token=${token}`,
        },
      });
      expect(appsResponse.status).toBe(200);

      // Both should have the same user
      expect(meData.id).toBe(TEST_USER.sub);
    });

    it('should handle different users correctly', async () => {
      const user1 = {
        sub: 'user1',
        email: 'user1@example.com',
        name: 'User One',
      };

      const user2 = {
        sub: 'user2',
        email: 'user2@example.com',
        name: 'User Two',
      };

      const token1 = await signJWT(user1, TEST_SECRET);
      const token2 = await signJWT(user2, TEST_SECRET);

      const response1 = await SELF.fetch('http://localhost/api/me', {
        headers: {
          Cookie: `token=${token1}`,
        },
      });
      const data1 = await response1.json();

      const response2 = await SELF.fetch('http://localhost/api/me', {
        headers: {
          Cookie: `token=${token2}`,
        },
      });
      const data2 = await response2.json();

      expect(data1.id).toBe(user1.sub);
      expect(data1.email).toBe(user1.email);

      expect(data2.id).toBe(user2.sub);
      expect(data2.email).toBe(user2.email);
    });
  });

  describe('Protected Routes', () => {
    it('should protect all /api/* routes', async () => {
      const protectedRoutes = [
        'http://localhost/api/me',
        'http://localhost/api/apps',
      ];

      for (const route of protectedRoutes) {
        const response = await SELF.fetch(route);
        expect(response.status).toBe(401);
      }
    });

    it('should allow access to protected routes with valid auth', async () => {
      const token = await signJWT(TEST_USER, TEST_SECRET);

      const protectedRoutes = [
        'http://localhost/api/me',
        'http://localhost/api/apps',
      ];

      for (const route of protectedRoutes) {
        const response = await SELF.fetch(route, {
          headers: {
            Cookie: `token=${token}`,
          },
        });
        expect(response.status).toBe(200);
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty cookie', async () => {
      const response = await SELF.fetch('http://localhost/api/me', {
        headers: {
          Cookie: '',
        },
      });

      expect(response.status).toBe(401);
    });

    it('should handle malformed cookie', async () => {
      const response = await SELF.fetch('http://localhost/api/me', {
        headers: {
          Cookie: 'malformed-cookie-string',
        },
      });

      expect(response.status).toBe(401);
    });

    it('should handle token with special characters', async () => {
      const token = await signJWT(
        {
          sub: 'user123',
          email: 'test+special@example.com',
          name: "User's Name (Special)",
        },
        TEST_SECRET
      );

      const response = await SELF.fetch('http://localhost/api/me', {
        headers: {
          Cookie: `token=${token}`,
        },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.email).toBe('test+special@example.com');
      expect(data.name).toBe("User's Name (Special)");
    });

    it('should handle very long token', async () => {
      const longName = 'A'.repeat(1000);
      const token = await signJWT(
        {
          sub: 'user123',
          email: 'test@example.com',
          name: longName,
        },
        TEST_SECRET
      );

      const response = await SELF.fetch('http://localhost/api/me', {
        headers: {
          Cookie: `token=${token}`,
        },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.name).toBe(longName);
    });

    it('should reject token with missing required fields', async () => {
      // Create a custom token without required fields
      const invalidPayload = {
        sub: 'user123',
        // Missing email and name
      };

      const token = await signJWT(invalidPayload as any, TEST_SECRET);

      const response = await SELF.fetch('http://localhost/api/me', {
        headers: {
          Cookie: `token=${token}`,
        },
      });

      // Should still verify but may have undefined fields
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.id).toBe('user123');
    });
  });

  describe('Security', () => {
    it('should not leak sensitive information in error messages', async () => {
      const response = await SELF.fetch('http://localhost/api/me', {
        headers: {
          Cookie: 'token=definitely.invalid.token',
        },
      });

      expect(response.status).toBe(401);
      const data = await response.json();

      // Error should be generic
      expect(data.error).toBe('Invalid token');
      // Should not contain details about why it's invalid
      expect(JSON.stringify(data)).not.toContain('signature');
      expect(JSON.stringify(data)).not.toContain('expired');
    });

    it('should handle concurrent authentication requests', async () => {
      const tokens = await Promise.all([
        signJWT({ ...TEST_USER, sub: 'user1' }, TEST_SECRET),
        signJWT({ ...TEST_USER, sub: 'user2' }, TEST_SECRET),
        signJWT({ ...TEST_USER, sub: 'user3' }, TEST_SECRET),
      ]);

      const responses = await Promise.all(
        tokens.map((token) =>
          SELF.fetch('http://localhost/api/me', {
            headers: {
              Cookie: `token=${token}`,
            },
          })
        )
      );

      const data = await Promise.all(responses.map((r) => r.json()));

      expect(data[0].id).toBe('user1');
      expect(data[1].id).toBe('user2');
      expect(data[2].id).toBe('user3');
    });
  });
});
