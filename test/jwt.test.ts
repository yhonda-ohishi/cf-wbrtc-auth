import { describe, it, expect } from 'vitest';
import { signJWT, verifyJWT } from '../src/auth/jwt';

describe('JWT Authentication', () => {
  const TEST_SECRET = 'test-secret-key-for-jwt';
  const TEST_PAYLOAD = {
    sub: 'user123',
    email: 'test@example.com',
    name: 'Test User',
  };

  describe('signJWT', () => {
    it('should sign a JWT token with correct structure', async () => {
      const token = await signJWT(TEST_PAYLOAD, TEST_SECRET);

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');

      // JWT should have 3 parts separated by dots
      const parts = token.split('.');
      expect(parts).toHaveLength(3);
    });

    it('should include iat and exp in the payload', async () => {
      const token = await signJWT(TEST_PAYLOAD, TEST_SECRET);
      const parts = token.split('.');

      // Decode payload (second part)
      const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = payloadB64 + '='.repeat((4 - (payloadB64.length % 4)) % 4);
      const decoded = JSON.parse(atob(padded));

      expect(decoded.iat).toBeDefined();
      expect(decoded.exp).toBeDefined();
      expect(decoded.sub).toBe(TEST_PAYLOAD.sub);
      expect(decoded.email).toBe(TEST_PAYLOAD.email);
      expect(decoded.name).toBe(TEST_PAYLOAD.name);
    });

    it('should set expiration time correctly', async () => {
      const expiresIn = 3600; // 1 hour
      const token = await signJWT(TEST_PAYLOAD, TEST_SECRET, expiresIn);
      const parts = token.split('.');

      const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = payloadB64 + '='.repeat((4 - (payloadB64.length % 4)) % 4);
      const decoded = JSON.parse(atob(padded));

      expect(decoded.exp - decoded.iat).toBe(expiresIn);
    });

    it('should create different tokens for different secrets', async () => {
      const token1 = await signJWT(TEST_PAYLOAD, 'secret1');
      const token2 = await signJWT(TEST_PAYLOAD, 'secret2');

      expect(token1).not.toBe(token2);
    });
  });

  describe('verifyJWT', () => {
    it('should verify a valid token', async () => {
      const token = await signJWT(TEST_PAYLOAD, TEST_SECRET);
      const payload = await verifyJWT(token, TEST_SECRET);

      expect(payload).not.toBeNull();
      expect(payload?.sub).toBe(TEST_PAYLOAD.sub);
      expect(payload?.email).toBe(TEST_PAYLOAD.email);
      expect(payload?.name).toBe(TEST_PAYLOAD.name);
      expect(payload?.iat).toBeDefined();
      expect(payload?.exp).toBeDefined();
    });

    it('should reject token with wrong secret', async () => {
      const token = await signJWT(TEST_PAYLOAD, TEST_SECRET);
      const payload = await verifyJWT(token, 'wrong-secret');

      expect(payload).toBeNull();
    });

    it('should reject malformed tokens', async () => {
      const malformedTokens = [
        'invalid',
        'invalid.token',
        'not.a.valid.token.at.all',
        '',
      ];

      for (const token of malformedTokens) {
        const payload = await verifyJWT(token, TEST_SECRET);
        expect(payload).toBeNull();
      }
    });

    it('should reject expired tokens', async () => {
      // Create a token that expires in -1 seconds (already expired)
      const token = await signJWT(TEST_PAYLOAD, TEST_SECRET, -1);

      // Wait a moment to ensure it's expired
      await new Promise((resolve) => setTimeout(resolve, 100));

      const payload = await verifyJWT(token, TEST_SECRET);
      expect(payload).toBeNull();
    });

    it('should accept token that has not expired yet', async () => {
      const token = await signJWT(TEST_PAYLOAD, TEST_SECRET, 3600);
      const payload = await verifyJWT(token, TEST_SECRET);

      expect(payload).not.toBeNull();
    });

    it('should reject token with tampered payload', async () => {
      const token = await signJWT(TEST_PAYLOAD, TEST_SECRET);
      const parts = token.split('.');

      // Tamper with the payload
      const tamperedPayload = { ...TEST_PAYLOAD, sub: 'hacker123' };
      const encoder = new TextEncoder();
      const tamperedBytes = encoder.encode(JSON.stringify(tamperedPayload));
      const tamperedB64 = btoa(String.fromCharCode(...tamperedBytes))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const tamperedToken = `${parts[0]}.${tamperedB64}.${parts[2]}`;
      const payload = await verifyJWT(tamperedToken, TEST_SECRET);

      expect(payload).toBeNull();
    });

    it('should handle concurrent verification correctly', async () => {
      const tokens = await Promise.all([
        signJWT({ ...TEST_PAYLOAD, sub: 'user1' }, TEST_SECRET),
        signJWT({ ...TEST_PAYLOAD, sub: 'user2' }, TEST_SECRET),
        signJWT({ ...TEST_PAYLOAD, sub: 'user3' }, TEST_SECRET),
      ]);

      const results = await Promise.all(
        tokens.map((token) => verifyJWT(token, TEST_SECRET))
      );

      expect(results[0]?.sub).toBe('user1');
      expect(results[1]?.sub).toBe('user2');
      expect(results[2]?.sub).toBe('user3');
    });
  });

  describe('JWT Round-trip', () => {
    it('should correctly encode and decode payload data', async () => {
      const testCases = [
        { sub: 'user1', email: 'test1@example.com', name: 'User One' },
        { sub: 'user2', email: 'test2@example.com', name: 'User Two' },
        { sub: 'user3', email: 'test3@example.com', name: 'Special !@#$%' },
      ];

      for (const payload of testCases) {
        const token = await signJWT(payload, TEST_SECRET);
        const verified = await verifyJWT(token, TEST_SECRET);

        expect(verified?.sub).toBe(payload.sub);
        expect(verified?.email).toBe(payload.email);
        expect(verified?.name).toBe(payload.name);
      }
    });
  });
});
