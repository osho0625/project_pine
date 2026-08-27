# Release Notes

## v0.2.0 (2026-08-28) — LINE-style UI + Password Auth

### 新機能
- メール+パスワード認証（Magic Linkから変更）
- LINE風タブUI（友達タブ + チャットタブ）
- 友達リスト表示（タップでDM開始）
- チャット一覧（相手の名前 + アバター + 最終メッセージ表示）
- LINE風チャット画面（水色背景、緑/白バブル、リアルタイム更新）
- オプティミスティック送信（即座にバブル表示）
- プロフィール設定（アイコン変更、表示名変更、パスワード変更）
- ヘッダー右上: +（招待モーダル）、⚙（設定画面）
- 友達関係テーブル（pine_friendships）追加
- 初期メンバー5人（りょうすけ、めぐみ、はるちか、いろは、かいせい）

### 改善
- スクロールバー非表示（スワイプ操作）
- チャット画面ではメインヘッダー/タブを非表示
- 戻るボタン（‹）でチャットから一覧へ
- DM一覧で相手の名前表示（DMではなく）
- ログアウト後即座にログイン画面へ遷移

### 技術的変更
- Supabase anon key: JWT形式に修正
- Auth: signInWithPassword方式に変更
- pine_members RLS: 友達も閲覧可能に
- pine_friendships: GRANT SELECT TO authenticated
- Admin APIでユーザー作成（identities問題解消）

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
