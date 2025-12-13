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

デプロイ後のURL: `https://cf-wbrtc-auth.m-tama-ramu.workers.dev`

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

## Go クライアント

### インストール

```bash
go get github.com/anthropics/cf-wbrtc-auth/go/client
```

### 初期セットアップ (OAuth)

初回のみ、ブラウザでOAuth認証を行いAPIキーを取得:

```go
package main

import (
    "context"
    "log"
    "time"

    client "github.com/anthropics/cf-wbrtc-auth/go/client"
)

func main() {
    setupConfig := client.SetupConfig{
        ServerURL:    "https://cf-wbrtc-auth.m-tama-ramu.workers.dev",
        PollInterval: 2 * time.Second,
        Timeout:      5 * time.Minute,
    }

    result, err := client.Setup(context.Background(), setupConfig)
    if err != nil {
        log.Fatalf("Setup failed: %v", err)
    }

    // 認証情報をファイルに保存
    if err := client.SaveCredentials("credentials.env", result); err != nil {
        log.Fatalf("Failed to save credentials: %v", err)
    }

    log.Printf("Setup complete! API Key: %s", result.APIKey)
}
```

### WebSocket + WebRTC クライアント

```go
package main

import (
    "context"
    "encoding/json"
    "log"
    "os"
    "os/signal"
    "syscall"

    client "github.com/anthropics/cf-wbrtc-auth/go/client"
)

// AppHandler は EventHandler と DataChannelHandler を実装
type AppHandler struct {
    signalingClient *client.SignalingClient
    peerConnection  *client.PeerConnection
}

// シグナリングイベント
func (h *AppHandler) OnAuthenticated(payload client.AuthOKPayload) {
    log.Printf("Authenticated as %s", payload.UserID)
}

func (h *AppHandler) OnAuthError(payload client.AuthErrorPayload) {
    log.Printf("Auth error: %s", payload.Error)
}

func (h *AppHandler) OnAppRegistered(payload client.AppRegisteredPayload) {
    log.Printf("App registered: %s", payload.AppID)
}

func (h *AppHandler) OnOffer(sdp string, requestID string) {
    // ブラウザからのWebRTC offer を処理
    if h.peerConnection == nil {
        pc, err := client.NewPeerConnection(client.PeerConfig{
            SignalingClient: h.signalingClient,
            Handler:         h,
        })
        if err != nil {
            log.Printf("Failed to create peer connection: %v", err)
            return
        }
        h.peerConnection = pc
    }
    h.peerConnection.HandleOffer(sdp, requestID)
}

func (h *AppHandler) OnAnswer(sdp string, appID string) {}

func (h *AppHandler) OnICE(candidate json.RawMessage) {
    if h.peerConnection != nil {
        h.peerConnection.AddICECandidate(candidate)
    }
}

func (h *AppHandler) OnError(message string)  { log.Printf("Error: %s", message) }
func (h *AppHandler) OnConnected()            { log.Println("Connected") }
func (h *AppHandler) OnDisconnected()         { log.Println("Disconnected") }

// DataChannel イベント
func (h *AppHandler) OnMessage(data []byte) {
    log.Printf("Received: %s", string(data))
    // エコーバック
    h.peerConnection.SendText("Echo: " + string(data))
}

func (h *AppHandler) OnOpen()  { log.Println("DataChannel opened") }
func (h *AppHandler) OnClose() { log.Println("DataChannel closed") }

func main() {
    handler := &AppHandler{}

    config := client.ClientConfig{
        ServerURL:    "wss://cf-wbrtc-auth.m-tama-ramu.workers.dev/ws/app",
        APIKey:       os.Getenv("API_KEY"),
        AppName:      "MyPrintService",
        Capabilities: []string{"print", "scrape"},
        Handler:      handler,
    }

    signalingClient := client.NewSignalingClient(config)
    handler.signalingClient = signalingClient

    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    if err := signalingClient.Connect(ctx); err != nil {
        log.Fatalf("Failed to connect: %v", err)
    }
    defer signalingClient.Close()

    // シグナル待機
    sigChan := make(chan os.Signal, 1)
    signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
    <-sigChan
}
```

### E2Eテスト実行

```bash
# WebRTC ローカルテスト（サーバー不要）
E2E_TEST=1 go test -v ./go/client -run TestE2EWebRTC

# WebSocket テスト（サーバー必要）
E2E_TEST=1 E2E_API_KEY=your-key go test -v ./go/client -run E2E
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
