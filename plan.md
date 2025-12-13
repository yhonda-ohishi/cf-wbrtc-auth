# Implementation Plan

## Current Tasks

### Phase 4: Go App 基盤
- [ ] 共通パッケージ作成 (go-cf-client)
- [ ] 初期設定フロー（Google OAuth via ブラウザ）
- [ ] WebSocket クライアント
- [ ] 再接続ロジック
- [ ] Windows Service 化

### Phase 5: WebRTC
- [ ] ブラウザ側 WebRTC クライアント
- [ ] pion/webrtc 統合（Go側）
- [ ] DataChannel 通信

### Phase 6: 機能実装
- [ ] 管理 UI（ブラウザ）
- [ ] 印刷機能
- [ ] スクレイピング（chromedp）

## Notes
- 各タスクはsubmoduleで実装
- context windowが40%超えたら実装中断、commit作成
