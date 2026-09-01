// Pine Push Service - manages Web Push subscription lifecycle
const PushService = {
  _vapidPublicKey: null,

  async getVapidPublicKey() {
    if (this._vapidPublicKey) return this._vapidPublicKey;
    if (PINE_CONFIG.VAPID_PUBLIC_KEY) {
      this._vapidPublicKey = PINE_CONFIG.VAPID_PUBLIC_KEY;
    } else {
      const { data, error } = await pineSupabase.functions.invoke('vapid-public-key');
      if (error) throw error;
      this._vapidPublicKey = data.vapid_public_key;
    }
    return this._vapidPublicKey;
  },

  _urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  },

  async subscribe() {
    if (!('PushManager' in window)) {
      throw new Error('Push notifications not supported');
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      throw new Error('Notification permission denied');
    }

    const vapidKey = await this.getVapidPublicKey();
    const registration = await navigator.serviceWorker.ready;

    const subscription = await registration.pushManager.subscribe({
      userVisuallyPrompted: true,
      applicationServerKey: this._urlBase64ToUint8Array(vapidKey),
    });

    // Store subscription in database
    const { data: { user } } = await pineSupabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const subJson = subscription.toJSON();
    const { error } = await pineSupabase
      .from('pine_push_subscriptions')
      .upsert({
        member_id: user.id,
        endpoint: subJson.endpoint,
        keys_p256dh: subJson.keys.p256dh,
        keys_auth: subJson.keys.auth,
        user_agent: navigator.userAgent,
        last_used_at: new Date().toISOString(),
      }, { onConflict: 'endpoint' });

    if (error) throw error;
    return subscription;
  },

  async unsubscribe() {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    if (subscription) {
      const endpoint = subscription.endpoint;

      // Remove from database
      const { error } = await pineSupabase
        .from('pine_push_subscriptions')
        .delete()
        .eq('endpoint', endpoint);

      if (error) throw error;

      // Unsubscribe from push manager
      await subscription.unsubscribe();
    }
  },

  async isSubscribed() {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return !!subscription;
  },

  getPermissionState() {
    if (!('Notification' in window)) return 'unsupported';
    return Notification.permission;
  },
};
