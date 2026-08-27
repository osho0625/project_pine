---
inclusion: auto
---

# Pine Project Steering

## プロジェクト情報
- リポジトリ: pine/ ディレクトリ (c:\cert\work\okdk\pine)
- Supabase Project Ref: snxvohbfuqdqrwygqpzl
- Supabase URL: https://snxvohbfuqdqrwygqpzl.supabase.co

## コーディング規約
- Vanilla JS (ES2020+), フレームワークなし
- グローバルオブジェクト/関数パターン (ES Modules不使用)
- 日本語UI, 英語コメント
- Supabase RPCはpineSupabase.rpc()で呼び出し
- 認証: signInWithPassword (メール+パスワード)
- SECURITY DEFINER関数はSET search_path = public, pg_temp必須
- RLSヘルパー関数: is_active_room_member(), shares_any_room()
- 友達関係: pine_friendships テーブル (canonical pair: member_a < member_b)

## ファイル配置ルール
- SQL: pine/sql/NNN_description.sql
- Edge Functions: pine/supabase/functions/{name}/index.ts
- Frontend JS: pine/js/pine/{module}.js
- Views: pine/js/pine/views/{view}.js
- CSS: pine/css/pine.css
- 静的ファイル: pine/ ルート (manifest.json, sw.js, index.html)

## 初期ユーザー
- りょうすけ: d29.ll.tennis@gmail.com / ryosuke
- めぐみ: toppo5526@gmail.com / megumi
- はるちか: dazanyo860@bangban.uk / haruchika
- いろは: zinufedo947@mama3.org / iroha
- かいせい: yokyanokyo@usagica.com / kaisei

## Supabase CLI操作
- デプロイ: `supabase functions deploy <name>` (pine/で実行)
- SQL実行: `supabase db query --linked --file sql/NNN.sql` (pine/で実行)
- Secrets: `supabase secrets set KEY=VALUE` (pine/で実行)

## Git運用
- mainブランチ: 本番 (GitHub Pages)
- 作業ブランチ: feature/xxx, fix/xxx
- マージ: --no-ff
- pushコマンド: `git push` (HTTPS + PAT設定済み)
