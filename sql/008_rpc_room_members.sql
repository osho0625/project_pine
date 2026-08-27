-- ============================================================================
-- Room Member Management RPCs (SECURITY DEFINER)
-- ============================================================================
-- add_room_member, remove_room_member
-- Both use SECURITY DEFINER SET search_path = public, pg_temp with fully-qualified table names.
-- Creator-only, group-only operations.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. add_room_member — グループルームにメンバー追加
-- ----------------------------------------------------------------------------
-- Only the room creator can add members.
-- DM rooms are blocked. Supports rejoin (new joined_at record).
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION add_room_member(p_room_id UUID, p_member_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_caller UUID := auth.uid();
  v_room RECORD;
BEGIN
  -- Auth check
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Block DM rooms: only group rooms allow adding members
  IF NOT EXISTS (
    SELECT 1 FROM public.pine_chat_rooms
    WHERE id = p_room_id AND is_group = true
  ) THEN
    RAISE EXCEPTION 'Cannot add members in DM rooms';
  END IF;

  -- Verify caller is creator and room is not deleted
  SELECT id, created_by
  INTO v_room
  FROM public.pine_chat_rooms
  WHERE id = p_room_id AND deleted_at IS NULL;

  IF v_room IS NULL THEN
    RAISE EXCEPTION 'Room not found';
  END IF;

  IF v_room.created_by <> v_caller THEN
    RAISE EXCEPTION 'Only the room creator can add members';
  END IF;

  -- Validate target member exists in pine_members
  IF NOT EXISTS (
    SELECT 1 FROM public.pine_members WHERE id = p_member_id
  ) THEN
    RAISE EXCEPTION 'Target member does not exist';
  END IF;

  -- Check target is not already an active member
  IF EXISTS (
    SELECT 1 FROM public.pine_chat_room_members
    WHERE chat_room_id = p_room_id
      AND member_id = p_member_id
      AND left_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Target is already an active member of this room';
  END IF;

  -- Insert new membership record (supports rejoin with new joined_at)
  INSERT INTO public.pine_chat_room_members (chat_room_id, member_id, joined_at)
  VALUES (p_room_id, p_member_id, now());
END;
$fn$;

-- ----------------------------------------------------------------------------
-- 2. remove_room_member — グループルームからメンバー削除
-- ----------------------------------------------------------------------------
-- Only the room creator can remove members.
-- Creator cannot remove themselves (use leave_chat_room after ownership transfer).
-- DM rooms are blocked.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION remove_room_member(p_room_id UUID, p_member_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_caller UUID := auth.uid();
  v_room RECORD;
  v_updated INT;
BEGIN
  -- Auth check
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Block DM rooms: only group rooms allow removing members
  IF NOT EXISTS (
    SELECT 1 FROM public.pine_chat_rooms
    WHERE id = p_room_id AND is_group = true
  ) THEN
    RAISE EXCEPTION 'Cannot remove members in DM rooms';
  END IF;

  -- Verify caller is creator and room is not deleted
  SELECT id, created_by
  INTO v_room
  FROM public.pine_chat_rooms
  WHERE id = p_room_id AND deleted_at IS NULL;

  IF v_room IS NULL THEN
    RAISE EXCEPTION 'Room not found';
  END IF;

  IF v_room.created_by <> v_caller THEN
    RAISE EXCEPTION 'Only the room creator can remove members';
  END IF;

  -- Creator cannot remove themselves
  IF p_member_id = v_caller THEN
    RAISE EXCEPTION 'Creator cannot remove themselves; use leave_chat_room after ownership transfer';
  END IF;

  -- Set left_at on target's active membership
  UPDATE public.pine_chat_room_members
  SET left_at = now()
  WHERE chat_room_id = p_room_id
    AND member_id = p_member_id
    AND left_at IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RAISE EXCEPTION 'Target is not an active member of this room';
  END IF;
END;
$fn$;

-- ============================================================================
-- REVOKE/GRANT — Authenticated users only
-- ============================================================================

REVOKE EXECUTE ON FUNCTION add_room_member(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION add_room_member(UUID, UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION remove_room_member(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION remove_room_member(UUID, UUID) TO authenticated;
