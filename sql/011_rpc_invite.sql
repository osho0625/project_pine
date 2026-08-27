-- ============================================================================
-- Invite RPCs — lock_invite & accept_invite (SECURITY DEFINER)
-- ============================================================================
-- lock_invite: Service-role only. Called by validate-invite Edge Function.
--   Atomically locks an active invite by setting status='processing'.
-- accept_invite: Authenticated only. Called by client after OTP verification.
--   Verifies invite state, email match, creates pine_members, marks used.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- lock_invite(p_code_hash TEXT, p_email TEXT) RETURNS pine_invites
-- ----------------------------------------------------------------------------
-- Called by validate-invite Edge Function (service_role).
-- Atomic UPDATE: locks invite if code_hash matches, status='active',
-- not expired, and invited_email matches provided email.
-- Returns NULL if no matching active invite or email mismatch.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION lock_invite(
  p_code_hash TEXT,
  p_email TEXT
)
RETURNS pine_invites
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_result public.pine_invites;
BEGIN
  UPDATE public.pine_invites
  SET status = 'processing',
      updated_at = now()
  WHERE code_hash = p_code_hash
    AND status = 'active'
    AND expires_at >= now()
    AND invited_email = lower(trim(p_email))
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$fn$;

-- Permission: service_role only
REVOKE EXECUTE ON FUNCTION lock_invite(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION lock_invite(TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION lock_invite(TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION lock_invite(TEXT, TEXT) TO service_role;

-- ----------------------------------------------------------------------------
-- accept_invite(p_invite_code TEXT, p_display_name TEXT) RETURNS UUID
-- ----------------------------------------------------------------------------
-- Called by client after OTP authentication.
-- Verifies invite is in 'processing' state, not timed out, not expired,
-- email matches auth.users.email, then creates pine_members and marks used.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION accept_invite(
  p_invite_code TEXT,
  p_display_name TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_caller UUID := auth.uid();
  v_code_hash TEXT;
  v_invite public.pine_invites;
  v_user_email TEXT;
  v_trimmed_name TEXT;
BEGIN
  -- Validate caller is authenticated
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Validate display_name
  v_trimmed_name := trim(p_display_name);
  IF v_trimmed_name IS NULL OR char_length(v_trimmed_name) = 0 THEN
    RAISE EXCEPTION 'Display name is required';
  END IF;
  IF char_length(v_trimmed_name) > 50 THEN
    RAISE EXCEPTION 'Display name must be 50 characters or less';
  END IF;

  -- Hash invite code
  v_code_hash := encode(digest(p_invite_code, 'sha256'), 'hex');

  -- Select invite row with row lock to prevent concurrent acceptance
  SELECT * INTO v_invite
  FROM public.pine_invites
  WHERE code_hash = v_code_hash
  FOR UPDATE;

  -- Check invite exists
  IF v_invite IS NULL THEN
    RAISE EXCEPTION 'Invalid invite code';
  END IF;

  -- Verify status is 'processing'
  IF v_invite.status <> 'processing' THEN
    RAISE EXCEPTION 'Invite is not in processing state';
  END IF;

  -- Check timeout: if processing for more than 10 minutes, revert to active
  IF v_invite.updated_at < now() - interval '10 minutes' THEN
    UPDATE public.pine_invites
    SET status = 'active',
        updated_at = now()
    WHERE id = v_invite.id;
    RAISE EXCEPTION 'Invite processing has timed out';
  END IF;

  -- Check expiry
  IF v_invite.expires_at < now() THEN
    UPDATE public.pine_invites
    SET status = 'expired',
        updated_at = now()
    WHERE id = v_invite.id;
    RAISE EXCEPTION 'Invite has expired';
  END IF;

  -- Check member doesn't already exist
  IF EXISTS (SELECT 1 FROM public.pine_members WHERE id = v_caller) THEN
    RAISE EXCEPTION 'Member already exists';
  END IF;

  -- Verify email: get authenticated user's email from auth.users
  SELECT email INTO v_user_email
  FROM auth.users
  WHERE id = v_caller;

  IF lower(trim(v_user_email)) <> lower(trim(v_invite.invited_email)) THEN
    RAISE EXCEPTION 'Email does not match invited email';
  END IF;

  -- Create pine_members record
  INSERT INTO public.pine_members (id, display_name)
  VALUES (v_caller, v_trimmed_name);

  -- Mark invite as used
  UPDATE public.pine_invites
  SET status = 'used',
      used_at = now(),
      created_member_id = v_caller,
      updated_at = now()
  WHERE id = v_invite.id;

  RETURN v_caller;
END;
$fn$;

-- Permission: authenticated only
REVOKE EXECUTE ON FUNCTION accept_invite(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accept_invite(TEXT, TEXT) TO authenticated;
