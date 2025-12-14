# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 手順
- plan.mdにタスクを記載
- plan-executed.mdに完了したタスクを移行
- それぞれのタスクはsub agentに指示して実装
- context windowが40%超えたら、実装を中断、commit を作成
- type はwrangler typesで実装、自作しない

## Project Overview

Cloudflare Workers-based WebRTC P2P signaling server for communication between Windows Go applications and browser clients. Includes gRPC-Web over DataChannel transport library.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Cloudflare Workers (Hono) + Durable Objects               │
│  - Authentication endpoints (/auth/*)                       │
│  - App management API (/api/apps)                           │
│  - WebSocket signaling (/ws, /ws/app)                       │
│  - SignalingDO: Hibernatable WebSocket, SDP/ICE exchange   │
└─────────────────────────────────────────────────────────────┘
        │ WebSocket                    │ WebSocket
        ▼                              ▼
┌──────────────────┐        ┌──────────────────────────────────┐
│  Browser         │◀═P2P══▶│  Go App (Windows Service)        │
│  - Management UI │  gRPC  │  - gRPC-Web server               │
│  - WebRTC Client │  -Web  │  - Server Reflection             │
│  - JWT auth      │        │  - pion/webrtc                   │
└──────────────────┘        └──────────────────────────────────┘
```

## Technology Stack

- **Workers Framework**: Hono (TypeScript)
- **Authentication**: Google OAuth 2.0 + JWT (Cookie-based)
- **Storage**: Cloudflare KV (users, apps, API keys)
- **Realtime**: Hibernatable WebSocket via Durable Objects
- **P2P**: WebRTC DataChannel + gRPC-Web transport
- **Go WebRTC**: pion/webrtc
- **Go gRPC**: Custom gRPC-Web over DataChannel

## Server URL

- Local: `http://localhost:8787`
- Production: `https://cf-wbrtc-auth.m-tama-ramu.workers.dev`

## Directory Structure

```
src/
├── index.ts              # Entry point, routing, embedded UI
├── auth/
│   ├── oauth.ts          # Google OAuth
│   └── jwt.ts            # JWT issue/verify
├── setup/
│   └── index.ts          # Go App polling-based setup flow
├── api/
│   └── apps.ts           # App management API
├── middleware/
│   └── auth.ts           # Auth middleware
├── do/
│   └── signaling.ts      # SignalingDO (Hibernatable WebSocket)
├── client/
│   ├── ws-client.ts      # Browser WebSocket client
│   ├── webrtc-client.ts  # Browser WebRTC client
│   ├── ui.ts             # Management UI manager
│   ├── reflection-ui.ts  # gRPC Reflection test UI
│   ├── bundle.ts         # Embedded client bundle
│   └── index.ts          # Client exports
└── grpc/
    ├── codec/
    │   ├── frame.ts      # gRPC-Web frame codec
    │   └── envelope.ts   # Request/response envelope
    ├── transport/
    │   └── datachannel-transport.ts  # DataChannel transport
    ├── reflection/
    │   └── reflection.ts # Server Reflection client
    └── index.ts          # Public API

go/
├── client/               # Go WebRTC signaling client
│   ├── client.go         # SignalingClient
│   ├── webrtc.go         # PeerConnection
│   ├── setup.go          # OAuth polling setup
│   ├── messages.go       # Message types
│   └── cmd/testclient/   # Test client executable
└── grpcweb/              # gRPC-Web over DataChannel library
    ├── codec/
    │   ├── frame.go      # Frame codec
    │   └── envelope.go   # Envelope codec
    ├── transport/
    │   └── datachannel.go # DataChannel transport (server)
    ├── reflection/
    │   └── reflection.go # Server Reflection
    └── grpcweb.go        # Public API

examples/
├── go/server.go          # Go gRPC server example
├── typescript/client.ts  # TypeScript client example
└── README.md

test/
├── jwt.test.ts           # JWT tests
├── auth.test.ts          # Auth middleware tests
├── apps.test.ts          # App API tests
├── setup.test.ts         # Setup API tests
└── reflection.test.ts    # Reflection tests

docs/
├── API.md                # REST API documentation
└── setup-api.md          # Setup API documentation
```

## KV Key Design

| Key Pattern | Value | Purpose |
|-------------|-------|---------|
| `user:{userId}` | `{ email, name, createdAt }` | User info |
| `user:email:{email}` | `{userId}` | Email lookup |
| `app:{appId}` | `{ userId, name, capabilities, createdAt }` | App info |
| `apikey:{apiKey}` | `{ appId, userId }` | API key lookup |
| `user:{userId}:apps` | `[appId, ...]` | User's app list |
| `setup:{token}` | `{ status, apiKey?, ... }` | Setup session (5min TTL) |

## WebSocket Message Protocol

Messages use format: `{ type: string, payload: any, requestId?: string }`

Key message types:
- **Auth**: `auth`, `auth_ok`, `auth_error`
- **App Management**: `app_register`, `app_registered`, `app_status`
- **Signaling**: `offer`, `answer`, `ice`, `peer_connected`, `peer_disconnected`

## Development Commands

```bash
# Install dependencies
npm install

# Local development
npm run dev

# Deploy to Cloudflare
npm run deploy

# Run tests
npm test

# Generate types
npm run cf-typegen

# Go tests
cd go/client && go test -v ./...
cd go/grpcweb && go test -v ./...

# E2E tests
E2E_TEST=1 go test -v ./go/client -run TestE2EWebRTC
```

## Completed Phases

- **Phase 1**: Foundation (Workers, KV, OAuth, JWT)
- **Phase 2**: App management API
- **Phase 3**: SignalingDO (Hibernatable WebSocket)
- **Phase 4**: Browser clients (WebSocket, WebRTC, UI)
- **Phase 5**: Tests and documentation
- **Phase 6**: Polling-based setup for Go App OAuth
- **Phase 7**: E2E tests (WebSocket, WebRTC P2P)
- **Phase 8**: gRPC-Web transport over DataChannel
  - 8.1-8.4: Codec and transport implementation
  - 8.5-8.6: Server Reflection support
  - 8.7: Reflection test page

## Key Implementation Notes

- SignalingDO uses Hibernatable WebSocket for cost optimization
- Go App authenticates via API key, browser via JWT cookie
- gRPC-Web transport enables RPC over WebRTC DataChannel
- Server Reflection allows dynamic service discovery
