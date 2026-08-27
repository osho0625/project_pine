-- ============================================================================
-- update_presence RPC — Presence Update (SECURITY DEFINER)
-- ============================================================================
-- Safely updates only last_seen_at and active_room_id on the caller's row.
-- Prevents clients from directly modifying other pine_members columns.
-- Called by presence-service.js on: app open, room enter, room leave, heartbeat, background.
-- ============================================================================

CREATE OR REPLACE FUNCTION update_presence(p_room_id UUID DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller UUID := auth.uid();
BEGIN
  -- Validate authenticated user
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- When p_room_id is not NULL, verify the caller is an active member of the room
  IF p_room_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.pine_chat_room_members
      WHERE chat_room_id = p_room_id
        AND member_id = v_caller
        AND left_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Not an active member of this room';
    END IF;
  END IF;

  -- Update only last_seen_at and active_room_id
  UPDATE public.pine_members
  SET last_seen_at = now(),
      active_room_id = p_room_id
  WHERE id = v_caller;
END;
$$;

-- Permission: only authenticated users can call this
REVOKE EXECUTE ON FUNCTION update_presence(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_presence(UUID) TO authenticated;
