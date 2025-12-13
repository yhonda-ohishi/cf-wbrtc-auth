# Cloudflare Workers 印刷・スクレイピングサーバー計画書

## 概要

Windows PC 上の Go アプリケーションと、ブラウザを WebRTC P2P で接続し、印刷・スクレイピング機能を提供するシステム。Cloudflare Workers / Durable Objects をシグナリングサーバーとして使用。

## システム構成図

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Cloudflare                                                             │
│                                                                         │
│  ┌─────────────────────┐       ┌─────────────────────────────────────┐ │
│  │  Workers (Hono)     │       │  Durable Objects                    │ │
│  │                     │       │                                     │ │
│  │  /auth/login        │       │  SignalingDO                        │ │
│  │  /auth/callback     │──────▶│  - Hibernatable WebSocket           │ │
│  │  /ws                │       │  - 接続管理                         │ │
│  │  /api/*             │       │  - シグナリング (SDP/ICE)           │ │
│  │  /* (静的)          │       │  - ジョブキュー                     │ │
│  └─────────────────────┘       └─────────────────────────────────────┘ │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
          │ WebSocket                              │ WebSocket
          ▼                                        ▼
┌──────────────────────┐                ┌──────────────────────────────────┐
│  ブラウザ             │                │  Go App (Windows Service)        │
│                      │                │                                  │
│  - 管理 UI           │                │  - 印刷サービス                   │
│  - WebRTC Client     │◀═══ P2P ══════▶│  - スクレイピング (chromedp)     │
│  - JWT 保持          │   DataChannel  │  - WebRTC Server                 │
└──────────────────────┘                └──────────────────────────────────┘
```

## 技術選定

| コンポーネント | 技術 | 理由 |
|---------------|------|------|
| Workers フレームワーク | Hono | 軽量、TypeScript 対応 |
| 認証 | Google OAuth 2.0 | 一般公開サービス対応 |
| セッション | JWT (Cookie) | ステートレス |
| 永続ストレージ | Cloudflare KV | APIキー・ユーザー管理 |
| リアルタイム通信 | Hibernatable WebSocket | コスト最適化 |
| P2P | WebRTC DataChannel | 低レイテンシ、大容量転送 |
| Go WebRTC | pion/webrtc | 実績あり |

---

## KV ストレージ設計

### 役割分担

```
┌─────────────────────────────────────────────────────┐
│  KV（永続データ）                                    │
│  - ユーザー情報                                      │
│  - App 登録情報                                     │
│  - APIキー（App ごとに発行）                         │
└─────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────┐
│  DO（リアルタイム状態）                              │
│  - WebSocket 接続管理                               │
│  - オンライン状態                                   │
│  - シグナリング                                     │
└─────────────────────────────────────────────────────┘
```

### KV キー設計

| キー | 値 | 用途 |
|------|-----|------|
| `user:{userId}` | `{ email, name, createdAt }` | ユーザー情報 |
| `user:email:{email}` | `{userId}` | Email → ID 逆引き |
| `app:{appId}` | `{ userId, name, capabilities, createdAt }` | App 情報 |
| `apikey:{apiKey}` | `{ appId, userId }` | APIキー → App 逆引き |
| `user:{userId}:apps` | `[appId, appId, ...]` | ユーザーの App 一覧 |

### APIキー発行フロー

```
┌─────────────────────────────────────────────────────────────────────┐
│  1. ブラウザで管理画面                                               │
│     POST /api/apps { name: "自宅PC", capabilities: ["print"] }     │
│                                                                     │
│  2. Workers で処理                                                  │
│     - appId 生成 (UUID)                                            │
│     - apiKey 生成 (ランダム文字列)                                  │
│     - KV に保存:                                                   │
│       app:{appId} → { userId, name, ... }                          │
│       apikey:{apiKey} → { appId, userId }                          │
│       user:{userId}:apps に appId 追加                              │
│                                                                     │
│  3. APIキーを表示（1回のみ、再表示不可）                             │
│                                                                     │
│  4. Go App の config.json に設定                                    │
└─────────────────────────────────────────────────────────────────────┘
```

### APIキー検証（高速）

```
Go App ──WSS──▶ Workers
                   │
                   ▼
            ┌──────────────────┐
            │ KV.get(apikey:x) │ ← DO 起動不要！
            └──────────────────┘
                   │
              有効 │ 無効 → 401
                   ▼
            ┌──────────────────┐
            │ DO に転送         │
            └──────────────────┘
```

### 環境設定

```toml
# wrangler.toml
[[kv_namespaces]]
binding = "KV"
id = "xxxxx"
```

---

## Cloudflare Workers 設計

### エンドポイント一覧

| パス | メソッド | 認証 | 説明 |
|------|----------|------|------|
| `/auth/login` | GET | 不要 | Google OAuth 開始 |
| `/auth/callback` | GET | 不要 | OAuth コールバック、JWT 発行 |
| `/auth/logout` | POST | 必要 | ログアウト |
| `/setup` | GET | 不要 | Go App 初期設定開始 |
| `/setup/complete` | GET | JWT | App 登録画面（OAuth 後） |
| `/ws` | WebSocket | 必要 | DO へ転送（ブラウザ用） |
| `/ws/app` | WebSocket | APIキー | DO へ転送（Go App 用） |
| `/api/me` | GET | 必要 | ユーザー情報取得 |
| `/api/apps` | GET | 必要 | 登録済み App 一覧 |
| `/api/apps` | POST | 必要 | App 登録、APIキー発行 |
| `/api/apps/:appId` | DELETE | 必要 | App 削除、APIキー無効化 |
| `/api/apps/:appId/regenerate` | POST | 必要 | APIキー再発行 |
| `/*` | GET | 不要 | 静的ファイル配信 |

### 環境変数

```toml
# wrangler.toml
[vars]
GOOGLE_CLIENT_ID = "xxx.apps.googleusercontent.com"

[[secrets]]
# wrangler secret put で設定
# GOOGLE_CLIENT_SECRET
# JWT_SECRET
```

### Workers コード構成

```
src/
├── index.ts          # エントリーポイント
├── auth/
│   ├── oauth.ts      # Google OAuth 処理
│   └── jwt.ts        # JWT 発行・検証
├── setup/
│   └── index.ts      # Go App 初期設定フロー
├── api/
│   └── apps.ts       # App 管理 API
├── middleware/
│   └── auth.ts       # 認証ミドルウェア
└── do/
    └── signaling.ts  # Durable Object
```

---

## Durable Objects 設計

### SignalingDO

ユーザーごとに 1 インスタンス。接続中のクライアントのリアルタイム状態を管理。

```typescript
interface DOState {
  // 接続中のクライアント（リアルタイム状態のみ）
  connections: Map<string, {
    type: 'browser' | 'app'
    ws: WebSocket
    appId?: string      // app の場合のみ
    appName?: string
    connectedAt: number
  }>
  
  // ペンディングジョブ（P2Pフォールバック用）
  jobs: Map<string, {
    id: string
    type: 'print' | 'scrape'
    targetAppId: string
    payload: any
    status: 'pending' | 'processing' | 'done' | 'error'
    createdAt: number
  }>
}

// App 情報は KV から取得
// await env.KV.get(`app:${appId}`)
```

### WebSocket メッセージプロトコル

#### 共通フォーマット

```typescript
interface WSMessage {
  type: string
  payload: any
  requestId?: string  // リクエスト-レスポンス対応用
}
```

#### メッセージ種別

**認証・接続**

| type | 方向 | payload | 説明 |
|------|------|---------|------|
| `auth` | Client→DO | `{ token: string }` or `{ apiKey: string }` | 認証 |
| `auth_ok` | DO→Client | `{ userId: string, type: 'browser'\|'app' }` | 認証成功 |
| `auth_error` | DO→Client | `{ error: string }` | 認証失敗 |

**App 管理（Go App 用）**

| type | 方向 | payload | 説明 |
|------|------|---------|------|
| `app_register` | App→DO | `{ name, capabilities }` | App 登録 |
| `app_registered` | DO→App | `{ appId }` | 登録完了 |
| `app_status` | DO→Browser | `{ apps: [...] }` | App 一覧更新 |

**シグナリング（WebRTC）**

| type | 方向 | payload | 説明 |
|------|------|---------|------|
| `offer` | Browser→DO→App | `{ targetAppId, sdp }` | SDP Offer |
| `answer` | App→DO→Browser | `{ sdp }` | SDP Answer |
| `ice` | 双方向 | `{ candidate }` | ICE Candidate |
| `peer_connected` | App→DO→Browser | `{}` | P2P 確立完了 |
| `peer_disconnected` | 双方向 | `{}` | P2P 切断 |

**ジョブ（フォールバック用）**

| type | 方向 | payload | 説明 |
|------|------|---------|------|
| `job_submit` | Browser→DO | `{ type, targetAppId, data }` | ジョブ投入 |
| `job_assigned` | DO→App | `{ jobId, type, data }` | ジョブ割当 |
| `job_progress` | App→DO→Browser | `{ jobId, progress }` | 進捗 |
| `job_complete` | App→DO→Browser | `{ jobId, result }` | 完了 |
| `job_error` | App→DO→Browser | `{ jobId, error }` | エラー |

---

## Go App 共通パッケージ設計

### 構成

```
┌─────────────────────────────────────────────────────────────────────┐
│  共通パッケージ (go-cf-client)                                       │
│                                                                     │
│  ├── setup/         # 初期設定（Google OAuth via ブラウザ）          │
│  ├── auth/          # APIキー認証                                   │
│  ├── ws/            # WebSocket 接続・再接続                        │
│  ├── webrtc/        # P2P 接続                                     │
│  └── service/       # Windows Service 化                           │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│  印刷 App   │  │ スクレイプ  │  │  他の App   │
│             │  │   App       │  │             │
│  - PDF生成  │  │  - chromedp │  │  - 〇〇機能 │
│  - 印刷実行 │  │             │  │             │
└─────────────┘  └─────────────┘  └─────────────┘
```

### 初期設定フロー（Google OAuth via ブラウザ）

```
┌─────────────────────────────────────────────────────────────────────┐
│  1. Go App 初回起動（config.json なし or APIキーなし）               │
│                                                                     │
│  2. ローカル HTTP サーバー起動 (localhost:9999)                      │
│                                                                     │
│  3. ブラウザ自動オープン                                            │
│     → https://example.com/setup?callback=http://localhost:9999      │
│                                                                     │
│  4. Cloudflare Workers で Google OAuth                              │
│                                                                     │
│  5. ログイン成功 → App 登録画面表示                                  │
│     - App 名入力（例：「自宅PC」）                                   │
│     - 機能選択（print / scrape）                                    │
│                                                                     │
│  6. APIキー発行 → localhost:9999/callback?apikey=xxx に返却         │
│                                                                     │
│  7. Go App がAPIキー受け取り → config.json に保存                   │
│                                                                     │
│  8. ローカルサーバー終了 → 通常モードで WebSocket 接続               │
└─────────────────────────────────────────────────────────────────────┘
```

### シーケンス図

```
Go App              Browser              Cloudflare Workers
  │                    │                     │
  │ 起動（APIキーなし）  │                     │
  │                    │                     │
  │ localhost:9999     │                     │
  │ サーバー起動        │                     │
  │                    │                     │
  │ ブラウザ自動オープン │                     │
  │───────────────────▶│                     │
  │                    │                     │
  │                    │ GET /setup?callback │
  │                    │────────────────────▶│
  │                    │                     │
  │                    │ → Google OAuth      │
  │                    │◀───────────────────▶│
  │                    │                     │
  │                    │ App登録画面          │
  │                    │◀────────────────────│
  │                    │                     │
  │                    │ POST /api/apps      │
  │                    │ {name, capabilities}│
  │                    │────────────────────▶│
  │                    │                     │
  │                    │                     │ APIキー生成
  │                    │                     │ KV に保存
  │                    │                     │
  │                    │ 302 Redirect        │
  │                    │ localhost:9999/     │
  │                    │ callback?apikey=xxx │
  │                    │◀────────────────────│
  │                    │                     │
  │ GET /callback      │                     │
  │◀───────────────────│                     │
  │                    │                     │
  │ APIキー保存        │                     │
  │ config.json        │                     │
  │                    │                     │
  │ 「設定完了」表示    │                     │
  │───────────────────▶│                     │
  │                    │                     │
  │ WSS 接続開始       │                     │
  │─────────────────────────────────────────▶│
```

### Cloudflare Workers エンドポイント（セットアップ用追加）

| パス | メソッド | 説明 |
|------|----------|------|
| `/setup` | GET | セットアップ開始（callback URL を session に保持） |
| `/setup/complete` | GET | OAuth 後の App 登録画面表示 |
| `/api/apps` | POST | App 登録、APIキー発行、callback にリダイレクト |

### Go App 初期設定コード

```go
// setup/setup.go
package setup

import (
    "context"
    "fmt"
    "net/http"
    "os/exec"
    "runtime"
    "time"
)

type SetupResult struct {
    APIKey string
    AppID  string
}

func RunSetup(serverURL string) (*SetupResult, error) {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    resultCh := make(chan *SetupResult)
    errCh := make(chan error)

    // ローカルサーバー起動
    mux := http.NewServeMux()
    server := &http.Server{Addr: ":9999", Handler: mux}
    
    mux.HandleFunc("/callback", func(w http.ResponseWriter, r *http.Request) {
        apiKey := r.URL.Query().Get("apikey")
        appID := r.URL.Query().Get("appid")
        
        if apiKey == "" {
            errCh <- fmt.Errorf("no apikey received")
            return
        }
        
        // 成功画面表示
        w.Header().Set("Content-Type", "text/html; charset=utf-8")
        w.Write([]byte(`
            <html>
            <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                <h1>✅ セットアップ完了</h1>
                <p>このウィンドウを閉じてください</p>
                <p>アプリケーションが自動的に接続を開始します</p>
            </body>
            </html>
        `))
        
        resultCh <- &SetupResult{APIKey: apiKey, AppID: appID}
    })

    go server.ListenAndServe()
    defer server.Shutdown(ctx)

    // ブラウザオープン
    setupURL := fmt.Sprintf("%s/setup?callback=http://localhost:9999/callback", serverURL)
    openBrowser(setupURL)

    fmt.Println("ブラウザでログインしてください...")

    // 結果待ち（タイムアウト 5分）
    select {
    case result := <-resultCh:
        return result, nil
    case err := <-errCh:
        return nil, err
    case <-time.After(5 * time.Minute):
        return nil, fmt.Errorf("setup timeout")
    }
}

func openBrowser(url string) {
    switch runtime.GOOS {
    case "windows":
        exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
    case "darwin":
        exec.Command("open", url).Start()
    default:
        exec.Command("xdg-open", url).Start()
    }
}
```

### Go App メイン処理（初期設定対応）

```go
// main.go
package main

import (
    "encoding/json"
    "fmt"
    "os"
    
    "github.com/yourname/go-cf-client"
    "github.com/yourname/go-cf-client/setup"
)

const serverURL = "https://example.com"

type Config struct {
    ServerURL string `json:"server_url"`
    APIKey    string `json:"api_key"`
    AppID     string `json:"app_id"`
}

func main() {
    config := loadOrSetupConfig()
    
    client := cfclient.New(&cfclient.Config{
        ServerURL: config.ServerURL,
        APIKey:    config.APIKey,
    })

    // アプリ固有のハンドラ登録
    client.OnMessage("print", handlePrint)

    client.Run()
}

func loadOrSetupConfig() *Config {
    // 既存設定読み込み
    if data, err := os.ReadFile("config.json"); err == nil {
        var config Config
        json.Unmarshal(data, &config)
        if config.APIKey != "" {
            fmt.Println("設定ファイル読み込み完了")
            return &config
        }
    }

    fmt.Println("初期設定を開始します...")

    // 初期設定実行（Google OAuth via ブラウザ）
    result, err := setup.RunSetup(serverURL)
    if err != nil {
        fmt.Println("初期設定に失敗しました:", err)
        os.Exit(1)
    }

    config := &Config{
        ServerURL: serverURL + "/ws/app",
        APIKey:    result.APIKey,
        AppID:     result.AppID,
    }

    // 保存
    data, _ := json.MarshalIndent(config, "", "  ")
    os.WriteFile("config.json", data, 0600)

    fmt.Println("設定を保存しました")
    return config
}
```

### 共通パッケージ使用例

```go
// 印刷 App - ハンドラだけ書けばOK
client := cfclient.New(config)
client.OnMessage("print", func(data []byte) []byte {
    return executePrint(data)
})
client.Run()

// スクレイピング App
client := cfclient.New(config)
client.OnMessage("scrape", func(data []byte) []byte {
    return executeScrape(data)
})
client.Run()

// 複数機能 App
client := cfclient.New(config)
client.OnMessage("print", handlePrint)
client.OnMessage("scrape", handleScrape)
client.Run()
```

---

## Go App 接続要領

### 前提条件

- Windows Service として実行
- インターネット接続（Outbound のみ）
- 初回起動時にブラウザで Google OAuth（APIキー自動取得）

### 依存ライブラリ

```go
import (
    "github.com/gorilla/websocket"
    "github.com/pion/webrtc/v3"
    "github.com/chromedp/chromedp"
)
```

### 接続フロー

```
┌─────────────────────────────────────────────────────────────────────┐
│  1. WebSocket 接続                                                  │
│     Go App ──WSS──▶ wss://example.com/ws/app                       │
│                                                                     │
│  2. 認証                                                            │
│     Go App ──────▶ { type: "auth", payload: { apiKey: "xxx" } }    │
│            ◀────── { type: "auth_ok", payload: { userId: "..." } } │
│                                                                     │
│  3. App 登録                                                        │
│     Go App ──────▶ { type: "app_register", payload: {              │
│                       name: "自宅PC",                               │
│                       capabilities: ["print", "scrape"]            │
│                     }}                                              │
│            ◀────── { type: "app_registered", payload: {            │
│                       appId: "app_xxx"                             │
│                     }}                                              │
│                                                                     │
│  4. 待機（Hibernatable - 課金最小）                                 │
│                                                                     │
│  5. WebRTC シグナリング（ブラウザから P2P 要求時）                   │
│            ◀────── { type: "offer", payload: { sdp: "..." } }      │
│     Go App ──────▶ { type: "answer", payload: { sdp: "..." } }     │
│     ... ICE 交換 ...                                               │
│                                                                     │
│  6. P2P 確立 → DataChannel で直接通信                              │
└─────────────────────────────────────────────────────────────────────┘
```

### Go App 実装例

```go
package main

import (
    "encoding/json"
    "log"
    "os"
    "os/signal"
    "time"

    "github.com/gorilla/websocket"
    "github.com/kardianos/service"
    "github.com/pion/webrtc/v3"
)

type Config struct {
    ServerURL    string `json:"server_url"`    // wss://example.com/ws/app
    APIKey       string `json:"api_key"`
    AppName      string `json:"app_name"`
    Capabilities []string `json:"capabilities"` // ["print", "scrape"]
}

type App struct {
    config     *Config
    ws         *websocket.Conn
    pc         *webrtc.PeerConnection
    dataChannel *webrtc.DataChannel
}

// WebSocket 接続
func (a *App) Connect() error {
    var err error
    a.ws, _, err = websocket.DefaultDialer.Dial(a.config.ServerURL, nil)
    if err != nil {
        return err
    }

    // 認証
    a.send(WSMessage{
        Type:    "auth",
        Payload: map[string]string{"apiKey": a.config.APIKey},
    })

    return nil
}

// App 登録
func (a *App) Register() {
    a.send(WSMessage{
        Type: "app_register",
        Payload: map[string]interface{}{
            "name":         a.config.AppName,
            "capabilities": a.config.Capabilities,
        },
    })
}

// メッセージループ
func (a *App) Listen() {
    for {
        _, message, err := a.ws.ReadMessage()
        if err != nil {
            log.Println("WebSocket error:", err)
            a.Reconnect()
            continue
        }

        var msg WSMessage
        json.Unmarshal(message, &msg)

        switch msg.Type {
        case "auth_ok":
            log.Println("Authenticated")
            a.Register()

        case "app_registered":
            log.Println("Registered as:", msg.Payload)

        case "offer":
            a.handleOffer(msg.Payload)

        case "ice":
            a.handleICE(msg.Payload)
        }
    }
}

// WebRTC Offer 処理
func (a *App) handleOffer(payload interface{}) {
    data := payload.(map[string]interface{})
    sdp := data["sdp"].(string)

    // PeerConnection 作成
    config := webrtc.Configuration{
        ICEServers: []webrtc.ICEServer{
            {URLs: []string{"stun:stun.l.google.com:19302"}},
            {URLs: []string{"stun:stun.cloudflare.com:3478"}},
        },
    }

    var err error
    a.pc, err = webrtc.NewPeerConnection(config)
    if err != nil {
        log.Println("PeerConnection error:", err)
        return
    }

    // DataChannel ハンドラ
    a.pc.OnDataChannel(func(dc *webrtc.DataChannel) {
        a.dataChannel = dc
        dc.OnMessage(func(msg webrtc.DataChannelMessage) {
            a.handleDataChannelMessage(msg.Data)
        })
    })

    // ICE Candidate
    a.pc.OnICECandidate(func(c *webrtc.ICECandidate) {
        if c != nil {
            a.send(WSMessage{
                Type:    "ice",
                Payload: map[string]interface{}{"candidate": c.ToJSON()},
            })
        }
    })

    // Offer 設定 & Answer 生成
    offer := webrtc.SessionDescription{
        Type: webrtc.SDPTypeOffer,
        SDP:  sdp,
    }
    a.pc.SetRemoteDescription(offer)

    answer, _ := a.pc.CreateAnswer(nil)
    a.pc.SetLocalDescription(answer)

    a.send(WSMessage{
        Type:    "answer",
        Payload: map[string]interface{}{"sdp": answer.SDP},
    })
}

// DataChannel メッセージ処理（P2P 確立後）
func (a *App) handleDataChannelMessage(data []byte) {
    var msg struct {
        Type    string          `json:"type"`
        Payload json.RawMessage `json:"payload"`
    }
    json.Unmarshal(data, &msg)

    switch msg.Type {
    case "print":
        a.handlePrint(msg.Payload)
    case "scrape":
        a.handleScrape(msg.Payload)
    }
}

// 印刷処理
func (a *App) handlePrint(payload json.RawMessage) {
    var req PrintRequest
    json.Unmarshal(payload, &req)

    // PDF 生成 & 印刷（既存プログラム呼び出し）
    result, err := executePrint(req)

    // 結果を P2P で返信
    a.sendDataChannel(WSMessage{
        Type:    "print_result",
        Payload: result,
    })
}

// スクレイピング処理
func (a *App) handleScrape(payload json.RawMessage) {
    var req ScrapeRequest
    json.Unmarshal(payload, &req)

    // chromedp でスクレイピング
    result, err := executeScrape(req)

    a.sendDataChannel(WSMessage{
        Type:    "scrape_result",
        Payload: result,
    })
}
```

### chromedp 設定（Session 0 対応）

```go
func newChromedpContext() (context.Context, context.CancelFunc) {
    opts := append(chromedp.DefaultExecAllocatorOptions[:],
        chromedp.Flag("headless", true),
        chromedp.Flag("disable-gpu", true),
        chromedp.Flag("no-sandbox", true),
        chromedp.Flag("disable-dev-shm-usage", true),
        chromedp.Flag("disable-software-rasterizer", true),
        chromedp.Flag("disable-extensions", true),
    )

    allocCtx, _ := chromedp.NewExecAllocator(context.Background(), opts...)
    ctx, cancel := chromedp.NewContext(allocCtx)

    return ctx, cancel
}
```

### Windows Service 化

```go
type program struct {
    app *App
}

func (p *program) Start(s service.Service) error {
    go p.run()
    return nil
}

func (p *program) run() {
    p.app = &App{config: loadConfig()}
    
    for {
        if err := p.app.Connect(); err != nil {
            log.Println("Connection failed:", err)
            time.Sleep(5 * time.Second)
            continue
        }
        p.app.Listen()
    }
}

func (p *program) Stop(s service.Service) error {
    if p.app.ws != nil {
        p.app.ws.Close()
    }
    if p.app.pc != nil {
        p.app.pc.Close()
    }
    return nil
}

func main() {
    svcConfig := &service.Config{
        Name:        "PrintScraperService",
        DisplayName: "Print & Scraper Service",
        Description: "WebRTC-based print and scraping service",
    }

    prg := &program{}
    s, _ := service.New(prg, svcConfig)

    if len(os.Args) > 1 {
        switch os.Args[1] {
        case "install":
            s.Install()
        case "uninstall":
            s.Uninstall()
        case "start":
            s.Start()
        case "stop":
            s.Stop()
        default:
            s.Run()
        }
    } else {
        s.Run()
    }
}
```

---

## コスト見積もり

### Cloudflare（1ユーザー想定）

| リソース | 使用量 | 無料枠 | 結果 |
|----------|--------|--------|------|
| Workers リクエスト | ~1,000/日 | 100,000/日 | ✅ 無料 |
| DO リクエスト | ~100/日 | 1,000,000/月 | ✅ 無料 |
| DO Duration | ~数秒/日 | 400,000 GB-秒/月 | ✅ 無料 |
| DO Storage | ~1KB | 1GB | ✅ 無料 |

**結論: Hibernatable WebSocket + P2P で実質無料**

---

## 開発ステップ

### Phase 1: 基盤構築

1. [ ] Workers プロジェクト作成（Hono）
2. [ ] KV namespace 作成
3. [ ] Google OAuth 実装
4. [ ] JWT 発行・検証
5. [ ] 静的ファイル配信

### Phase 2: App 管理 API

1. [ ] App 登録 API（APIキー発行）
2. [ ] App 一覧 API
3. [ ] App 削除 API
4. [ ] APIキー再発行 API
5. [ ] 管理 UI

### Phase 3: Durable Objects

1. [ ] SignalingDO 実装
2. [ ] Hibernatable WebSocket
3. [ ] 接続管理（KV と連携）
4. [ ] メッセージルーティング

### Phase 4: Go App 基盤

1. [ ] 共通パッケージ作成 (go-cf-client)
2. [ ] 初期設定フロー（Google OAuth via ブラウザ）
3. [ ] WebSocket クライアント
4. [ ] 再接続ロジック
5. [ ] Windows Service 化
6. [ ] 設定ファイル管理

### Phase 5: WebRTC

1. [ ] シグナリング実装（Workers側）
2. [ ] pion/webrtc 統合（Go側）
3. [ ] DataChannel 通信
4. [ ] P2P フォールバック

### Phase 6: 機能実装

1. [ ] 印刷機能（既存連携）
2. [ ] スクレイピング（chromedp）
3. [ ] 管理 UI

### Phase 7: 運用

1. [ ] エラーハンドリング強化
2. [ ] ログ収集
3. [ ] 監視

---

## セキュリティ考慮事項

| 項目 | 対策 |
|------|------|
| 認証 | Google OAuth + JWT（有効期限付き） |
| Go App 認証 | APIキー（App ごとに発行、KV で管理） |
| APIキー無効化 | 個別 App 単位で削除可能 |
| 通信暗号化 | WSS + DTLS（WebRTC） |
| CORS | Workers で制限 |
| レート制限 | Workers で実装可能 |

---

## 参考リンク

- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [Hibernatable WebSockets](https://developers.cloudflare.com/durable-objects/api/websockets/)
- [Hono](https://hono.dev/)
- [pion/webrtc](https://github.com/pion/webrtc)
- [chromedp](https://github.com/chromedp/chromedp)
- [kardianos/service](https://github.com/kardianos/service)
