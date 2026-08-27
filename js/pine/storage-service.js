// Pine Storage Service — image upload/download via Supabase Storage
const StorageService = {
  async uploadImage(roomId, file) {
    // Validate MIME type
    if (!PINE_CONFIG.ALLOWED_IMAGE_TYPES.includes(file.type)) {
      throw new Error(`許可されていないファイル形式です: ${file.type}`);
    }

    // Validate file size
    if (file.size > PINE_CONFIG.IMAGE_MAX_SIZE) {
      throw new Error(`ファイルサイズが上限(${PINE_CONFIG.IMAGE_MAX_SIZE / 1024 / 1024}MB)を超えています`);
    }

    // Generate client_message_id for storage path
    const clientMessageId = crypto.randomUUID();

    // Extract extension from MIME type
    const extMap = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
    const extension = extMap[file.type] || 'jpg';

    // Storage path: {room_id}/{client_message_id}.{ext}
    const storagePath = `${roomId}/${clientMessageId}.${extension}`;

    // Upload to pine-chat bucket
    const { error } = await pineSupabase.storage
      .from('pine-chat')
      .upload(storagePath, file, {
        contentType: file.type,
        upsert: false,
      });

    if (error) throw error;

    return { storagePath, clientMessageId };
  },

  async getSignedUrl(storagePath, expiresIn = PINE_CONFIG.SIGNED_URL_TTL) {
    const { data, error } = await pineSupabase.storage
      .from('pine-chat')
      .createSignedUrl(storagePath, expiresIn);

    if (error) throw error;
    return data.signedUrl;
  },

  async deleteObject(storagePath) {
    const { error } = await pineSupabase.storage
      .from('pine-chat')
      .remove([storagePath]);

    if (error) throw error;
  },
};
