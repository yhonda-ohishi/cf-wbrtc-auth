# cf-wbrtc-auth

Cloudflare Workers + Durable Objects を使用したWebRTC P2P通信用シグナリングサーバー。

## 概要

Windows Go アプリケーションとブラウザクライアント間のWebRTC P2P通信を仲介するシグナリングサーバーです。

```
┌─────────────────────────────────────────────────────────────┐
│  Cloudflare Workers (Hono) + Durable Objects               │
│  - 認証 (/auth/*)                                           │
│  - App管理API (/api/apps)                                   │
│  - WebSocketシグナリング (/ws, /ws/app)                      │
└─────────────────────────────────────────────────────────────┘
        │ WebSocket                    │ WebSocket
        ▼                              ▼
┌──────────────────┐        ┌──────────────────────────────────┐
│  ブラウザ         │◀═P2P══▶│  Go App (Windowsサービス)         │
│  - 管理UI        │        │  - 印刷サービス                   │
│  - WebRTCクライアント│     │  - pion/webrtc                   │
└──────────────────┘        └──────────────────────────────────┘
```

## セットアップ

### 1. 依存関係のインストール

```bash
npm install
```

### 2. Google OAuth 設定

[Google Cloud Console](https://console.cloud.google.com/) でOAuthクライアントを作成:

1. APIs & Services > Credentials > Create Credentials > OAuth client ID
2. Application type: Web application
3. Authorized redirect URIs に追加:
   - `https://YOUR_WORKER.workers.dev/auth/callback`
   - `http://localhost:8787/auth/callback` (開発用)

### 3. 環境変数の設定

#### wrangler.toml を編集

```toml
[vars]
GOOGLE_CLIENT_ID = "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com"
```

#### Secrets を設定

```bash
# Google OAuth クライアントシークレット
npx wrangler secret put GOOGLE_CLIENT_SECRET
# プロンプトが表示されたらシークレットを入力

# JWT署名用シークレット (ランダムな文字列を使用)
npx wrangler secret put JWT_SECRET
# 例: openssl rand -hex 32 で生成した値を入力
```

### 4. デプロイ

```bash
npm run deploy
```

デプロイ後のURL: `https://cf-wbrtc-auth.YOUR_SUBDOMAIN.workers.dev`

## 開発

### ローカル開発サーバー

```bash
npm run dev
```

http://localhost:8787 でアクセス可能。

### テスト実行

```bash
# テスト実行
npm test

# ウォッチモード
npm run test:watch

# カバレッジ
npm run test:coverage
```

### 型生成

```bash
npm run cf-typegen
```

## API エンドポイント

詳細は [docs/API.md](docs/API.md) を参照。

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/` | 管理UI |
| GET | `/auth/login` | Google OAuth開始 |
| GET | `/auth/callback` | OAuthコールバック |
| POST | `/auth/logout` | ログアウト |
| GET | `/api/me` | 現在のユーザー情報 |
| GET | `/api/apps` | App一覧取得 |
| POST | `/api/apps` | App登録 |
| DELETE | `/api/apps/:appId` | App削除 |
| POST | `/api/apps/:appId/regenerate` | APIキー再発行 |
| GET | `/ws?token=xxx` | ブラウザ用WebSocket |
| GET | `/ws/app?apiKey=xxx` | Go App用WebSocket |

## Go App 接続

Go App から接続する際は、発行されたAPIキーを使用:

```go
url := "wss://YOUR_WORKER.workers.dev/ws/app?apiKey=YOUR_API_KEY"
conn, _, err := websocket.DefaultDialer.Dial(url, nil)
```

## ファイル構成

```
src/
├── index.ts          # エントリポイント、ルーティング
├── auth/
│   ├── oauth.ts      # Google OAuth
│   └── jwt.ts        # JWT発行・検証
├── middleware/
│   └── auth.ts       # 認証ミドルウェア
├── setup/
│   └── index.ts      # Go App初期設定フロー
├── api/
│   └── apps.ts       # App管理API
├── do/
│   └── signaling.ts  # SignalingDO (Durable Object)
└── client/
    ├── ws-client.ts      # WebSocketクライアント
    ├── webrtc-client.ts  # WebRTCクライアント
    ├── ui.ts             # UI管理
    └── bundle.ts         # 埋め込みバンドル

test/
├── jwt.test.ts       # JWT テスト
├── auth.test.ts      # 認証ミドルウェア テスト
└── apps.test.ts      # App API テスト

docs/
└── API.md            # APIドキュメント
```

## ライセンス

MIT
