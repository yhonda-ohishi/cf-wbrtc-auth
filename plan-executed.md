# Executed Tasks

## Completed

### Phase 1: 基盤構築
- [x] Workers プロジェクト作成（Hono）
- [x] KV namespace 設定（wrangler.toml）
- [x] Google OAuth 実装 (`src/auth/oauth.ts`)
- [x] JWT 発行・検証 (`src/auth/jwt.ts`)
- [x] 認証ミドルウェア (`src/middleware/auth.ts`)

### Phase 2: App 管理 API
- [x] App 登録 API（APIキー発行）
- [x] App 一覧 API
- [x] App 削除 API
- [x] APIキー再発行 API
- [x] Go App セットアップフロー (`src/setup/index.ts`)

### Phase 3: Durable Objects
- [x] SignalingDO 実装 (`src/do/signaling.ts`)
- [x] Hibernatable WebSocket
- [x] 接続管理
- [x] WebRTC シグナリング（offer/answer/ice）

### Phase 4: ブラウザ側クライアント
- [x] ブラウザ側 WebSocket クライアント (`src/client/ws-client.ts`)
- [x] ブラウザ側 WebRTC クライアント (`src/client/webrtc-client.ts`)
- [x] 管理 UI (`src/client/index.html`, `src/client/ui.ts`)

### Phase 5: テスト・ドキュメント
- [x] Workers 統合テスト (`test/jwt.test.ts`, `test/auth.test.ts`, `test/apps.test.ts`)
- [x] API ドキュメント (`docs/API.md`)

### Phase 6: ポーリング方式セットアップ
Go AppとブラウザがマシンでもOAuthセットアップできるように、ポーリング方式に変更

#### サーバー側 (TypeScript)
- [x] `POST /setup/init` - setupToken生成、KVに保存（5分TTL）
- [x] `GET /setup/:token` - OAuth開始ページ（トークン検証→OAuth→登録フォーム）
- [x] `POST /setup/:token/register` - アプリ登録、APIキーをKVに保存
- [x] `GET /setup/poll?token=xxx` - ステータス確認（pending/complete）

#### Go client側
- [x] `Setup()` をポーリング方式に書き換え
- [x] テスト更新

#### その他
- [x] localhost向けCookie secure属性の修正 (`src/auth/oauth.ts`)
- [x] WebSocket Cookie token読み取り (`src/do/signaling.ts`)

## Files Created
- `package.json`
- `tsconfig.json`
- `wrangler.toml`
- `vitest.config.ts`
- `src/index.ts` - Entry point with embedded UI
- `src/auth/oauth.ts` - Google OAuth
- `src/auth/jwt.ts` - JWT sign/verify
- `src/middleware/auth.ts` - Auth middleware
- `src/setup/index.ts` - Go App setup flow
- `src/api/apps.ts` - App management API
- `src/do/signaling.ts` - SignalingDO
- `src/client/ws-client.ts` - WebSocket client
- `src/client/webrtc-client.ts` - WebRTC client
- `src/client/ui.ts` - UI manager
- `src/client/index.ts` - Client exports
- `src/client/index.html` - Management UI
- `src/client/bundle.ts` - Embedded client bundle
- `test/jwt.test.ts` - JWT tests
- `test/auth.test.ts` - Auth middleware tests
- `test/apps.test.ts` - App API tests
- `test/README.md` - Test documentation
- `docs/API.md` - API documentation
- `docs/setup-api.md` - Setup API documentation
- `test/setup.test.ts` - Setup API tests
- `go/client/setup.go` - Go client setup (polling)
- `go/client/setup_test.go` - Go client setup tests
- `go/client/client.go` - Go client core
- `go/client/client_test.go` - Go client core tests
- `go/client/webrtc.go` - Go WebRTC client
- `go/client/messages.go` - Go message types
- `go/client/example_test.go` - Go example usage
- `go/client/go.mod` - Go module
- `go/client/go.sum` - Go dependencies
- `go/client/e2e_test.go` - WebSocket E2E tests
- `go/client/e2e_webrtc_test.go` - WebRTC P2P E2E tests

### Phase 7: E2Eテスト

#### WebSocket接続テスト
- [x] Go AppからWebSocket接続 (`/ws/app?apiKey=xxx`)
- [x] 認証成功確認 (`auth_ok` メッセージ受信)
- [x] 接続維持・再接続テスト

