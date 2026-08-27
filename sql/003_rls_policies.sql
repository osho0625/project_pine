-- ============================================================================
-- Pine Chat App — Row Level Security Policies
-- ============================================================================
-- All business-state mutations go through SECURITY DEFINER RPCs.
-- RLS policies control READ access and user-owned auxiliary data CRUD.
-- ============================================================================

-- ============================================================================
-- pine_members
-- ============================================================================
-- SELECT: own record OR shares any active room with the target member
-- No INSERT policy (only accept_invite RPC creates records)
-- No UPDATE policy (presence updates via update_presence RPC only)
-- No DELETE policy
-- ============================================================================

CREATE POLICY "pine_members_select"
  ON pine_members
  FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR shares_any_room(pine_members.id)
  );

-- ============================================================================
-- pine_chat_rooms
-- ============================================================================
-- SELECT: not soft-deleted AND caller is active member of the room
-- No INSERT/UPDATE/DELETE policies (all via RPCs)
-- ============================================================================

CREATE POLICY "pine_chat_rooms_select"
  ON pine_chat_rooms
  FOR SELECT
  TO authenticated
  USING (
    deleted_at IS NULL
    AND is_active_room_member(pine_chat_rooms.id, auth.uid())
  );

-- ============================================================================
-- pine_chat_room_members
-- ============================================================================
-- SELECT: caller is active member of the same room
-- No INSERT/UPDATE/DELETE policies (all via RPCs)
-- ============================================================================

CREATE POLICY "pine_chat_room_members_select"
  ON pine_chat_room_members
  FOR SELECT
  TO authenticated
  USING (
    is_active_room_member(pine_chat_room_members.chat_room_id, auth.uid())
  );

-- ============================================================================
-- pine_messages
-- ============================================================================
-- SELECT: caller is active member of the room AND message was created after
--         the caller joined (uses inline subquery for joined_at boundary check)
-- No INSERT policy (all via send_message RPC)
-- No UPDATE/DELETE policies
-- ============================================================================

CREATE POLICY "pine_messages_select"
  ON pine_messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM pine_chat_room_members
      WHERE chat_room_id = pine_messages.chat_room_id
        AND member_id = auth.uid()
        AND left_at IS NULL
        AND pine_messages.created_at >= joined_at
    )
  );

-- ============================================================================
-- pine_read_status
-- ============================================================================
-- ALL (SELECT, INSERT, UPDATE, DELETE): own record AND active room member
-- WITH CHECK: same conditions for INSERT/UPDATE validation
-- ============================================================================

CREATE POLICY "pine_read_status_all"
  ON pine_read_status
  FOR ALL
  TO authenticated
  USING (
    member_id = auth.uid()
    AND is_active_room_member(chat_room_id, auth.uid())
  )
  WITH CHECK (
    member_id = auth.uid()
    AND is_active_room_member(chat_room_id, auth.uid())
  );

-- ============================================================================
-- pine_push_subscriptions
-- ============================================================================
-- ALL (SELECT, INSERT, UPDATE, DELETE): own subscriptions only
-- WITH CHECK: same condition for INSERT/UPDATE validation
-- ============================================================================

CREATE POLICY "pine_push_subscriptions_all"
  ON pine_push_subscriptions
  FOR ALL
  TO authenticated
  USING (
    member_id = auth.uid()
  )
  WITH CHECK (
    member_id = auth.uid()
  );

-- ============================================================================
-- pine_call_sessions
-- ============================================================================
-- SELECT: caller or callee of the session
-- No INSERT/UPDATE/DELETE policies (all via RPCs)
-- ============================================================================

CREATE POLICY "pine_call_sessions_select"
  ON pine_call_sessions
  FOR SELECT
  TO authenticated
  USING (
    caller_id = auth.uid()
    OR callee_id = auth.uid()
  );

-- ============================================================================
-- pine_invites
-- ============================================================================
-- No policies for clients. All operations via Edge Functions (service_role)
-- or RPCs. No SELECT/INSERT/UPDATE/DELETE policies.
-- ============================================================================

-- (No policies — all invite operations use service_role or SECURITY DEFINER RPCs)

-- ============================================================================
-- Realtime Authorization (realtime.messages)
-- ============================================================================
-- Controls access to private Broadcast channels for WebRTC call signaling.
-- Only caller/callee of an active call session can subscribe to or broadcast
-- on the call:{session_id} channel.
--
-- Topic format: 'call:________-____-____-____-____________' (UUID pattern)
-- Validates topic format before UUID cast to prevent SQL errors.
-- Uses explicit allow-list of active statuses (not NOT IN) to prevent
-- future status additions from inadvertently granting access.
-- ============================================================================

CREATE POLICY "realtime_call_broadcast_select"
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    realtime.messages.extension = 'broadcast'
    AND realtime.topic() LIKE 'call:________-____-____-____-____________'
    AND EXISTS (
      SELECT 1 FROM public.pine_call_sessions
      WHERE id = (split_part(realtime.topic(), ':', 2))::uuid
        AND (caller_id = auth.uid() OR callee_id = auth.uid())
        AND status IN ('calling', 'connecting', 'connected')
    )
  );

CREATE POLICY "realtime_call_broadcast_insert"
  ON realtime.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    realtime.messages.extension = 'broadcast'
    AND realtime.topic() LIKE 'call:________-____-____-____-____________'
    AND EXISTS (
      SELECT 1 FROM public.pine_call_sessions
      WHERE id = (split_part(realtime.topic(), ':', 2))::uuid
        AND (caller_id = auth.uid() OR callee_id = auth.uid())
        AND status IN ('calling', 'connecting', 'connected')
    )
  );
