-- ============================================================================
-- Pine Friendships (友達関係)
-- ============================================================================
-- LINE風の友達関係。友達同士のみDM作成・グループ招待が可能。
-- canonical ordering: member_a < member_b で一意性保証。
-- ============================================================================

CREATE TABLE IF NOT EXISTS pine_friendships (
  member_a UUID NOT NULL REFERENCES pine_members(id) ON DELETE CASCADE,
  member_b UUID NOT NULL REFERENCES pine_members(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (member_a, member_b),
  CHECK (member_a < member_b)
);

ALTER TABLE pine_friendships ENABLE ROW LEVEL SECURITY;

-- RLS: authenticated users can see their own friendships
CREATE POLICY "friendships_select" ON pine_friendships
  FOR SELECT TO authenticated
  USING (member_a = auth.uid() OR member_b = auth.uid());

-- No direct INSERT/UPDATE/DELETE — managed via RPCs
-- (add_friend RPC will handle creation)

-- Index for quick friend lookup
CREATE INDEX idx_friendships_member_a ON pine_friendships (member_a);
CREATE INDEX idx_friendships_member_b ON pine_friendships (member_b);
