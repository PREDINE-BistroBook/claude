import { api } from './api';

/** Resolves to null after `ms` (a service worker that never answers mustn't hold anything up). */
const after = (ms: number) => new Promise<null>((resolve) => setTimeout(() => resolve(null), ms));

/** This browser's push subscription, if it has a service worker and one; null otherwise. Never throws. */
export async function currentPushSubscription(ms = 2000): Promise<PushSubscription | null> {
  try {
    if (!('serviceWorker' in navigator)) return null;
    const reg = await Promise.race([navigator.serviceWorker.getRegistration(), after(ms)]);
    if (!reg?.pushManager) return null;
    return (await Promise.race([reg.pushManager.getSubscription(), after(ms)])) ?? null;
  } catch {
    return null;
  }
}

/**
 * Signing out: this browser stops getting push — the server forgets the
 * subscription and the browser drops it — so the next person on a shared
 * computer, or whoever finds a signed-out phone, sees none of our message
 * previews or calls to the office. (The server also deletes the subscriptions
 * of a session that ends; this covers the browser's side.) Never throws.
 */
export async function stopPushOnThisBrowser(): Promise<void> {
  const sub = await currentPushSubscription();
  if (!sub) return;
  try {
    await api.delete(`/push/subscribe?endpoint=${encodeURIComponent(sub.endpoint)}`);
  } catch {
    /* signed out already, or offline: the server drops it with the session */
  }
  try {
    await sub.unsubscribe();
  } catch {
    /* nothing more to do */
  }
}
