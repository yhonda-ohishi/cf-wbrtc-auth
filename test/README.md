# Test Suite for Cloudflare Workers

This directory contains comprehensive integration tests for the cf-wbrtc-auth Cloudflare Workers project using Vitest and @cloudflare/vitest-pool-workers.

## Test Structure

### Test Files

- **jwt.test.ts** - JWT authentication tests (12 tests)
  - JWT signing and structure validation
  - Token expiration handling
  - Signature verification
  - Round-trip encoding/decoding

- **auth.test.ts** - Authentication middleware tests (18 tests)
  - Cookie-based authentication
  - User context management
  - Protected route access control
  - Edge cases and security scenarios

- **apps.test.ts** - App management API integration tests (18 tests)
  - App CRUD operations (Create, Read, Delete)
  - API key generation and regeneration
  - User ownership validation
  - Multi-app workflows

## Running Tests

### Run all tests
```bash
npm test
```

### Run tests in watch mode
```bash
npm run test:watch
```

### Run tests with coverage
```bash
npm run test:coverage
```

## Test Environment

The tests use **@cloudflare/vitest-pool-workers** which provides:
- Miniflare-based KV namespace mocking
- Cloudflare Workers runtime simulation
- Environment bindings (JWT_SECRET, KV, etc.)

### Configuration

Tests are configured in `vitest.config.ts`:
- KV namespace binding for data storage
- JWT_SECRET and GOOGLE_CLIENT_SECRET for authentication
- wrangler.toml compatibility settings

## Key Features

### KV Mocking
The test suite uses Miniflare to mock KV operations:
- No external dependencies required
- In-memory storage for fast test execution
- Automatic cleanup between tests

### Isolated Test Execution
Each test runs in an isolated Cloudflare Workers runtime:
- No shared state between tests
- True integration testing with Workers APIs
- Accurate simulation of production behavior

### Coverage

The test suite provides comprehensive coverage of:
- Authentication flows (JWT signing, verification, cookie handling)
- API authorization (middleware, user context)
- Data persistence (KV operations)
- Error handling and edge cases

## Test Results

Total: **48 tests** across 3 test files

- JWT Authentication: 12 tests
- Auth Middleware: 18 tests
- App Management API: 18 tests

All tests validate core functionality including:
- User authentication and authorization
- App registration and management
- API key lifecycle
- Multi-user isolation
- Security edge cases

## Dependencies

- `vitest@1.3.0` - Test framework
- `@cloudflare/vitest-pool-workers@0.1.11` - Cloudflare Workers test pool
- `@cloudflare/workers-types` - TypeScript types
- `tslib` - TypeScript runtime library

## Notes

- Tests require `nodejs_compat` compatibility flag in wrangler.toml
- The test environment uses compatibility date "2024-03-29" (latest supported by test runtime)
- Miniflare may show warnings about temporary directory cleanup on Windows (harmless)