#### WebRTC P2P接続テスト
- [x] ブラウザ→Go App間のP2P接続確立（ローカルLoopbackテスト）
- [x] SDP offer/answer交換
- [x] ICE candidate交換
- [x] DataChannel通信テスト

#### E2Eテスト実行方法
```bash
# WebSocket E2Eテスト（要サーバー）
E2E_TEST=1 E2E_API_KEY=your-key go test -v ./go/client -run E2E

# WebRTC E2Eテスト（サーバー不要、ローカルLoopback）
E2E_TEST=1 go test -v ./go/client -run TestE2EWebRTC
```

### Phase 8: gRPC-Web Transport Library

WebRTC DataChannel上でgRPC-Web通信を可能にするトランスポート層。

#### 8.1 基盤構築
- [x] Proto定義削除（ユーザー側で定義）
- [x] 依存関係追加
  - `package.json`: `@connectrpc/connect`, `@connectrpc/connect-web`
  - `go.mod`: `connectrpc.com/connect`

#### 8.2 gRPC-Webコーデック実装
- [x] TypeScript: `src/grpc/codec/frame.ts` - Frame codec (data/trailer frames)
- [x] TypeScript: `src/grpc/codec/envelope.ts` - Envelope codec (request/response)
- [x] Go: `go/grpcweb/codec/frame.go` - Frame codec
- [x] Go: `go/grpcweb/codec/envelope.go` - Envelope codec

#### 8.3 DataChannelトランスポート
- [x] TypeScript: `src/grpc/transport/datachannel-transport.ts` - クライアント側トランスポート
- [x] Go: `go/grpcweb/transport/datachannel.go` - サーバー側トランスポート

#### 8.4 統合・エクスポート
- [x] TypeScript: `src/grpc/index.ts` - 公開API
- [x] Go: `go/grpcweb/grpcweb.go` - 公開API
- [x] WebRTCクライアント修正（`getTransport()` メソッド追加）

#### 8.5 サンプル・ドキュメント
- [x] `examples/` にサンプル実装
- [x] README更新

#### 8.6 Server Reflection
- [x] Go: `go/grpcweb/reflection/reflection.go` - Server Reflection実装
- [x] Go: `go/grpcweb/reflection/reflection_test.go` - Server Reflectionテスト
- [x] TypeScript: `src/grpc/reflection/reflection.ts` - Reflectionクライアント
- [x] TypeScript: `test/reflection.test.ts` - Reflectionテスト
- [x] Go grpcweb.goにReflection API追加
- [x] Transport に `GetRegisteredMethods()` メソッド追加

## Phase 8 Files Created
- `src/grpc/codec/frame.ts` - TypeScript Frame codec
- `src/grpc/codec/envelope.ts` - TypeScript Envelope codec
- `src/grpc/transport/datachannel-transport.ts` - TypeScript DataChannel transport
- `src/grpc/reflection/reflection.ts` - TypeScript Reflection client
- `src/grpc/index.ts` - TypeScript public API
- `go/grpcweb/codec/frame.go` - Go Frame codec
- `go/grpcweb/codec/frame_test.go` - Go Frame codec tests
- `go/grpcweb/codec/envelope.go` - Go Envelope codec
- `go/grpcweb/codec/envelope_test.go` - Go Envelope codec tests
- `go/grpcweb/transport/datachannel.go` - Go DataChannel transport
- `go/grpcweb/transport/datachannel_test.go` - Go transport tests
- `go/grpcweb/reflection/reflection.go` - Go Server Reflection
- `go/grpcweb/reflection/reflection_test.go` - Go Reflection tests
- `go/grpcweb/grpcweb.go` - Go public API
- `go/grpcweb/go.mod` - Go module
- `test/reflection.test.ts` - TypeScript Reflection tests
- `examples/go/server.go` - Go server example
- `examples/typescript/client.ts` - TypeScript client example
- `examples/README.md` - Examples documentation

### Phase 8.7: Reflection Test Page
- [x] gRPC Server Reflection テストページ実装
  - `src/client/reflection-ui.ts` - Reflection UI マネージャー
  - `src/client/reflection-bundle.ts` - バンドル済みJavaScript
  - `src/index.ts` - `/reflection` ルート追加
  - Go Appに接続してサービス一覧を表示する機能
