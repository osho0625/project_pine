-- ============================================================================
-- create_chat_room RPC — Group Room Creation (SECURITY DEFINER)
-- ============================================================================
-- Creates group chat rooms only. DM rooms must use get_or_create_dm_room.
-- Validates: auth, blocks DM, name (1-100 chars), members exist, ≥3 for group, max 50.
-- ============================================================================

CREATE OR REPLACE FUNCTION create_chat_room(
  p_name TEXT,
  p_member_ids UUID[],
  p_is_group BOOLEAN
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room_id UUID;
  v_caller UUID := auth.uid();
  v_all_members UUID[];
BEGIN
  -- Validate caller is authenticated
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Block DM creation via this RPC (must use get_or_create_dm_room)
  IF p_is_group = false THEN
    RAISE EXCEPTION 'Use get_or_create_dm_room for 1-on-1 rooms';
  END IF;

  -- Validate p_name for group rooms (1-100 chars, required)
  IF p_name IS NULL OR char_length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'Group room name is required';
  END IF;
  IF char_length(p_name) > 100 THEN
    RAISE EXCEPTION 'Room name must be 100 characters or less';
  END IF;

  -- Validate p_member_ids is not NULL or empty
  IF p_member_ids IS NULL OR array_length(p_member_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Member list cannot be empty';
  END IF;

  -- Validate member count limit (max 50)
  IF array_length(p_member_ids, 1) > 50 THEN
    RAISE EXCEPTION 'Cannot exceed 50 members per room';
  END IF;

  -- Ensure caller is in member list
  v_all_members := array_append(p_member_ids, v_caller);
  v_all_members := ARRAY(SELECT DISTINCT unnest(v_all_members));

  -- Validate all member_ids exist in pine_members
  IF EXISTS (
    SELECT 1 FROM unnest(v_all_members) AS mid
    WHERE NOT EXISTS (SELECT 1 FROM public.pine_members WHERE id = mid)
  ) THEN
    RAISE EXCEPTION 'One or more members do not exist';
  END IF;

  -- Validate member count for group rooms (≥3 including caller)
  IF array_length(v_all_members, 1) < 3 THEN
    RAISE EXCEPTION 'Group room requires 3 or more members';
  END IF;

  -- Create room
  INSERT INTO public.pine_chat_rooms (name, is_group, created_by)
  VALUES (trim(p_name), p_is_group, v_caller)
  RETURNING id INTO v_room_id;

  -- Insert all members
  INSERT INTO public.pine_chat_room_members (chat_room_id, member_id)
  SELECT v_room_id, unnest(v_all_members);

  RETURN v_room_id;
END;
$$;

-- Permission: only authenticated users can call this
REVOKE EXECUTE ON FUNCTION create_chat_room(TEXT, UUID[], BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_chat_room(TEXT, UUID[], BOOLEAN) TO authenticated;
