# Setup API Documentation

This document describes the polling-based setup API for registering Go applications with the WebRTC signaling server.

## Overview

The setup flow allows a Go application running as a Windows service to register itself with the server and obtain API credentials through a browser-based OAuth flow, without requiring a callback URL.

## Flow Diagram

```
┌─────────────┐                                      ┌─────────────┐
│  Go App     │                                      │   Browser   │
└──────┬──────┘                                      └──────┬──────┘
       │                                                    │
       │ 1. POST /setup/init                               │
       ├──────────────────────────────────────────────────▶│
       │ ◀── { token, url }                                │
       │                                                    │
       │ 2. Open browser with url                          │
       ├──────────────────────────────────────────────────▶│
       │                                                    │
       │ 3. Poll /setup/poll?token=xxx                     │
       │    (every 2-3 seconds)                            │
       ├──────────────────────────────────────────────────▶│
       │ ◀── { status: "pending" }                         │
       │                                                    │
       │                                                    │ 4. User authenticates
       │                                                    │    with Google OAuth
       │                                                    ├───────────▶ Google
       │                                                    │ ◀─────────
       │                                                    │
       │                                                    │ 5. User fills app
       │                                                    │    registration form
       │                                                    │
       │ 6. Poll /setup/poll?token=xxx                     │
       ├──────────────────────────────────────────────────▶│
       │ ◀── { status: "complete", apiKey, appId }         │
       │                                                    │
       │ 7. Save credentials and connect                   │
       │                                                    │
```

## API Endpoints

### 1. POST /setup/init

Initialize a new setup session.

**Request:**
```http
POST /setup/init
```

**Response:**
```json
{
  "token": "550e8400-e29b-41d4-a716-446655440000",
  "url": "https://your-worker.workers.dev/setup/550e8400-e29b-41d4-a716-446655440000"
}
```

**Details:**
- Generates a unique setup token (UUID)
- Token expires after 5 minutes
- URL should be opened in the user's browser

### 2. GET /setup/:token

Browser endpoint - validates token and redirects to OAuth.

**Request:**
```http
GET /setup/550e8400-e29b-41d4-a716-446655440000
```

**Response:**
- 302 Redirect to Google OAuth
- Sets `setup_token` cookie for session tracking

**Errors:**
- 404: Token not found or expired

### 3. GET /setup/:token/complete

Shows the app registration form after successful OAuth.

**Request:**
```http
GET /setup/550e8400-e29b-41d4-a716-446655440000/complete
Cookie: token=<jwt_token>; setup_token=<setup_token>
```

**Response:**
- HTML form for app registration

**Errors:**
- 401: Not authenticated (missing or invalid JWT)
- 404: Setup token not found or expired

### 4. POST /setup/:token/register

Handles app registration form submission.

**Request:**
```http
POST /setup/550e8400-e29b-41d4-a716-446655440000/register
Cookie: token=<jwt_token>; setup_token=<setup_token>
Content-Type: application/x-www-form-urlencoded

name=My+PC&capabilities=print&capabilities=scrape
```

**Response:**
- HTML page showing "Setup Complete" message

**Side Effects:**
- Creates app in KV: `app:{appId}`
- Creates API key mapping: `apikey:{apiKey}`
- Updates user's app list: `user:{userId}:apps`
- Updates setup status to "complete" in KV

**Errors:**
- 401: Not authenticated
- 404: Setup token not found or expired
- 400: Missing required field (name)

### 5. GET /setup/poll

Poll for setup completion status (used by Go app).

**Request:**
```http
GET /setup/poll?token=550e8400-e29b-41d4-a716-446655440000
```

**Response (pending):**
```json
{
  "status": "pending"
}
```

**Response (complete):**
```json
{
  "status": "complete",
  "apiKey": "a1b2c3d4e5f6...",
  "appId": "660e8400-e29b-41d4-a716-446655440001"
}
```

**Errors:**
- 400: Missing token parameter
- 404: Token not found or expired

## Go App Implementation Example

```go
package main

import (
    "encoding/json"
    "fmt"
    "net/http"
    "os/exec"
    "time"
)

type SetupInitResponse struct {
    Token string `json:"token"`
    URL   string `json:"url"`
}

type SetupPollResponse struct {
    Status string `json:"status"`
    APIKey string `json:"apiKey,omitempty"`
    AppID  string `json:"appId,omitempty"`
}

func SetupApp(serverURL string) (apiKey, appID string, err error) {
    // 1. Initialize setup
    resp, err := http.Post(serverURL+"/setup/init", "", nil)
    if err != nil {
        return "", "", err
    }
    defer resp.Body.Close()

    var initResp SetupInitResponse
    if err := json.NewDecoder(resp.Body).Decode(&initResp); err != nil {
        return "", "", err
    }

    // 2. Open browser
    fmt.Printf("Please complete setup in your browser: %s\n", initResp.URL)
    exec.Command("cmd", "/c", "start", initResp.URL).Run()

    // 3. Poll for completion
    timeout := time.After(5 * time.Minute)
    ticker := time.NewTicker(2 * time.Second)
    defer ticker.Stop()

    for {
        select {
        case <-timeout:
            return "", "", fmt.Errorf("setup timed out")
        case <-ticker.C:
            pollResp, err := http.Get(fmt.Sprintf("%s/setup/poll?token=%s", serverURL, initResp.Token))
            if err != nil {
                continue
            }

            var pollData SetupPollResponse
            if err := json.NewDecoder(pollResp.Body).Decode(&pollData); err != nil {
                pollResp.Body.Close()
                continue
            }
            pollResp.Body.Close()

            if pollData.Status == "complete" {
                return pollData.APIKey, pollData.AppID, nil
            }
        }
    }
}
```

## KV Storage Schema

### Setup Token
```
Key: setup:{token}
Value: {
  status: "pending" | "complete",
  expiresAt: number,
  apiKey?: string,    // Only present when status is "complete"
  appId?: string      // Only present when status is "complete"
}
TTL: 300 seconds (5 minutes)
```

## Security Considerations

1. **Token Expiration**: Setup tokens expire after 5 minutes to prevent abuse
2. **Single Use**: Once a token is used to register an app, it should not be reused
3. **HTTPS Only**: In production, cookies should use `secure` flag
4. **Rate Limiting**: Consider adding rate limiting to `/setup/init` endpoint
5. **Token Format**: UUIDs are used to prevent enumeration attacks

## Error Handling

The Go app should handle the following error scenarios:

1. **Network errors**: Retry polling with exponential backoff
2. **Timeout**: User took too long to complete setup (>5 minutes)
3. **User cancellation**: User closed browser without completing setup
4. **Invalid credentials**: Server returned error during polling

## Testing

Comprehensive tests are available in `test/setup.test.ts`:

```bash
npm test -- setup.test.ts
```

Tests cover:
- Token generation and validation
- OAuth redirect flow
- Form submission and app registration
- Polling mechanism
- Security scenarios (expired tokens, invalid auth)
- End-to-end setup flow
