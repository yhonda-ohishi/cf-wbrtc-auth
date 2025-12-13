# Cloudflare Workers WebRTC Signaling Server API Documentation

## Overview

This API provides WebRTC signaling services for P2P communication between browser clients and Go applications. It uses Cloudflare Workers with Durable Objects for scalable WebSocket management.

**Base URL**: `https://your-worker.workers.dev`

## Table of Contents

- [Authentication Endpoints](#authentication-endpoints)
- [App Management API](#app-management-api)
- [Setup Flow (Go App Initial Configuration)](#setup-flow-go-app-initial-configuration)
- [WebSocket Connections](#websocket-connections)
- [WebSocket Message Protocol](#websocket-message-protocol)
- [Error Codes](#error-codes)

---

## Authentication Endpoints

### Google OAuth Login

Initiates Google OAuth 2.0 authentication flow.

**Endpoint**: `GET /auth/login`

**Query Parameters**:
- `return` (optional): URL to redirect after successful authentication (default: `/`)

**Authentication**: None

**Response**: HTTP 302 redirect to Google OAuth consent page

**Flow**:
1. Sets CSRF protection state cookie
2. Stores return URL in cookie
3. Redirects to Google OAuth consent page

**Example**:
```
GET /auth/login?return=/setup/complete
```

---

### OAuth Callback

Handles OAuth callback from Google.

**Endpoint**: `GET /auth/callback`

**Query Parameters**:
- `code` (required): OAuth authorization code from Google
- `state` (required): CSRF state token

**Authentication**: None (validates OAuth state)

**Response**: HTTP 302 redirect to return URL

**Success Flow**:
1. Validates OAuth state token
2. Exchanges authorization code for access token
3. Retrieves user profile from Google
4. Creates or retrieves user record in KV
5. Issues JWT token
6. Sets `token` cookie (HTTP-only, secure, 7 days)
7. Redirects to return URL

**Error Responses**:
- `400 Bad Request`: Invalid OAuth state
- `500 Internal Server Error`: Failed to exchange code or retrieve user info

---

### Logout

Invalidates user session.

**Endpoint**: `POST /auth/logout`

**Authentication**: None (simply clears cookie)

**Request Body**: None

**Response**:
```json
{
  "ok": true
}
```

**Status Codes**:
- `200 OK`: Successfully logged out

---

## App Management API

All App Management endpoints require JWT authentication via cookie.

### Get Current User

Returns authenticated user information.

**Endpoint**: `GET /api/me`

**Authentication**: Required (JWT cookie)

**Request**: None

**Response**:
```json
{
  "id": "user-uuid",
  "email": "user@example.com",
  "name": "User Name"
}
```

**Status Codes**:
- `200 OK`: Success
- `401 Unauthorized`: Missing or invalid JWT token

---

### List User's Apps

Returns all apps registered by the authenticated user.

**Endpoint**: `GET /api/apps`

**Authentication**: Required (JWT cookie)

**Request**: None

**Response**:
```json
{
  "apps": [
    {
      "id": "app-uuid",
      "userId": "user-uuid",
      "name": "My PC",
      "capabilities": ["print", "scrape"],
      "createdAt": 1702584000000
    }
  ]
}
```

**Status Codes**:
- `200 OK`: Success (returns empty array if no apps)
- `401 Unauthorized`: Missing or invalid JWT token

---

### Create App

Creates a new app and generates an API key.

**Endpoint**: `POST /api/apps`

**Authentication**: Required (JWT cookie)

**Request Body**:
```json
{
  "name": "My PC",
  "capabilities": ["print", "scrape"]
}
```

**Fields**:
- `name` (required): App display name
- `capabilities` (optional): Array of capability strings (e.g., `["print", "scrape"]`)

**Response**:
```json
{
  "app": {
    "id": "app-uuid",
    "userId": "user-uuid",
    "name": "My PC",
    "capabilities": ["print", "scrape"],
    "createdAt": 1702584000000
  },
  "apiKey": "64-character-hex-string"
}
```

**Status Codes**:
- `200 OK`: App created successfully
- `400 Bad Request`: Missing required fields
- `401 Unauthorized`: Missing or invalid JWT token

**Important**: Save the API key - it's only returned once during creation.

---

### Delete App

Deletes an app and removes it from the user's app list.

**Endpoint**: `DELETE /api/apps/:appId`

**Authentication**: Required (JWT cookie)

**Path Parameters**:
- `appId`: UUID of the app to delete

**Request**: None

**Response**:
```json
{
  "ok": true
}
```

**Status Codes**:
- `200 OK`: App deleted successfully
- `401 Unauthorized`: Missing or invalid JWT token
- `403 Forbidden`: User does not own this app
- `404 Not Found`: App does not exist

**Note**: Associated API keys will fail validation after app deletion, but are not explicitly deleted from KV.

---

### Regenerate API Key

Generates a new API key for an existing app.

**Endpoint**: `POST /api/apps/:appId/regenerate`

**Authentication**: Required (JWT cookie)

**Path Parameters**:
- `appId`: UUID of the app

**Request**: None

**Response**:
```json
{
  "apiKey": "new-64-character-hex-string"
}
```

**Status Codes**:
- `200 OK`: New API key generated
- `401 Unauthorized`: Missing or invalid JWT token
- `403 Forbidden`: User does not own this app
- `404 Not Found`: App does not exist

**Note**: Old API keys are not invalidated in KV storage but the new key will be associated with the app.

---

## Setup Flow (Go App Initial Configuration)

This flow enables Go applications to complete OAuth authentication and app registration through a browser-based setup process.

### Initiate Setup

Starts the setup flow for a Go app.

**Endpoint**: `GET /setup`

**Query Parameters**:
- `callback` (required): Local URL where Go app listens for completion (e.g., `http://localhost:8080/setup-callback`)

**Authentication**: None

**Response**: HTTP 302 redirect to OAuth login

**Flow**:
1. Stores callback URL in secure cookie (10 minutes)
2. Redirects to `/auth/login?return=/setup/complete`

**Example**:
```
GET /setup?callback=http://localhost:8080/setup-callback
```

---

### Setup Complete (Registration Form)

Shows app registration form after OAuth authentication.

**Endpoint**: `GET /setup/complete`

**Authentication**: Required (JWT cookie from OAuth)

**Response**: HTML form for app registration

**Status Codes**:
- `200 OK`: Returns HTML registration form
- `400 Bad Request`: Setup session expired (no callback cookie)
- `401 Unauthorized`: Not authenticated or invalid token

**Form Fields**:
- App Name (text input, required)
- Capabilities (checkboxes: print, scrape)

---

### Register App

Processes app registration form submission.

**Endpoint**: `POST /setup/register`

**Authentication**: Required (JWT cookie + setup callback cookie)

**Request Body** (form-data):
- `name` (required): App name
- `capabilities` (optional, multiple values): Array of capabilities

**Response**: HTTP 302 redirect to callback URL with query parameters

**Redirect URL Format**:
```
{callback}?apikey={apiKey}&appid={appId}
```

**Example**:
```
http://localhost:8080/setup-callback?apikey=abc123...&appid=uuid-here
```

**Status Codes**:
- `302 Found`: Success, redirects to callback
- `400 Bad Request`: Session expired or missing name
- `401 Unauthorized`: Invalid token

---

## WebSocket Connections

### Browser WebSocket

Establishes WebSocket connection for browser clients.

**Endpoint**: `GET /ws`

**Upgrade**: `websocket`

**Query Parameters**:
- `token` (required): JWT token for authentication

**Authentication**: JWT token (validated after connection via `auth` message)

**Response**: WebSocket upgrade (101 Switching Protocols)

**Example**:
```javascript
const ws = new WebSocket(`wss://your-worker.workers.dev/ws?token=${jwtToken}`);
```

**Status Codes**:
- `101 Switching Protocols`: WebSocket established
- `401 Unauthorized`: Missing token
- `426 Upgrade Required`: Missing WebSocket upgrade header

---

### Go App WebSocket

Establishes WebSocket connection for Go applications.

**Endpoint**: `GET /ws/app`

**Upgrade**: `websocket`

**Query Parameters**:
- `apiKey` (required): API key for app authentication

**Authentication**: API key (pre-validated, must send `auth` message)

**Response**: WebSocket upgrade (101 Switching Protocols)

**Example**:
```go
ws, _, err := websocket.DefaultDialer.Dial(
    "wss://your-worker.workers.dev/ws/app?apiKey="+apiKey, nil)
```

**Status Codes**:
- `101 Switching Protocols`: WebSocket established
- `401 Unauthorized`: Missing or invalid API key
- `426 Upgrade Required`: Missing WebSocket upgrade header

---

## WebSocket Message Protocol

All WebSocket messages use JSON format:

```json
{
  "type": "message_type",
  "payload": {},
  "requestId": "optional-correlation-id"
}
```

**Fields**:
- `type` (required): Message type identifier
- `payload` (required): Message-specific data
- `requestId` (optional): For request/response correlation

---

### Authentication Messages

#### Client → Server: `auth`

Authenticate the WebSocket connection.

**Browser Client**:
```json
{
  "type": "auth",
  "payload": {
    "token": "jwt-token-here"
  }
}
```

**Go App Client**:
```json
{
  "type": "auth",
  "payload": {
    "apiKey": "api-key-here"
  }
}
```

---

#### Server → Client: `auth_ok`

Authentication successful.

```json
{
  "type": "auth_ok",
  "payload": {
    "userId": "user-uuid",
    "type": "browser" | "app"
  }
}
```

---

#### Server → Client: `auth_error`

Authentication failed.

```json
{
  "type": "auth_error",
  "payload": {
    "error": "Invalid API key"
  }
}
```

---

### App Registration Messages

#### App → Server: `app_register`

Register app presence (sent after authentication).

```json
{
  "type": "app_register",
  "payload": {
    "name": "My PC",
    "capabilities": ["print", "scrape"]
  }
}
```

---

#### Server → App: `app_registered`

App registration confirmed.

```json
{
  "type": "app_registered",
  "payload": {
    "appId": "app-uuid"
  }
}
```

---

### App Status Messages

#### Server → Browser: `app_status`

Notifies browser of app online/offline status.

**Online**:
```json
{
  "type": "app_status",
  "payload": {
    "appId": "app-uuid",
    "name": "My PC",
    "capabilities": ["print", "scrape"],
    "status": "online"
  }
}
```

**Offline**:
```json
{
  "type": "app_status",
  "payload": {
    "appId": "app-uuid",
    "status": "offline"
  }
}
```

---

#### Browser → Server: `get_apps`

Request list of online apps.

```json
{
  "type": "get_apps",
  "payload": {}
}
```

---

#### Server → Browser: `apps_list`

List of currently online apps.

```json
{
  "type": "apps_list",
  "payload": {
    "apps": [
      {
        "appId": "app-uuid",
        "name": "My PC",
        "status": "online"
      }
    ]
  }
}
```

---

### WebRTC Signaling Messages

#### Browser → Server → App: `offer`

Send WebRTC SDP offer to app.

**Browser sends**:
```json
{
  "type": "offer",
  "payload": {
    "targetAppId": "app-uuid",
    "sdp": "v=0\r\no=- ..."
  },
  "requestId": "req-123"
}
```

**App receives**:
```json
{
  "type": "offer",
  "payload": {
    "sdp": "v=0\r\no=- ..."
  },
  "requestId": "req-123"
}
```

---

#### App → Server → Browser: `answer`

Send WebRTC SDP answer to browser.

**App sends**:
```json
{
  "type": "answer",
  "payload": {
    "sdp": "v=0\r\no=- ..."
  },
  "requestId": "req-123"
}
```

**Browser receives**:
```json
{
  "type": "answer",
  "payload": {
    "sdp": "v=0\r\no=- ...",
    "appId": "app-uuid"
  },
  "requestId": "req-123"
}
```

---

#### Browser ↔ App: `ice`

Exchange ICE candidates.

**Browser → App**:
```json
{
  "type": "ice",
  "payload": {
    "targetAppId": "app-uuid",
    "candidate": {
      "candidate": "candidate:...",
      "sdpMid": "0",
      "sdpMLineIndex": 0
    }
  }
}
```

**App → Browser**:
```json
{
  "type": "ice",
  "payload": {
    "candidate": {
      "candidate": "candidate:...",
      "sdpMid": "0",
      "sdpMLineIndex": 0
    }
  }
}
```

**Browser receives from App**:
```json
{
  "type": "ice",
  "payload": {
    "appId": "app-uuid",
    "candidate": {
      "candidate": "candidate:...",
      "sdpMid": "0",
      "sdpMLineIndex": 0
    }
  }
}
```

---

### Error Messages

#### Server → Client: `error`

General error message.

```json
{
  "type": "error",
  "payload": {
    "message": "Target app not found"
  }
}
```

---

## Error Codes

### HTTP Status Codes

| Code | Description |
|------|-------------|
| `200 OK` | Request successful |
| `302 Found` | Redirect (OAuth flow) |
| `400 Bad Request` | Invalid request parameters or missing required fields |
| `401 Unauthorized` | Missing or invalid authentication credentials |
| `403 Forbidden` | Authenticated but not authorized for resource |
| `404 Not Found` | Resource does not exist |
| `426 Upgrade Required` | WebSocket upgrade header missing |
| `500 Internal Server Error` | Server-side error |

---

### WebSocket Error Messages

| Error Message | Cause |
|---------------|-------|
| `Invalid message format` | Malformed JSON message |
| `Unknown message type: {type}` | Unrecognized message type |
| `Invalid API key` | API key not found in KV |
| `Invalid token` | JWT verification failed |
| `Missing credentials` | Neither API key nor token provided |
| `Not authenticated as app` | Operation requires app authentication |
| `Target app not found` | Specified app is not connected |

---

## Data Types

### User
```typescript
{
  id: string;          // UUID
  email: string;       // User email from Google
  name: string;        // User display name
  createdAt: number;   // Unix timestamp (ms)
}
```

### App
```typescript
{
  id: string;              // UUID
  userId: string;          // Owner user ID
  name: string;            // Display name
  capabilities: string[];  // e.g., ["print", "scrape"]
  createdAt: number;       // Unix timestamp (ms)
}
```

### API Key Mapping
```typescript
{
  appId: string;   // Associated app ID
  userId: string;  // Owner user ID
}
```

---

## KV Key Structure

| Key Pattern | Value | Purpose |
|-------------|-------|---------|
| `user:{userId}` | User object | User profile data |
| `user:email:{email}` | userId (string) | Email → User ID lookup |
| `user:{userId}:apps` | Array of appId strings | User's app list |
| `app:{appId}` | App object | App metadata |
| `apikey:{apiKey}` | API Key Mapping | API key → App mapping |

---

## Connection Flow Examples

### Browser Client Setup
```javascript
// 1. Login via OAuth (redirect)
window.location.href = '/auth/login';

// 2. After redirect back, connect WebSocket
const token = getCookie('token');
const ws = new WebSocket(`wss://your-worker.workers.dev/ws?token=${token}`);

// 3. Authenticate
ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'auth',
    payload: { token }
  }));
};

// 4. Get online apps
ws.send(JSON.stringify({
  type: 'get_apps',
  payload: {}
}));
```

### Go App Setup
```go
// 1. Start setup flow (opens browser)
// Browser navigates to: /setup?callback=http://localhost:8080/setup-callback

// 2. User completes OAuth + registration in browser

// 3. Receive callback with apiKey and appId
// http://localhost:8080/setup-callback?apikey=abc...&appid=uuid

// 4. Connect WebSocket
ws, _, err := websocket.DefaultDialer.Dial(
    "wss://your-worker.workers.dev/ws/app?apiKey="+apiKey, nil)

// 5. Authenticate
ws.WriteJSON(map[string]interface{}{
    "type": "auth",
    "payload": map[string]string{
        "apiKey": apiKey,
    },
})

// 6. Register presence
ws.WriteJSON(map[string]interface{}{
    "type": "app_register",
    "payload": map[string]interface{}{
        "name": "My PC",
        "capabilities": []string{"print", "scrape"},
    },
})
```

### WebRTC Connection (Browser → App)
```javascript
// 1. Create peer connection
const pc = new RTCPeerConnection(config);

// 2. Create data channel
const dc = pc.createDataChannel('data');

// 3. Create and send offer
const offer = await pc.createOffer();
await pc.setLocalDescription(offer);

ws.send(JSON.stringify({
  type: 'offer',
  payload: {
    targetAppId: 'app-uuid',
    sdp: offer.sdp
  },
  requestId: 'req-123'
}));

// 4. Handle ICE candidates
pc.onicecandidate = (event) => {
  if (event.candidate) {
    ws.send(JSON.stringify({
      type: 'ice',
      payload: {
        targetAppId: 'app-uuid',
        candidate: event.candidate
      }
    }));
  }
};

// 5. Receive answer
ws.onmessage = async (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'answer' && msg.requestId === 'req-123') {
    await pc.setRemoteDescription({ type: 'answer', sdp: msg.payload.sdp });
  }
  if (msg.type === 'ice') {
    await pc.addIceCandidate(msg.payload.candidate);
  }
};
```

---

## Security Considerations

1. **JWT Tokens**
   - HTTP-only cookies prevent XSS access
   - Secure flag ensures HTTPS-only transmission
   - 7-day expiration
   - HMAC SHA-256 signing

2. **API Keys**
   - 64-character hex strings (256-bit entropy)
   - Cryptographically random generation
   - Only shown once at creation
   - Validated on every WebSocket message

3. **OAuth State**
   - CSRF protection via state parameter
   - 10-minute expiration
   - Single-use validation

4. **WebSocket Security**
   - Pre-validation of API keys for app connections
   - User isolation (apps only relay to same user's browsers)
   - Connection-level authentication required

5. **Authorization**
   - Users can only manage their own apps
   - WebRTC signaling restricted to user's devices
   - No cross-user communication

---

## Rate Limits

Cloudflare Workers free tier limits:
- 100,000 requests/day
- 1,000 requests/minute per IP

Durable Objects limits:
- WebSocket connections limited by memory
- Recommended: <1,000 concurrent connections per object

---

## Support

For issues and questions, please refer to the project repository or contact the development team.
