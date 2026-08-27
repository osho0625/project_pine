-- ============================================================================
-- get_or_create_dm_room RPC — DM Room Creation (SECURITY DEFINER)
-- ============================================================================
-- Atomically gets existing DM room or creates a new one between caller and other member.
-- Uses canonical member pair (least/greatest) + INSERT ON CONFLICT for race-condition safety.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_or_create_dm_room(p_other_member_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room_id UUID;
  v_caller UUID := auth.uid();
  v_member_a UUID;
  v_member_b UUID;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_caller = p_other_member_id THEN RAISE EXCEPTION 'Cannot create DM with self'; END IF;

  -- Validate other member exists
  IF NOT EXISTS (SELECT 1 FROM public.pine_members WHERE id = p_other_member_id) THEN
    RAISE EXCEPTION 'Member does not exist';
  END IF;

  -- Compute canonical member pair (ensures consistent ordering)
  v_member_a := least(v_caller, p_other_member_id);
  v_member_b := greatest(v_caller, p_other_member_id);

  -- Attempt INSERT with conflict resolution (race-condition safe via idx_unique_dm_pair)
  INSERT INTO public.pine_chat_rooms (is_group, created_by, dm_member_a, dm_member_b)
  VALUES (false, v_caller, v_member_a, v_member_b)
  ON CONFLICT (dm_member_a, dm_member_b) WHERE is_group = false AND deleted_at IS NULL
  DO NOTHING
  RETURNING id INTO v_room_id;

  -- If DO NOTHING fired (room already exists), SELECT it
  IF v_room_id IS NULL THEN
    SELECT id INTO v_room_id
    FROM public.pine_chat_rooms
    WHERE dm_member_a = v_member_a AND dm_member_b = v_member_b
      AND is_group = false AND deleted_at IS NULL;
  ELSE
    -- New room created — insert both members
    INSERT INTO public.pine_chat_room_members (chat_room_id, member_id)
    VALUES (v_room_id, v_caller), (v_room_id, p_other_member_id);
  END IF;

  RETURN v_room_id;
END;
$$;

-- Permission: only authenticated users can call this
REVOKE EXECUTE ON FUNCTION get_or_create_dm_room(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_or_create_dm_room(UUID) TO authenticated;
