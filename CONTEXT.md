# Pine 🍍 — Family Chat PWA

## 概要
家族＋子供の友達向けのLINE風チャットPWA。Supabase + Vanilla JS + GitHub Pages で構築。

## 技術スタック
- Frontend: Vanilla JS + HTML/CSS (フレームワークなし)
- Backend: Supabase (Database, Auth, Realtime, Edge Functions, Storage)
- Hosting: GitHub Pages
- PWA: Service Worker + Web App Manifest + Badging API
- 通話: WebRTC (STUN/TURN) + Supabase Realtime Private Broadcast
- Push通知: Web Push API + Database Webhook + Edge Function

## プロジェクト構成
```
pine/
├── pages/pine.html          # SPAエントリポイント
├── js/pine/                 # フロントエンドモジュール
│   ├── config.js            # 設定 (Supabase URL, constants)
│   ├── supabase-client.js   # Supabaseクライアント初期化
│   ├── router.js            # Hash-based SPA router
│   ├── auth-service.js      # 認証 (OTP/Magic Link)
│   ├── room-service.js      # Room管理RPC wrapper
│   ├── message-service.js   # メッセージ送信 + Realtime + Outbox
│   ├── call-service.js      # WebRTC通話ライフサイクル
│   ├── push-service.js      # Push subscription管理
│   ├── presence-service.js  # Presence (heartbeat, active_room)
│   ├── unread-service.js    # 未読数計算 + Badge
│   ├── storage-service.js   # 画像upload/signed URL
│   ├── offline-store.js     # IndexedDB (cache + outbox)
│   └── views/               # UI Views
│       ├── room-list.js     # ルーム一覧
│       ├── chat-room.js     # チャット画面
│       ├── call-screen.js   # 通話画面
│       └── invite.js        # 招待画面
├── css/pine.css             # LINE風スタイル
├── sw.js                    # Service Worker
├── manifest.json            # PWA Manifest
├── index.html               # GitHub Pages redirect
├── images/                  # アイコン
├── sql/                     # Supabase SQL migrations (001-014)
├── supabase/functions/      # Edge Functions (4本)
│   ├── push-notify/
│   ├── generate-invite/
│   ├── validate-invite/
│   └── turn-credentials/
└── docs/                    # 設定手順
```

## Supabase プロジェクト
- URL: https://snxvohbfuqdqrwygqpzl.supabase.co
- Project Ref: snxvohbfuqdqrwygqpzl

## デプロイ
- GitHub Pages: https://osho0625.github.io/pine/pages/pine.html
- Edge Functions: `supabase functions deploy <name>` (pine/ディレクトリで実行)

## 設計原則
- All business-state mutations via SECURITY DEFINER RPCs
- Direct RLS CRUD only for user-owned auxiliary data (read_status, push_subscriptions)
- Supabase Storage operations via Storage API + Storage RLS policies
- Offline-first for reads (IndexedDB cache)
- Progressive enhancement (Badge API, Push APIは非対応環境でグレースフル)
