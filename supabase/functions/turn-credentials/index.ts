import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TURN_SHARED_SECRET = Deno.env.get('TURN_SHARED_SECRET')!;
const TURN_SERVER_URL = Deno.env.get('TURN_SERVER_URL')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TTL = 3600; // 1 hour

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    // Verify JWT auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Verify the JWT token and get user
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        { status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    // Generate time-limited TURN credentials (coturn HMAC-SHA1 format)
    const expiresAt = Math.floor(Date.now() / 1000) + TTL;
    const username = `${expiresAt}:${user.id}`;

    // HMAC-SHA1 using Web Crypto API
    const encoder = new TextEncoder();
    const keyData = encoder.encode(TURN_SHARED_SECRET);
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    );

    const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(username));
    const credential = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));

    // Build TURNS URL (TLS variant)
    const turnsUrl = TURN_SERVER_URL.replace(/^turn:/, 'turns:').replace(/\?transport=udp/, '?transport=tcp');

    return new Response(
      JSON.stringify({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          {
            urls: [TURN_SERVER_URL, turnsUrl],
            username,
            credential,
          },
        ],
        ttl: TTL,
      }),
      { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('turn-credentials error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }
});
