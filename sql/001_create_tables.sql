-- ============================================================
-- Pine Chat App — Base Tables Migration
-- ============================================================
-- Creates all core tables for the Pine family chat application.
-- Includes CHECK constraints, indexes, and enables RLS on all tables.
-- ============================================================

-- ------------------------------------------------------------
-- 1. pine_members — メンバー管理（Supabase Auth連携）
-- ------------------------------------------------------------
CREATE TABLE pine_members (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  last_seen_at TIMESTAMPTZ,
  active_room_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 2. pine_push_subscriptions — プッシュ通知サブスクリプション
-- ------------------------------------------------------------
CREATE TABLE pine_push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES pine_members(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  keys_p256dh TEXT NOT NULL,
  keys_auth TEXT NOT NULL,
  user_agent TEXT,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 3. pine_chat_rooms — チャットルーム
-- ------------------------------------------------------------
CREATE TABLE pine_chat_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  is_group BOOLEAN NOT NULL DEFAULT false,
  created_by UUID NOT NULL REFERENCES pine_members(id),
  dm_member_a UUID,
  dm_member_b UUID,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (dm_member_a IS NULL OR dm_member_a < dm_member_b)
);

-- ------------------------------------------------------------
-- 4. pine_chat_room_members — チャットルームメンバー
-- ------------------------------------------------------------
CREATE TABLE pine_chat_room_members (
  chat_room_id UUID NOT NULL REFERENCES pine_chat_rooms(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES pine_members(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at TIMESTAMPTZ,
  PRIMARY KEY (chat_room_id, member_id, joined_at)
);

-- ------------------------------------------------------------
-- 5. pine_messages — メッセージ
-- ------------------------------------------------------------
CREATE TABLE pine_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_room_id UUID NOT NULL REFERENCES pine_chat_rooms(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES pine_members(id),
  client_message_id UUID NOT NULL,
  content TEXT,
  message_type TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'image')),
  storage_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sender_id, client_message_id),
  CHECK (
    (message_type = 'text' AND content IS NOT NULL AND storage_path IS NULL)
    OR (message_type = 'image' AND content IS NULL AND storage_path IS NOT NULL)
  )
);

-- ------------------------------------------------------------
-- 6. pine_read_status — 既読管理
-- ------------------------------------------------------------
CREATE TABLE pine_read_status (
  member_id UUID NOT NULL REFERENCES pine_members(id) ON DELETE CASCADE,
  chat_room_id UUID NOT NULL REFERENCES pine_chat_rooms(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_read_message_id UUID REFERENCES pine_messages(id),
  PRIMARY KEY (member_id, chat_room_id)
);

-- ------------------------------------------------------------
-- 7. pine_call_sessions — 通話セッション
-- ------------------------------------------------------------
CREATE TABLE pine_call_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_room_id UUID NOT NULL REFERENCES pine_chat_rooms(id) ON DELETE CASCADE,
  caller_id UUID NOT NULL REFERENCES pine_members(id),
  callee_id UUID NOT NULL REFERENCES pine_members(id),
  status TEXT NOT NULL DEFAULT 'calling' CHECK (status IN ('calling', 'connecting', 'connected', 'ending', 'ended', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ
);

-- ------------------------------------------------------------
-- 8. pine_invites — 招待管理
-- ------------------------------------------------------------
CREATE TABLE pine_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES pine_members(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'processing', 'used', 'expired')),
  invited_email TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_member_id UUID REFERENCES pine_members(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Indexes
-- ============================================================

-- Messages: efficient room message listing (chronological order)
CREATE INDEX idx_pine_messages_room ON pine_messages (chat_room_id, created_at, id);

-- Messages: lookup by sender
CREATE INDEX idx_pine_messages_sender ON pine_messages (sender_id);

-- Call sessions: room call history
CREATE INDEX idx_pine_call_sessions_room ON pine_call_sessions (chat_room_id, created_at);

-- Room members: enforce at most one active membership per room (partial unique)
CREATE UNIQUE INDEX idx_active_room_member ON pine_chat_room_members (chat_room_id, member_id) WHERE left_at IS NULL;

-- Room members: lookup active rooms for a member
CREATE INDEX idx_room_members_active ON pine_chat_room_members (member_id, chat_room_id) WHERE left_at IS NULL;

-- Chat rooms: enforce unique DM pair (partial unique, allows re-creation after soft-delete)
CREATE UNIQUE INDEX idx_unique_dm_pair ON pine_chat_rooms (dm_member_a, dm_member_b) WHERE is_group = false AND deleted_at IS NULL;

-- ============================================================
-- Enable Row Level Security on all tables
-- ============================================================

ALTER TABLE pine_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE pine_push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pine_chat_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE pine_chat_room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE pine_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE pine_read_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE pine_call_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pine_invites ENABLE ROW LEVEL SECURITY;
