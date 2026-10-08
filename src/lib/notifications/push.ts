import webpush from 'web-push';
import { env } from '../env';

let configured = false;

function configure(): boolean {
  const e = env();
  if (!e.VAPID_PUBLIC_KEY || !e.VAPID_PRIVATE_KEY) return false;
  if (!configured) {
    webpush.setVapidDetails(e.VAPID_SUBJECT || `mailto:${e.OWNER_EMAIL ?? 'admin@localhost'}`, e.VAPID_PUBLIC_KEY, e.VAPID_PRIVATE_KEY);
    configured = true;
  }
  return true;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type PushResult =
  | { ok: true; status: number }
  | { ok: false; gone: boolean; transient: boolean; status: number | null; error: string };

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

export type PushSender = (target: PushTarget, payload: PushPayload) => Promise<PushResult>;

export const sendPush: PushSender = async (target, payload) => {
  if (!configure()) return { ok: false, gone: false, transient: false, status: null, error: 'push_not_configured' };
  try {
    const res = await webpush.sendNotification(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      JSON.stringify(payload),
      { TTL: 6 * 3600, urgency: 'high', timeout: 15000 },
    );
    return { ok: true, status: res.statusCode };
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode ?? null;
    const gone = status === 404 || status === 410;
    const transient = status == null || status === 429 || status >= 500;
    return { ok: false, gone, transient, status, error: gone ? 'subscription_expired' : `push_error_${status ?? 'network'}` };
  }
};
