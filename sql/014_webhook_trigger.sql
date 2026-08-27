-- ============================================================================
-- Push Notification Webhook Trigger (pg_net)
-- ============================================================================
-- Replaces Dashboard Webhook configuration. Uses pg_net.http_post to call
-- the push-notify Edge Function on every pine_messages INSERT.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_push_on_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, extensions
AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://snxvohbfuqdqrwygqpzl.supabase.co/functions/v1/push-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Webhook-Secret', 'IpIuIVlucaf00Jo385Yq4ChsZpPmy04Q'
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'pine_messages',
      'record', row_to_json(NEW)::jsonb,
      'schema', 'public'
    )
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER pine_messages_push_notify
  AFTER INSERT ON public.pine_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_push_on_message();
