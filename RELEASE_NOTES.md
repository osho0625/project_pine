# Release Notes

## v0.1.0 (2026-08-28) — Initial MVP

### 機能
- LINE風チャットUI (テキスト + 画像メッセージ)
- グループルーム / 1対1 DM
- WebRTC 1対1通話 (STUN/TURN)
- Web Push通知 + PWA Badge
- 招待制認証 (Email OTP)
- オフラインメッセージ送信 (IndexedDB Outbox)
- PWAインストール対応

### セキュリティ
- 全書き込みはSECURITY DEFINER RPC経由
- Row Level Security全テーブル有効
- Realtime Authorization (private broadcast channel)
- Storage RLS (room member only)
- 招待コードSHA-256ハッシュ保存
- Email検証 (invited_email match)

### DB構成
- 8テーブル + 14 RPC + 4 Edge Functions
- pg_net Webhookトリガー
- Private Storage bucket (jpeg/png/webp, 10MB)

### 既知の制限
- グループ通話未対応 (1対1のみ)
- メッセージ編集/削除未対応
- オフライン画像送信未対応
- Push通知の重複送信可能性あり (MVP制限)
- Storage orphan cleanup未実装
