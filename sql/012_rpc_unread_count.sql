-- ============================================================================
-- calculate_unread_count RPC — Total Unread Count (SECURITY DEFINER)
-- ============================================================================
-- Service-role only. Called by push-notify Edge Function.
-- Calculates total unread message count across all active rooms for a member.
-- Respects: joined_at boundary, (created_at, id) tuple ordering, excludes own messages.
-- ============================================================================

CREATE OR REPLACE FUNCTION calculate_unread_count(p_member_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_total INTEGER := 0;
  v_room RECORD;
  v_last_read_created_at TIMESTAMPTZ;
  v_last_read_id UUID;
  v_count INTEGER;
BEGIN
  -- Loop through all active rooms for this member
  FOR v_room IN
    SELECT crm.chat_room_id, crm.joined_at, rs.last_read_message_id
    FROM public.pine_chat_room_members crm
    LEFT JOIN public.pine_read_status rs
      ON rs.member_id = crm.member_id AND rs.chat_room_id = crm.chat_room_id
    WHERE crm.member_id = p_member_id AND crm.left_at IS NULL
  LOOP
    IF v_room.last_read_message_id IS NOT NULL THEN
      -- Get the created_at and id of the last read message
      SELECT created_at, id INTO v_last_read_created_at, v_last_read_id
      FROM public.pine_messages
      WHERE id = v_room.last_read_message_id;

      -- Count unread: messages after last_read, not from self, after joined_at
      SELECT COUNT(*) INTO v_count
      FROM public.pine_messages
      WHERE chat_room_id = v_room.chat_room_id
        AND sender_id <> p_member_id
        AND created_at >= v_room.joined_at
        AND (created_at, id) > (v_last_read_created_at, v_last_read_id);
    ELSE
      -- No last_read: count all messages after joined_at, not from self
      SELECT COUNT(*) INTO v_count
      FROM public.pine_messages
      WHERE chat_room_id = v_room.chat_room_id
        AND sender_id <> p_member_id
        AND created_at >= v_room.joined_at;
    END IF;

    v_total := v_total + COALESCE(v_count, 0);
  END LOOP;

  RETURN v_total;
END;
$$;

-- Permission: service_role only (called by push-notify Edge Function)
REVOKE EXECUTE ON FUNCTION calculate_unread_count(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION calculate_unread_count(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION calculate_unread_count(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION calculate_unread_count(UUID) TO service_role;
