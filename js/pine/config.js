// Pine App Configuration
const PINE_CONFIG = {
  BASE_PATH: new URL(document.currentScript.src).pathname.split('/js/')[0] || '',
  SUPABASE_URL: 'https://snxvohbfuqdqrwygqpzl.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_zHuDwitjvIh9z-Vb-f-GLg_SEr6rVXH',
  PUSH_SUPPRESS_TTL: 30, // seconds
  HEARTBEAT_INTERVAL: 15000, // 15 seconds
  OUTBOX_STUCK_TIMEOUT: 5 * 60 * 1000, // 5 minutes
  MAX_MESSAGE_LENGTH: 4000,
  MAX_DISPLAY_NAME_LENGTH: 50,
  MAX_ROOM_NAME_LENGTH: 100,
  IMAGE_MAX_SIZE: 10 * 1024 * 1024, // 10MB
  ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
  SIGNED_URL_TTL: 3600, // 1 hour
};
