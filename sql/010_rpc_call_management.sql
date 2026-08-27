-- ============================================================================
-- Call Management RPCs — 7 Call State Transition Functions (SECURITY DEFINER)
-- ============================================================================
-- Implements the complete call lifecycle for 1-on-1 (DM) rooms:
--   start_call, accept_call, reject_call, cancel_call,
--   end_call, fail_call, mark_call_connected
--
-- All functions use:
--   - SECURITY DEFINER SET search_path = public, pg_temp
--   - Fully-qualified table names (public.pine_call_sessions, etc.)
--   - SELECT ... FOR UPDATE for state serialization
--   - Canonical UUID ordering for deadlock prevention (start_call)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. start_call(p_room_id UUID) RETURNS JSONB
-- ----------------------------------------------------------------------------
-- Initiates a call in a 1-on-1 DM room.
-- Locks both members in canonical UUID order to prevent deadlocks.
-- Checks that neither party is already busy before creating the session.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION start_call(p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_caller UUID := auth.uid();
  v_callee UUID;
  v_room   public.pine_chat_rooms;
  v_session_id UUID;
  v_member_count INTEGER;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Verify caller is active member of this room
  IF NOT EXISTS (
    SELECT 1 FROM public.pine_chat_room_members
    WHERE chat_room_id = p_room_id AND member_id = v_caller AND left_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Not an active member of this room';
  END IF;

  -- Get room and verify it is not a group room
  SELECT * INTO v_room FROM public.pine_chat_rooms WHERE id = p_room_id;
  IF v_room.is_group = true THEN
    RAISE EXCEPTION 'Group calls not supported in MVP';
  END IF;

  -- Verify DM room has exactly 2 active members
  SELECT count(*) INTO v_member_count
  FROM public.pine_chat_room_members
  WHERE chat_room_id = p_room_id AND left_at IS NULL;

  IF v_member_count <> 2 THEN
    RAISE EXCEPTION 'DM room must have exactly 2 active members';
  END IF;

  -- Get callee (the other active member)
  SELECT member_id INTO v_callee
  FROM public.pine_chat_room_members
  WHERE chat_room_id = p_room_id AND member_id <> v_caller AND left_at IS NULL
  LIMIT 1;

  -- Lock BOTH members in canonical UUID order (deadlock prevention)
  IF v_caller < v_callee THEN
    PERFORM 1 FROM public.pine_members WHERE id = v_caller FOR UPDATE;
    PERFORM 1 FROM public.pine_members WHERE id = v_callee FOR UPDATE;
  ELSE
    PERFORM 1 FROM public.pine_members WHERE id = v_callee FOR UPDATE;
    PERFORM 1 FROM public.pine_members WHERE id = v_caller FOR UPDATE;
  END IF;

  -- Check callee not busy
  IF EXISTS (
    SELECT 1 FROM public.pine_call_sessions
    WHERE (caller_id = v_callee OR callee_id = v_callee)
      AND status IN ('calling', 'connecting', 'connected')
  ) THEN
    RETURN jsonb_build_object('status', 'busy');
  END IF;

  -- Check caller not busy
  IF EXISTS (
    SELECT 1 FROM public.pine_call_sessions
    WHERE (caller_id = v_caller OR callee_id = v_caller)
      AND status IN ('calling', 'connecting', 'connected')
  ) THEN
    RETURN jsonb_build_object('status', 'busy');
  END IF;

  -- Create call session
  INSERT INTO public.pine_call_sessions (chat_room_id, caller_id, callee_id, status)
  VALUES (p_room_id, v_caller, v_callee, 'calling')
  RETURNING id INTO v_session_id;

  RETURN jsonb_build_object(
    'status', 'ok',
    'session_id', v_session_id,
    'callee_id', v_callee
  );
END;
$fn$;

-- ----------------------------------------------------------------------------
-- 2. accept_call(p_session_id UUID) RETURNS VOID
-- ----------------------------------------------------------------------------
-- Callee accepts an incoming call. Transitions calling → connecting.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION accept_call(p_session_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_caller UUID := auth.uid();
  v_session public.pine_call_sessions;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Lock the session row
  SELECT * INTO v_session
  FROM public.pine_call_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF v_session IS NULL THEN
    RAISE EXCEPTION 'Call session not found';
  END IF;

  -- Only callee can accept
  IF v_session.callee_id <> v_caller THEN
    RAISE EXCEPTION 'Only the callee can accept the call';
  END IF;

  -- Must be in calling state
  IF v_session.status <> 'calling' THEN
    RAISE EXCEPTION 'Call is not in calling state';
  END IF;

  -- Transition to connecting
  UPDATE public.pine_call_sessions
  SET status = 'connecting'
  WHERE id = p_session_id;
END;
$fn$;

-- ----------------------------------------------------------------------------
-- 3. reject_call(p_session_id UUID) RETURNS VOID
-- ----------------------------------------------------------------------------
-- Callee rejects an incoming call. Transitions calling → ended.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reject_call(p_session_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_caller UUID := auth.uid();
  v_session public.pine_call_sessions;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Lock the session row
  SELECT * INTO v_session
  FROM public.pine_call_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF v_session IS NULL THEN
    RAISE EXCEPTION 'Call session not found';
  END IF;

  -- Only callee can reject
  IF v_session.callee_id <> v_caller THEN
    RAISE EXCEPTION 'Only the callee can reject the call';
  END IF;

  -- Must be in calling state
  IF v_session.status <> 'calling' THEN
    RAISE EXCEPTION 'Call is not in calling state';
  END IF;

  -- Transition to ended
  UPDATE public.pine_call_sessions
  SET status = 'ended', ended_at = now()
  WHERE id = p_session_id;
END;
$fn$;

-- ----------------------------------------------------------------------------
-- 4. cancel_call(p_session_id UUID) RETURNS VOID
-- ----------------------------------------------------------------------------
-- Caller cancels an outgoing call before it is answered. calling → ended.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cancel_call(p_session_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_caller UUID := auth.uid();
  v_session public.pine_call_sessions;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Lock the session row
  SELECT * INTO v_session
  FROM public.pine_call_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF v_session IS NULL THEN
    RAISE EXCEPTION 'Call session not found';
  END IF;

  -- Only caller can cancel
  IF v_session.caller_id <> v_caller THEN
    RAISE EXCEPTION 'Only the caller can cancel the call';
  END IF;

  -- Must be in calling state
  IF v_session.status <> 'calling' THEN
    RAISE EXCEPTION 'Call is not in calling state';
  END IF;

  -- Transition to ended
  UPDATE public.pine_call_sessions
  SET status = 'ended', ended_at = now()
  WHERE id = p_session_id;
END;
$fn$;

-- ----------------------------------------------------------------------------
-- 5. end_call(p_session_id UUID) RETURNS VOID
-- ----------------------------------------------------------------------------
-- Either party ends an active call. connecting/connected → ended.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION end_call(p_session_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_caller UUID := auth.uid();
  v_session public.pine_call_sessions;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Lock the session row
  SELECT * INTO v_session
  FROM public.pine_call_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF v_session IS NULL THEN
    RAISE EXCEPTION 'Call session not found';
  END IF;

  -- Either party can end
  IF v_session.caller_id <> v_caller AND v_session.callee_id <> v_caller THEN
    RAISE EXCEPTION 'Not a participant in this call';
  END IF;

  -- Must be in connecting or connected state
  IF v_session.status NOT IN ('connecting', 'connected') THEN
    RAISE EXCEPTION 'Call is not in connecting or connected state';
  END IF;

  -- Transition to ended
  UPDATE public.pine_call_sessions
  SET status = 'ended', ended_at = now()
  WHERE id = p_session_id;
END;
$fn$;

-- ----------------------------------------------------------------------------
-- 6. fail_call(p_session_id UUID) RETURNS VOID
-- ----------------------------------------------------------------------------
-- Either party marks a call as failed (network error, ICE failure, etc.).
-- Any non-terminal state → failed.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fail_call(p_session_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_caller UUID := auth.uid();
  v_session public.pine_call_sessions;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Lock the session row
  SELECT * INTO v_session
  FROM public.pine_call_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF v_session IS NULL THEN
    RAISE EXCEPTION 'Call session not found';
  END IF;

  -- Either party can fail
  IF v_session.caller_id <> v_caller AND v_session.callee_id <> v_caller THEN
    RAISE EXCEPTION 'Not a participant in this call';
  END IF;

  -- Cannot fail a call that is already terminated
  IF v_session.status IN ('ended', 'failed') THEN
    RAISE EXCEPTION 'Call already terminated';
  END IF;

  -- Transition to failed
  UPDATE public.pine_call_sessions
  SET status = 'failed', ended_at = now()
  WHERE id = p_session_id;
END;
$fn$;

-- ----------------------------------------------------------------------------
-- 7. mark_call_connected(p_session_id UUID) RETURNS VOID
-- ----------------------------------------------------------------------------
-- Either party marks the call as connected (WebRTC peer connection established).
-- connecting → connected. Idempotent: no-op if already connected.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mark_call_connected(p_session_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_caller UUID := auth.uid();
  v_session public.pine_call_sessions;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Lock the session row
  SELECT * INTO v_session
  FROM public.pine_call_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF v_session IS NULL THEN
    RAISE EXCEPTION 'Call session not found';
  END IF;

  -- Either party can mark connected
  IF v_session.caller_id <> v_caller AND v_session.callee_id <> v_caller THEN
    RAISE EXCEPTION 'Not a participant in this call';
  END IF;

  -- Idempotent: if already connected, no-op success
  IF v_session.status = 'connected' THEN
    RETURN;
  END IF;

  -- Must be in connecting state
  IF v_session.status <> 'connecting' THEN
    RAISE EXCEPTION 'Call is not in connecting state';
  END IF;

  -- Transition to connected
  UPDATE public.pine_call_sessions
  SET status = 'connected', started_at = now()
  WHERE id = p_session_id;
END;
$fn$;

-- ============================================================================
-- REVOKE/GRANT — All 7 call RPCs: authenticated only
-- ============================================================================

REVOKE EXECUTE ON FUNCTION start_call(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION start_call(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION accept_call(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accept_call(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION reject_call(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reject_call(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION cancel_call(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_call(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION end_call(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION end_call(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION fail_call(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fail_call(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION mark_call_connected(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_call_connected(UUID) TO authenticated;
