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

## ブラウザクライアント (JavaScript/TypeScript)

任意のWebアプリからGo Appに接続できます。

### 基本的な使い方

```html
<script type="module">
import { SignalingClient, WebRTCClient } from 'https://cf-wbrtc-auth.m-tama-ramu.workers.dev/client.js';

// 1. WebSocket接続（認証が必要）
const ws = new SignalingClient('wss://cf-wbrtc-auth.m-tama-ramu.workers.dev/ws');
await ws.connect();

// 認証完了を待つ
ws.onAuthenticated = (payload) => {
  console.log('Authenticated as:', payload.userId);
};

// 2. WebRTCクライアント作成
const rtc = new WebRTCClient(ws);

// メッセージ受信
rtc.onDataChannelMessage = ({ appId, data }) => {
  console.log(`Message from ${appId}:`, data);
};

// 3. Go Appに接続
const dataChannel = await rtc.connectToApp('app-id-here');

// 4. メッセージ送信
rtc.sendMessage('app-id-here', 'Hello from browser!');
</script>
```

### SignalingClient API

```typescript
const ws = new SignalingClient(wsUrl: string, token?: string);

// 接続
await ws.connect();
ws.disconnect();
ws.isConnected(): boolean;

// イベント
ws.onAuthenticated = (payload: { userId: string, type: 'browser' | 'app' }) => {};
ws.onAuthError = (payload: { error: string }) => {};
ws.onAppStatus = (payload: { appId: string, status: 'online' | 'offline' }) => {};
ws.onAppsListReceived = (payload: { apps: AppInfo[] }) => {};
ws.onConnected = () => {};
ws.onDisconnected = () => {};
ws.onError = (payload: { message: string }) => {};

// アプリ一覧取得
ws.getApps();
```

### WebRTCClient API

```typescript
const rtc = new WebRTCClient(signalingClient: SignalingClient, iceServers?: RTCIceServer[]);

// 接続
const dataChannel = await rtc.connectToApp(appId: string);
rtc.disconnect(appId?: string);  // appId省略で全切断

// メッセージ送信
rtc.sendMessage(appId: string, data: string | ArrayBuffer);

// 状態取得
rtc.getConnectionState(appId: string): RTCPeerConnectionState | null;
rtc.getDataChannelState(appId: string): RTCDataChannelState | null;
rtc.getConnectedApps(): string[];

// イベント
rtc.onDataChannelOpen = ({ appId }) => {};
rtc.onDataChannelClose = ({ appId }) => {};
rtc.onDataChannelMessage = ({ appId, data }) => {};
rtc.onConnectionStateChange = ({ appId, state }) => {};
rtc.onError = ({ appId, message }) => {};
```

### 認証について

ブラウザクライアントは以下のいずれかで認証します：

1. **Cookieベース（推奨）**: `/auth/login` でOAuth後、Cookieが自動送信される
2. **トークンベース**: JWTトークンを `SignalingClient` に渡す

```javascript
// Cookieベース（同一ドメインから）
const ws = new SignalingClient('wss://cf-wbrtc-auth.m-tama-ramu.workers.dev/ws');

// トークンベース（クロスオリジン）
const ws = new SignalingClient('wss://cf-wbrtc-auth.m-tama-ramu.workers.dev/ws', jwtToken);
```

## gRPC-Web over DataChannel

WebRTC DataChannel上でgRPC-Webスタイルの通信を行うトランスポートライブラリ。

### インストール

```bash
# Go (サーバー側)
go get github.com/anthropics/cf-wbrtc-auth/go/grpcweb

# TypeScript (クライアント側) - プロジェクトに含まれています
import { DataChannelTransport, ReflectionClient } from './grpc';
```

### Go サーバー例

```go
import "github.com/anthropics/cf-wbrtc-auth/go/grpcweb"

// DataChannel からトランスポート作成
transport := grpcweb.NewTransport(dataChannel, nil)

// Server Reflection を有効化（推奨）
grpcweb.RegisterReflection(transport)

// ハンドラ登録
handler := grpcweb.MakeHandler(
    func(data []byte) (*MyRequest, error) {
        var req MyRequest
        return &req, json.Unmarshal(data, &req)
    },
    func(resp *MyResponse) ([]byte, error) {
        return json.Marshal(resp)
    },
    func(ctx context.Context, req *MyRequest) (*MyResponse, error) {
        return &MyResponse{Result: "OK"}, nil
    },
)
transport.RegisterHandler("/mypackage.MyService/MyMethod", handler)

// 開始
transport.Start()
```

### TypeScript クライアント例

```typescript
import { DataChannelTransport, ReflectionClient, GrpcError } from './grpc';

// トランスポート作成
const transport = new DataChannelTransport(dataChannel);

// RPC呼び出し
try {
  const response = await transport.unary(
    '/mypackage.MyService/MyMethod',
    { data: 'test' },
    (msg) => new TextEncoder().encode(JSON.stringify(msg)),
    (data) => JSON.parse(new TextDecoder().decode(data))
  );
  console.log(response.message);
} catch (error) {
  if (error instanceof GrpcError) {
    console.log(`gRPC Error ${error.code}: ${error.message}`);
  }
}

// Server Reflection でサービス一覧取得
const reflection = new ReflectionClient(transport);
const services = await reflection.listServices();
for (const svc of services.services) {
  console.log(`Service: ${svc.name}, Methods: ${svc.methods.join(', ')}`);
}
```

### gRPC エラーコード

| コード | 名前 | 説明 |
|--------|------|------|
| 0 | OK | 成功 |
| 3 | INVALID_ARGUMENT | 無効な引数 |
| 5 | NOT_FOUND | リソースなし |
| 7 | PERMISSION_DENIED | 権限なし |
| 12 | UNIMPLEMENTED | 未実装 |
| 13 | INTERNAL | 内部エラー |
| 16 | UNAUTHENTICATED | 未認証 |

詳細は [examples/](examples/) を参照。

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
├── client/
│   ├── ws-client.ts      # WebSocketクライアント
│   ├── webrtc-client.ts  # WebRTCクライアント
│   ├── ui.ts             # UI管理
│   └── bundle.ts         # 埋め込みバンドル
└── grpc/                 # gRPC-Web over DataChannel
    ├── codec/
    │   ├── frame.ts      # フレームコーデック
    │   └── envelope.ts   # リクエスト/レスポンスエンコード
    ├── transport/
    │   └── datachannel-transport.ts  # DataChannelトランスポート
    ├── reflection/
    │   └── reflection.ts  # Server Reflectionクライアント
    └── index.ts          # 公開API

go/
├── client/           # Go WebRTC クライアント
│   ├── client.go     # シグナリングクライアント
│   ├── webrtc.go     # WebRTC接続
│   └── setup.go      # OAuth セットアップ
└── grpcweb/          # gRPC-Web ライブラリ
    ├── codec/        # フレーム/エンベロープコーデック
    ├── transport/    # DataChannelトランスポート
    ├── reflection/   # Server Reflection
    └── grpcweb.go    # 公開API

examples/
├── go/server.go          # Go サーバー例
├── typescript/client.ts  # TypeScript クライアント例
└── README.md

test/
├── jwt.test.ts       # JWT テスト
├── auth.test.ts      # 認証ミドルウェア テスト
├── apps.test.ts      # App API テスト
└── reflection.test.ts # Reflection テスト

docs/
└── API.md            # APIドキュメント
```

## ライセンス

MIT
