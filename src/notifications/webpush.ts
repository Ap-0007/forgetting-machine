import webpush from 'web-push';
import { query, queryOne } from '../lib/db';
import { PushSubscriptionRecord } from '../types/index';

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
  process.env.VAPID_PUBLIC_KEY  || '',
  process.env.VAPID_PRIVATE_KEY || '',
);

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

function isQuietHours(timezone: string): boolean {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    });
    const hour = parseInt(formatter.format(new Date()), 10);
    return hour >= 22 || hour < 8;
  } catch {
    return false; // unknown timezone → allow
  }
}

async function isUserInactive(userId: string): Promise<boolean> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);
  const recent = await queryOne<{ count: string }>(
    `SELECT COUNT(*) as count FROM surface_events
      WHERE user_id = $1 AND surfaced_at >= $2`,
    [userId, sevenDaysAgo],
  );
  return parseInt(recent?.count ?? '0') === 0;
}

export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  const subs = await query<PushSubscriptionRecord>(
    'SELECT * FROM push_subscriptions WHERE user_id = $1',
    [userId],
  );
  if (subs.length === 0) return;

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const todayCount = await queryOne<{ count: string }>(
    `SELECT COUNT(*) as count FROM surface_events
      WHERE user_id = $1 AND surfaced_at >= $2`,
    [userId, dayStart],
  );
  if (parseInt(todayCount?.count ?? '0') >= 3) return;

  const inactive = await isUserInactive(userId);

  for (const sub of subs) {
    if (isQuietHours(sub.timezone)) continue;

    const finalPayload = inactive
      ? { ...payload, title: 'Daily digest', body: 'You have thoughts waiting to resurface.' }
      : payload;

    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(finalPayload),
      );
    } catch (err: unknown) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 410) {
        // Subscription expired — delete it
        await query('DELETE FROM push_subscriptions WHERE endpoint = $1', [sub.endpoint]);
        console.log(`[webpush] deleted stale subscription for user ${userId}`);
      } else {
        console.error(`[webpush] send failed for user ${userId}:`, (err as Error).message);
      }
    }
  }
}

export async function saveSubscription(
  userId: string,
  endpoint: string,
  p256dh: string,
  auth: string,
  timezone: string,
): Promise<void> {
  await query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, timezone)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint)
     DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh,
                   auth = EXCLUDED.auth, timezone = EXCLUDED.timezone`,
    [userId, endpoint, p256dh, auth, timezone],
  );
}

export async function deleteSubscription(userId: string, endpoint: string): Promise<void> {
  await query(
    'DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2',
    [userId, endpoint],
  );
}
