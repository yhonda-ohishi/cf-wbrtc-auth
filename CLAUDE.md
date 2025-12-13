# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 手順
- plan.mdにタスクを記載。
- pland-executed.mdに完了したタスクを移行
- それぞれのタスクはsub agentに指示して実装
- context windowが４０％超えたら、実装を中断、commit を作成
- type はwrangler typesで実装、自作しない

## Project Overview

Cloudflare Workers-based print/scraping server using WebRTC P2P for communication between a Windows Go application and browser clients. Cloudflare Workers/Durable Objects serve as the signaling server.

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
│  - Management UI │        │  - Print service                 │
│  - WebRTC Client │        │  - Scraping (chromedp)           │
│  - JWT auth      │        │  - pion/webrtc                   │
└──────────────────┘        └──────────────────────────────────┘
```

## Technology Stack

- **Workers Framework**: Hono (TypeScript)
- **Authentication**: Google OAuth 2.0 + JWT (Cookie-based)
- **Storage**: Cloudflare KV (users, apps, API keys)
- **Realtime**: Hibernatable WebSocket via Durable Objects
- **P2P**: WebRTC DataChannel
- **Go WebRTC**: pion/webrtc
- **Go Scraping**: chromedp

## Planned Directory Structure (Workers)

```
src/
├── index.ts          # Entry point
├── auth/
│   ├── oauth.ts      # Google OAuth
│   └── jwt.ts        # JWT issue/verify
├── setup/
│   └── index.ts      # Go App initial setup flow
├── api/
│   └── apps.ts       # App management API
├── middleware/
│   └── auth.ts       # Auth middleware
└── do/
    └── signaling.ts  # SignalingDO (Durable Object)
```

## KV Key Design

| Key Pattern | Value | Purpose |
|-------------|-------|---------|
| `user:{userId}` | `{ email, name, createdAt }` | User info |
| `user:email:{email}` | `{userId}` | Email lookup |
| `app:{appId}` | `{ userId, name, capabilities, createdAt }` | App info |
| `apikey:{apiKey}` | `{ appId, userId }` | API key lookup |
| `user:{userId}:apps` | `[appId, ...]` | User's app list |

## WebSocket Message Protocol

Messages use format: `{ type: string, payload: any, requestId?: string }`

Key message types:
- **Auth**: `auth`, `auth_ok`, `auth_error`
- **App Management**: `app_register`, `app_registered`, `app_status`
- **Signaling**: `offer`, `answer`, `ice`, `peer_connected`, `peer_disconnected`
- **Jobs**: `job_submit`, `job_assigned`, `job_progress`, `job_complete`, `job_error`

## Development Notes

- This is a greenfield project based on [print-server-plan.md](print-server-plan.md)
- The plan document is in Japanese
- Primary target: Single user, cost-optimized for Cloudflare free tier
- Go App runs as Windows Service with automatic browser-based OAuth setup flow
