-- ============================================================================
-- Storage Bucket: pine-chat (Private)
-- ============================================================================
-- Private bucket for chat images. MIME: jpeg, png, webp. Max 10MB.
-- Access controlled via Storage RLS policies using is_active_room_member helper.
-- Path format: {room_id}/{client_message_id}.{ext}
-- ============================================================================

-- NOTE: Bucket creation is done via Supabase Dashboard or CLI:
--   supabase storage create pine-chat --public=false
--   Bucket config: allowed_mime_types = ['image/jpeg', 'image/png', 'image/webp']
--                  file_size_limit = 10485760 (10MB)

-- Storage RLS Policies

-- SELECT: Active room members can read images in their room's folder
CREATE POLICY "pine_chat_storage_select"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'pine-chat'
    AND is_active_room_member((storage.foldername(name))[1]::uuid, auth.uid())
  );

-- INSERT: Active room members can upload images to their room's folder
CREATE POLICY "pine_chat_storage_insert"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'pine-chat'
    AND is_active_room_member((storage.foldername(name))[1]::uuid, auth.uid())
  );

-- DELETE: Active room members can delete their own uploads (for orphan cleanup on send failure)
CREATE POLICY "pine_chat_storage_delete"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'pine-chat'
    AND is_active_room_member((storage.foldername(name))[1]::uuid, auth.uid())
    AND owner = auth.uid()
  );
