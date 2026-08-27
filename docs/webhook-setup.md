# Database Webhook Configuration

## push-notify Webhook

Configure in Supabase Dashboard: Database → Webhooks → Create Webhook

| Setting | Value |
|---------|-------|
| Name | `push-notify-on-message` |
| Table | `pine_messages` |
| Events | `INSERT` |
| Type | `HTTP Request` |
| Method | `POST` |
| URL | `{SUPABASE_URL}/functions/v1/push-notify` |
| Headers | `X-Webhook-Secret: {WEBHOOK_SECRET}` |
|         | `Content-Type: application/json` |

### Payload Format (automatic from Supabase)

```json
{
  "type": "INSERT",
  "table": "pine_messages",
  "record": {
    "id": "uuid",
    "chat_room_id": "uuid",
    "sender_id": "uuid",
    "client_message_id": "uuid",
    "content": "text or null",
    "message_type": "text or image",
    "storage_path": "path or null",
    "created_at": "timestamp"
  },
  "schema": "public"
}
```

### Environment Variables Required

Set in Supabase Dashboard → Edge Functions → Secrets:
- `WEBHOOK_SECRET` — shared secret for webhook authentication
- `VAPID_PUBLIC_KEY` — Web Push VAPID public key
- `VAPID_PRIVATE_KEY` — Web Push VAPID private key
- `VAPID_SUBJECT` — VAPID subject (e.g., `mailto:pine@example.com`)
