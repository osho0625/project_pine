import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildPushHTTPRequest } from 'npm:@pushforge/builder@latest';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WEBHOOK_SECRET = Deno.env.get('WEBHOOK_SECRET')!;
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:pine@example.com';
const PUSH_SUPPRESS_TTL = 30;

// VAPID key conversion helpers
function base64urlToUint8Array(b64: string): Uint8Array {
  const base64 = b64.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (base64.length % 4)) % 4;
  const binary = atob(base64 + '='.repeat(pad));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function uint8ArrayToBase64url(arr: Uint8Array): string {
  let binary = '';
  for (const byte of arr) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function vapidKeysToJWK(priv: string, pub: string): JsonWebKey {
  const rawPub = base64urlToUint8Array(pub);
  return {
    alg: 'ES256', key_ops: ['sign'], ext: true, kty: 'EC', crv: 'P-256',
    x: uint8ArrayToBase64url(rawPub.slice(1, 33)),
    y: uint8ArrayToBase64url(rawPub.slice(33, 65)),
    d: priv,
  };
}

Deno.serve(async (req) => {
  if (req.headers.get('X-Webhook-Secret') !== WEBHOOK_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const { record } = await req.json();
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const privateJWK = vapidKeysToJWK(VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY);

    // Get room members excluding sender
    const { data: members } = await supabase
      .from('pine_chat_room_members')
      .select('member_id')
      .eq('chat_room_id', record.chat_room_id)
      .is('left_at', null)
      .neq('member_id', record.sender_id);

    if (!members || members.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), { status: 200 });
    }

    // Get sender name
    const { data: sender } = await supabase
      .from('pine_members')
      .select('display_name')
      .eq('id', record.sender_id)
      .single();

    const senderName = sender?.display_name || 'Pine';
    const preview = record.message_type === 'text'
      ? (record.content || '').substring(0, 100)
      : '\ud83d\udcf7 \u753b\u50cf';

    let sentCount = 0;

    for (const member of members) {
      try {
        // Check eligibility
        const { data: memberInfo } = await supabase
          .from('pine_members')
          .select('last_seen_at, active_room_id')
          .eq('id', member.member_id)
          .single();

        if (memberInfo) {
          const age = memberInfo.last_seen_at
            ? (Date.now() - new Date(memberInfo.last_seen_at).getTime()) / 1000
            : Infinity;
          if (memberInfo.active_room_id === record.chat_room_id && age < PUSH_SUPPRESS_TTL) continue;
        }

        // Get unread count
        const { data: unreadCount } = await supabase.rpc('calculate_unread_count', {
          p_member_id: member.member_id,
        });

        // Get push subscriptions
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

        for (const sub of subs) {
          try {
            const subscription = {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
            };

            const { endpoint, headers, body } = await buildPushHTTPRequest({
              privateJWK,
              subscription,
              message: {
                payload: JSON.parse(payload),
                adminContact: VAPID_SUBJECT,
                options: { ttl: 86400, urgency: 'high' },
              },
            });

            const response = await fetch(endpoint, { method: 'POST', headers, body });

            if (response.status === 410 || response.status === 404) {
              await supabase.from('pine_push_subscriptions').delete().eq('id', sub.id);
            } else if (response.ok) {
              sentCount++;
            }
          } catch (e) {
            console.error('Push send error:', e);
          }
        }
      } catch (e) {
        console.error('Member processing error:', e);
      }
    }

    return new Response(JSON.stringify({ sent: sentCount }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('push-notify error:', e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
