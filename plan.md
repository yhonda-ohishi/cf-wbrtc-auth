# Implementation Plan

## Server URL

- Local: `http://localhost:8787`
- Production: `https://cf-wbrtc-auth.m-tama-ramu.workers.dev`

## Current Tasks

### Phase 8: gRPC-Web Transport Library（残タスク）

#### 8.5 サンプル・ドキュメント
- [ ] `examples/` にサンプル実装
- [ ] README更新

## Notes
- Go クライアントは go/client/ ディレクトリで管理
- 各タスクはsub agentで実装
- context windowが40%超えたら実装中断、commit作成
