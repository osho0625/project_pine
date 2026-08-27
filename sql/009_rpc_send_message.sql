-- ============================================================================
-- send_message RPC — Idempotent Message Send (SECURITY DEFINER)
-- ============================================================================
-- Replaces direct INSERT on pine_messages. Validates auth, active membership,
-- content integrity (text/image mutual exclusivity), text length, storage_path.
-- Uses ON CONFLICT DO NOTHING for idempotent retry support.
-- ============================================================================

CREATE OR REPLACE FUNCTION send_message(
  p_room_id UUID,
  p_client_message_id UUID,
  p_content TEXT DEFAULT NULL,
  p_message_type TEXT DEFAULT 'text',
  p_storage_path TEXT DEFAULT NULL
)
RETURNS public.pine_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_result public.pine_messages;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Validate active membership
  IF NOT EXISTS (
    SELECT 1 FROM public.pine_chat_room_members
    WHERE chat_room_id = p_room_id AND member_id = v_caller AND left_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Not an active member of this room';
  END IF;

  -- Validate content integrity
  IF p_message_type = 'text' AND (p_content IS NULL OR p_storage_path IS NOT NULL) THEN
    RAISE EXCEPTION 'Text message must have content and no storage_path';
  END IF;
  IF p_message_type = 'image' AND (p_content IS NOT NULL OR p_storage_path IS NULL) THEN
    RAISE EXCEPTION 'Image message must have storage_path and no content';
  END IF;
  IF p_message_type NOT IN ('text', 'image') THEN
    RAISE EXCEPTION 'Invalid message_type: must be text or image';
  END IF;

  -- Validate text length limit
  IF p_message_type = 'text' AND char_length(p_content) > 4000 THEN
    RAISE EXCEPTION 'Message content exceeds 4000 character limit';
  END IF;

  -- Validate storage_path is within the target room folder
  IF p_message_type = 'image' THEN
    IF p_storage_path NOT LIKE p_room_id::text || '/%' THEN
      RAISE EXCEPTION 'storage_path must be within the target room folder';
    END IF;
  END IF;

  -- Idempotent insert (ON CONFLICT DO NOTHING for retry safety)
  INSERT INTO public.pine_messages (
    chat_room_id, sender_id, client_message_id, content, message_type, storage_path
  )
  VALUES (p_room_id, v_caller, p_client_message_id, p_content, p_message_type, p_storage_path)
  ON CONFLICT (sender_id, client_message_id) DO NOTHING
  RETURNING * INTO v_result;

  -- On conflict (duplicate), SELECT and return the existing row
  IF v_result IS NULL THEN
    SELECT * INTO v_result
    FROM public.pine_messages
    WHERE sender_id = v_caller AND client_message_id = p_client_message_id;
  END IF;

  RETURN v_result;
END;
$$;

-- Permission: only authenticated users can call this
REVOKE EXECUTE ON FUNCTION send_message(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION send_message(UUID, UUID, TEXT, TEXT, TEXT) TO authenticated;
