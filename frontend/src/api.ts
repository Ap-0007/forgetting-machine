import { IngestResponse, SurfaceNextResponse, ReactionResponse, GraveyardStats, UserReaction, SourceType } from './types';

const BASE = import.meta.env.VITE_API_URL || '';

async function req<T>(
  path: string,
  options: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, ...init } = options;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const body = await res.json();

  if (!res.ok) {
    const message = (body?.error?.message ?? `HTTP ${res.status}`) as string;
    const err = Object.assign(new Error(message), { code: body?.error?.code, status: res.status });
    throw err;
  }
  return body as T;
}

export const api = {
  ingest(content: string, sourceType: SourceType, token: string): Promise<IngestResponse> {
    return req<IngestResponse>('/api/ingest', {
      method: 'POST',
      body: JSON.stringify({ content, source_type: sourceType }),
      token,
    });
  },

  nextSurface(token: string): Promise<SurfaceNextResponse> {
    return req<SurfaceNextResponse>('/api/surface/next', { token });
  },

  react(
    surfaceEventId: string,
    reaction: UserReaction,
    timeToReactMs: number,
    token: string,
  ): Promise<ReactionResponse> {
    return req<ReactionResponse>(`/api/surface/${surfaceEventId}/react`, {
      method: 'POST',
      body: JSON.stringify({ reaction, time_to_react_ms: timeToReactMs }),
      token,
    });
  },

  graveyardStats(token: string): Promise<GraveyardStats> {
    return req<GraveyardStats>('/api/graveyard/stats', { token });
  },

  subscribePush(
    sub: PushSubscriptionJSON,
    timezone: string,
    token: string,
  ): Promise<{ ok: boolean }> {
    return req<{ ok: boolean }>('/api/notifications/subscribe', {
      method: 'POST',
      body: JSON.stringify({
        endpoint: sub.endpoint,
        keys: sub.keys,
        timezone,
      }),
      token,
    });
  },

  unsubscribePush(endpoint: string, token: string): Promise<{ ok: boolean }> {
    return req<{ ok: boolean }>('/api/notifications/unsubscribe', {
      method: 'DELETE',
      body: JSON.stringify({ endpoint }),
      token,
    });
  },

  excavate(token: string): Promise<{ ok: boolean; message: string }> {
    return req<{ ok: boolean; message: string }>('/api/graveyard/excavate', {
      method: 'POST',
      body: JSON.stringify({ confirm: 'EXCAVATE' }),
      token,
    });
  },
};

// ── Service worker / push helpers ─────────────────────────────────────────────

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch {
    return null;
  }
}

export async function subscribeToPush(token: string): Promise<boolean> {
  const reg = await registerServiceWorker();
  if (!reg) return false;

  const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string;
  if (!vapidKey) return false;

  try {
    const existing = await reg.pushManager.getSubscription();
    const sub = existing ?? await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    });

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    await api.subscribePush(sub.toJSON() as PushSubscriptionJSON, timezone, token);
    return true;
  } catch {
    return false;
  }
}

export async function unsubscribeFromPush(token: string): Promise<boolean> {
  const reg = await navigator.serviceWorker?.getRegistration();
  if (!reg) return false;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return true;
  await api.unsubscribePush(sub.endpoint, token);
  await sub.unsubscribe();
  return true;
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64     = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = window.atob(b64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}
