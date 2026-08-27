-- ============================================================================
-- RLS Helper Functions (SECURITY DEFINER)
-- 
-- These functions are used by RLS policies to check room membership without
-- causing infinite recursion when policies on pine_chat_room_members reference
-- the same table. SECURITY DEFINER allows bypassing RLS within the function body.
-- ============================================================================

-- Checks if a member is active in a room (avoids self-referencing RLS on pine_chat_room_members)
CREATE OR REPLACE FUNCTION is_active_room_member(p_room_id UUID, p_member_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.pine_chat_room_members
    WHERE chat_room_id = p_room_id
      AND member_id = p_member_id
      AND left_at IS NULL
  );
$$;

-- Checks if two members share any active room (for pine_members SELECT policy)
CREATE OR REPLACE FUNCTION shares_any_room(p_member_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.pine_chat_room_members AS my
    JOIN public.pine_chat_room_members AS their
      ON my.chat_room_id = their.chat_room_id
    WHERE my.member_id = auth.uid()
      AND my.left_at IS NULL
      AND their.member_id = p_member_id
      AND their.left_at IS NULL
  );
$$;

-- Grant to authenticated (required for RLS policy evaluation when users query tables)
GRANT EXECUTE ON FUNCTION is_active_room_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION shares_any_room(UUID) TO authenticated;
