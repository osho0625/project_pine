-- ============================================================================
-- Room Management RPCs (SECURITY DEFINER)
-- ============================================================================
-- leave_chat_room, transfer_room_ownership, rename_chat_room, delete_chat_room
-- All use SECURITY DEFINER SET search_path = public, pg_temp with fully-qualified table names.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. leave_chat_room — グループルーム退出
-- ----------------------------------------------------------------------------
-- DM rooms: reject (use delete_chat_room instead)
-- Group rooms: creator must transfer ownership first; otherwise set left_at
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION leave_chat_room(p_room_id UUID)
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
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Fetch room (must exist and not be deleted)
  SELECT id, is_group, created_by
  INTO v_room
  FROM public.pine_chat_rooms
  WHERE id = p_room_id AND deleted_at IS NULL;

  IF v_room IS NULL THEN
    RAISE EXCEPTION 'Room not found';
  END IF;

  -- DM rooms cannot be left
  IF v_room.is_group = false THEN
    RAISE EXCEPTION 'Cannot leave a DM room. Use delete_chat_room to hide it instead.';
  END IF;

  -- Creator must transfer ownership before leaving
  IF v_room.created_by = v_caller THEN
    RAISE EXCEPTION 'Room creator must transfer ownership before leaving';
  END IF;

  -- Set left_at on caller's active membership
  UPDATE public.pine_chat_room_members
  SET left_at = now()
  WHERE chat_room_id = p_room_id
    AND member_id = v_caller
    AND left_at IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RAISE EXCEPTION 'Not an active member of this room';
  END IF;
END;
$fn$;

-- ----------------------------------------------------------------------------
-- 2. transfer_room_ownership — ルームオーナー移譲
-- ----------------------------------------------------------------------------
-- Caller must be current creator. New owner must be active member.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION transfer_room_ownership(p_room_id UUID, p_new_owner_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_caller UUID := auth.uid();
  v_room RECORD;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Verify caller is current creator of room (not deleted)
  SELECT id, created_by
  INTO v_room
  FROM public.pine_chat_rooms
  WHERE id = p_room_id AND deleted_at IS NULL;

  IF v_room IS NULL THEN
    RAISE EXCEPTION 'Room not found';
  END IF;

  IF v_room.created_by <> v_caller THEN
    RAISE EXCEPTION 'Only the room creator can transfer ownership';
  END IF;

  -- Verify new owner is active member
  IF NOT EXISTS (
    SELECT 1 FROM public.pine_chat_room_members
    WHERE chat_room_id = p_room_id
      AND member_id = p_new_owner_id
      AND left_at IS NULL
  ) THEN
    RAISE EXCEPTION 'New owner must be an active member of this room';
  END IF;

  -- Transfer ownership
  UPDATE public.pine_chat_rooms
  SET created_by = p_new_owner_id
  WHERE id = p_room_id;
END;
$fn$;

-- ----------------------------------------------------------------------------
-- 3. rename_chat_room — ルーム名変更
-- ----------------------------------------------------------------------------
-- Creator-only. Name must be 1-100 chars after trim.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION rename_chat_room(p_room_id UUID, p_new_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_caller UUID := auth.uid();
  v_room RECORD;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Verify caller is creator, room not deleted
  SELECT id, created_by
  INTO v_room
  FROM public.pine_chat_rooms
  WHERE id = p_room_id AND deleted_at IS NULL;

  IF v_room IS NULL THEN
    RAISE EXCEPTION 'Room not found';
  END IF;

  IF v_room.created_by <> v_caller THEN
    RAISE EXCEPTION 'Only the room creator can rename the room';
  END IF;

  -- Validate name: NOT NULL, 1-100 chars after trim
  IF p_new_name IS NULL OR char_length(trim(p_new_name)) = 0 THEN
    RAISE EXCEPTION 'Room name is required';
  END IF;

  IF char_length(trim(p_new_name)) > 100 THEN
    RAISE EXCEPTION 'Room name must be 100 characters or less';
  END IF;

  -- Update room name
  UPDATE public.pine_chat_rooms
  SET name = trim(p_new_name)
  WHERE id = p_room_id;
END;
$fn$;

-- ----------------------------------------------------------------------------
-- 4. delete_chat_room — ルーム削除（ソフトデリート）
-- ----------------------------------------------------------------------------
-- Group rooms: only creator can delete
-- DM rooms: either active member can delete
-- Soft-deletes room and ends any active call sessions
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION delete_chat_room(p_room_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_caller UUID := auth.uid();
  v_room RECORD;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Find room (not already deleted)
  SELECT id, is_group, created_by
  INTO v_room
  FROM public.pine_chat_rooms
  WHERE id = p_room_id AND deleted_at IS NULL;

  IF v_room IS NULL THEN
    RAISE EXCEPTION 'Room not found';
  END IF;

  -- Authorization check
  IF v_room.is_group = true THEN
    -- Group rooms: only creator can delete
    IF v_room.created_by <> v_caller THEN
      RAISE EXCEPTION 'Only the room creator can delete a group room';
    END IF;
  ELSE
    -- DM rooms: either active member can delete
    IF NOT EXISTS (
      SELECT 1 FROM public.pine_chat_room_members
      WHERE chat_room_id = p_room_id
        AND member_id = v_caller
        AND left_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Not an active member of this room';
    END IF;
  END IF;

  -- Soft-delete the room
  UPDATE public.pine_chat_rooms
  SET deleted_at = now()
  WHERE id = p_room_id;

  -- End any active call sessions in this room
  UPDATE public.pine_call_sessions
  SET status = 'ended', ended_at = now()
  WHERE chat_room_id = p_room_id
    AND status IN ('calling', 'connecting', 'connected');
END;
$fn$;

-- ============================================================================
-- REVOKE/GRANT — Authenticated users only
-- ============================================================================

REVOKE EXECUTE ON FUNCTION leave_chat_room(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION leave_chat_room(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION transfer_room_ownership(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION transfer_room_ownership(UUID, UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION rename_chat_room(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rename_chat_room(UUID, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION delete_chat_room(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_chat_room(UUID) TO authenticated;
