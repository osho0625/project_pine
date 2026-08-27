import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BASE_URL = Deno.env.get('BASE_URL') || '';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    // Verify caller exists in pine_members
    const { data: member, error: memberError } = await supabase
      .from('pine_members')
      .select('id')
      .eq('id', user.id)
      .single();

    if (memberError || !member) {
      return new Response(
        JSON.stringify({ error: 'Not a registered member' }),
        { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body — accept both 'invited_email' and 'email' for compatibility
    const body = await req.json();
    const email = body.invited_email || body.email;
    if (!email || typeof email !== 'string') {
      return new Response(
        JSON.stringify({ error: 'invited_email is required' }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Rate limit: max 5 invites per member per day
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error: countError } = await supabase
      .from('pine_invites')
      .select('*', { count: 'exact', head: true })
      .eq('created_by', user.id)
      .gte('created_at', twentyFourHoursAgo);

    if (countError) {
      return new Response(
        JSON.stringify({ error: 'Failed to check rate limit' }),
        { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    if ((count ?? 0) >= 5) {
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded: maximum 5 invites per day' }),
        { status: 429, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    // Generate 256-bit random code
    const randomBytes = crypto.getRandomValues(new Uint8Array(32));
    const inviteCode = Array.from(randomBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    // SHA-256 hash the code
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(inviteCode));
    const codeHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    // Calculate expiration (7 days)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    // INSERT into pine_invites
    const { error: insertError } = await supabase
      .from('pine_invites')
      .insert({
        code_hash: codeHash,
        created_by: user.id,
        invited_email: normalizedEmail,
        expires_at: expiresAt,
        status: 'active',
      });

    if (insertError) {
      console.error('Insert invite error:', insertError);
      return new Response(
        JSON.stringify({ error: 'Failed to create invite' }),
        { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    // Build invite URL
    const inviteUrl = `${BASE_URL}/pages/pine.html#invite?code=${inviteCode}`;

    return new Response(
      JSON.stringify({ invite_url: inviteUrl, expires_at: expiresAt }),
      { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('generate-invite error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }
});
