# Implementation Plan

## Server URL

- Local: `http://localhost:8787`
- Production: `https://cf-wbrtc-auth.m-tama-ramu.workers.dev`

## Current Tasks

### Phase 9: OAuth クライアントヘルパー追加

`src/client/` に OAuth ヘルパーを追加し、外部フロントエンドから簡単に認証できるようにする。

#### 9.1 auth-client.ts 作成
- [ ] `AuthClient` クラス作成
  - `login(returnUrl)` - `/auth/login?return=xxx` にリダイレクト
  - `handleCallback()` - URL からトークンを取得
  - `getToken()` - 保存されたトークンを取得
  - `logout()` - トークン削除
  - `isLoggedIn()` - ログイン状態確認

#### 9.2 OAuth callback でトークンをURLパラメータで返す
- [ ] `/auth/callback` を修正
  - 外部オリジンへのリダイレクト時は `?token=xxx` を付与
  - 同一オリジンは Cookie のまま

#### 9.3 bundle.ts 更新
- [ ] `AuthClient` をエクスポートに追加

#### 9.4 使用例
```typescript
import { AuthClient, SignalingClient } from 'cf-wbrtc-auth/client';

const auth = new AuthClient('https://cf-wbrtc-auth...');

// ログインボタン
auth.login(window.location.href);

// callback 後
const token = auth.handleCallback();
const client = new SignalingClient('wss://cf-wbrtc-auth.../ws', token);
```

## Notes
- Go クライアントは go/client/ ディレクトリで管理
- 各タスクはsub agentで実装
- context windowが40%超えたら実装中断、commit作成
