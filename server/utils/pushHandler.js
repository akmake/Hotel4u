import webpush from 'web-push';
import Subscription from '../models/Subscription.js';

// =================================================================
// 🔑 VAPID Keys — configured lazily on first use
// =================================================================
let _vapidConfigured = false;

function ensureVapidConfigured() {
    if (_vapidConfigured) return;
    const publicVapidKey = process.env.VAPID_PUBLIC_KEY;
    const privateVapidKey = process.env.VAPID_PRIVATE_KEY;
    const adminEmail = process.env.VAPID_EMAIL || 'mailto:admin@zipori.com';

    if (!publicVapidKey || !privateVapidKey) {
        console.error("❌ CRITICAL: VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set in environment variables!");
        return;
    }
    try {
        webpush.setVapidDetails(adminEmail, publicVapidKey, privateVapidKey);
        _vapidConfigured = true;
    } catch (error) {
        console.warn("❌ Warning: VAPID keys configuration failed:", error.message);
    }
}

export const getPublicKey = () => process.env.VAPID_PUBLIC_KEY;

/**
 * שולח התראה למשתמש ספציפי (עבור צ'אט)
 */
export const sendPushToUser = async (userId, payload) => {
    ensureVapidConfigured();
    try {
        const subscriptions = await Subscription.find({ user: userId });

        if (subscriptions.length === 0) return;

        const notificationPayload = JSON.stringify({
            title: payload.title || 'הודעה חדשה',
            body: payload.body || 'קיבלת הודעה חדשה',
            url: payload.url || '/chat',
            icon: '/favicon.svg'
        });

        const promises = subscriptions.map(sub => {
            const pushConfig = {
                endpoint: sub.endpoint,
                keys: { auth: sub.keys.auth, p256dh: sub.keys.p256dh }
            };

            return webpush.sendNotification(pushConfig, notificationPayload)
                .catch(async (err) => {
                    // ✅ תיקון: הוספת await למחיקת מנויים פגי תוקף
                    if (err.statusCode === 410 || err.statusCode === 404) {
                        await Subscription.findByIdAndDelete(sub._id);
                    }
                });
        });

        await Promise.all(promises);
    } catch (error) {
        console.error('Error sending user push:', error);
    }
};

/**
 * שולח הודעת Push לכל המנויים (עבור לידים/הודעות מערכת)
 */
export const sendPushToAll = async (payload) => {
  ensureVapidConfigured();
  const subscriptions = await Subscription.find({});
  if (subscriptions.length === 0) return;

  const notificationPayload = JSON.stringify({
    title: payload.title || 'הודעה חדשה',
    body: payload.body || 'יש לך עדכון במערכת',
    url: payload.url || '/',
    icon: '/favicon.svg'
  });

  const promises = subscriptions.map(sub => {
    const pushConfig = {
      endpoint: sub.endpoint,
      keys: { auth: sub.keys.auth, p256dh: sub.keys.p256dh }
    };

    return webpush.sendNotification(pushConfig, notificationPayload)
      .catch(async (err) => {
        // ✅ תיקון: הוספת await למחיקת מנויים פגי תוקף
        if (err.statusCode === 410 || err.statusCode === 404) {
          await Subscription.findByIdAndDelete(sub._id);
        }
      });
  });

  await Promise.all(promises);
};