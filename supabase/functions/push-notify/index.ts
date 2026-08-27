import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WEBHOOK_SECRET = Deno.env.get('WEBHOOK_SECRET')!;
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:pine@example.com';
const PUSH_SUPPRESS_TTL_SECONDS = 30;

Deno.serve(async (req) => {
  // Verify webhook secret
  const requestSecret = req.headers.get('X-Webhook-Secret');
  if (requestSecret !== WEBHOOK_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const { record } = await req.json();
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get room members (excluding sender)
    const { data: members } = await supabase
      .from('pine_chat_room_members')
      .select('member_id')
      .eq('chat_room_id', record.chat_room_id)
      .is('left_at', null)
      .neq('member_id', record.sender_id);

    if (!members || members.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get sender info
    const { data: sender } = await supabase
      .from('pine_members')
      .select('display_name')
      .eq('id', record.sender_id)
      .single();

    const senderName = sender?.display_name || 'Unknown';
    const preview = record.message_type === 'text'
      ? (record.content || '').substring(0, 100)
      : '📷 画像';

    let sentCount = 0;

    for (const member of members) {
      try {
        // Check eligibility (suppress if member is actively viewing the room)
        const { data: memberInfo } = await supabase
          .from('pine_members')
          .select('last_seen_at, active_room_id')
          .eq('id', member.member_id)
          .single();

        if (memberInfo) {
          const lastSeenAge = memberInfo.last_seen_at
            ? (Date.now() - new Date(memberInfo.last_seen_at).getTime()) / 1000
            : Infinity;
          const isViewingRoom = memberInfo.active_room_id === record.chat_room_id;
          const isRecentlyActive = lastSeenAge < PUSH_SUPPRESS_TTL_SECONDS;

          if (isViewingRoom && isRecentlyActive) continue; // Skip push
        }

        // Calculate unread count via service-only RPC
        const { data: unreadCount } = await supabase.rpc('calculate_unread_count', {
          p_member_id: member.member_id,
        });

        // Get push subscriptions for this member
        const { data: subs } = await supabase
          .from('pine_push_subscriptions')
          .select('id, endpoint, keys_p256dh, keys_auth')
          .eq('member_id', member.member_id);

        if (!subs || subs.length === 0) continue;

        const payload = JSON.stringify({
          title: senderName,
          body: preview,
          room_id: record.chat_room_id,
          unread_count: unreadCount ?? 0,
        });

        // Send push to all subscriptions for this member
        for (const sub of subs) {
          try {
            const pushResult = await sendWebPush(sub, payload);
            if (pushResult === 'gone') {
              // 410 Gone or 404: delete stale subscription
              await supabase
                .from('pine_push_subscriptions')
                .delete()
                .eq('id', sub.id);
            } else {
              sentCount++;
            }
          } catch (pushErr) {
            console.error(`Push send error for sub ${sub.id}:`, pushErr);
          }
        }
      } catch (memberErr) {
        console.error(`Error processing member ${member.member_id}:`, memberErr);
        // Continue with next member
      }
    }

    return new Response(JSON.stringify({ sent: sentCount }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('push-notify error:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

/**
 * Send a Web Push notification using the Web Push protocol.
 * Returns 'ok' on success, 'gone' if subscription is stale (410/404), throws on other errors.
 *
 * Note: Production implementation requires proper VAPID signing and payload encryption
 * using a web-push compatible library. VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and
 * VAPID_SUBJECT are available for signing. This is a simplified implementation
 * showing the expected interface — for MVP testing with permissive push services.
 */
async function sendWebPush(
  sub: { endpoint: string; keys_p256dh: string; keys_auth: string },
  payload: string
): Promise<'ok' | 'gone'> {
  // TODO: Implement full Web Push with VAPID authentication and payload encryption
  // (requires crypto operations for JWT signing + ECDH content encryption)
  // For MVP, direct POST to endpoint — works for testing with permissive push services
  const response = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'TTL': '86400',
      // In production: add Authorization (VAPID JWT), Crypto-Key headers
      // These require proper web-push encryption which needs a dedicated library
    },
    body: payload, // In production: encrypted payload using keys_p256dh + keys_auth
  });

  if (response.status === 410 || response.status === 404) {
    return 'gone';
  }
  if (!response.ok) {
    throw new Error(`Push failed: ${response.status} ${response.statusText}`);
  }
  return 'ok';
}
