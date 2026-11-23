/*
 * Push notifications for the staff app's service worker. vite-plugin-pwa's
 * generated sw.js loads this file with importScripts (vite.config.ts →
 * workbox.importScripts); the precache and the update behaviour (skipWaiting,
 * clientsClaim) stay in the generated part.
 *
 * The server sends JSON (PushPayload in src/shared/schemas/notifications.ts):
 *   { title, body, link, kind: 'message' | 'summon' | 'summon_answer' | 'cafe_order' | 'cafe_status' | 'test', tag, quiet? }
 * A call to the office stays on screen until it's touched and vibrates;
 * message notifications share a tag per conversation, so a new one replaces the last.
 * A new cafeteria order (to whoever serves) vibrates and stays too; what became of
 * an order (to whoever ordered) shares a tag per order: "Delivered" replaces "On the way".
 * `quiet: true` replaces the notification with the same tag silently and lets it go
 * (a new order that was taken or cancelled meanwhile: the phone mustn't keep
 * "New order from …" on screen for an order that no longer waits).
 */
/* global self, clients */

const DEFAULT_TITLE = 'Turquoise Studio';

/** Only same-app paths ("/messages/3"); anything else opens the app's start page. */
function safeLink(link) {
  if (typeof link !== 'string' || link.length > 500) return '/';
  if (!link.startsWith('/') || link.startsWith('//') || link.includes('\\')) return '/';
  return link;
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = typeof data.title === 'string' && data.title ? data.title : DEFAULT_TITLE;
  const tag = typeof data.tag === 'string' && data.tag ? data.tag : undefined;
  const options = {
    body: typeof data.body === 'string' ? data.body : '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    dir: 'auto',
    data: { link: safeLink(data.link) },
  };
  const quiet = data.quiet === true;
  if (tag) {
    options.tag = tag;
    // A replaced notification (same conversation) still alerts — unless it is only an update.
    options.renotify = !quiet;
  }
  if (quiet) {
    options.silent = true;
  } else if (data.kind === 'summon') {
    options.requireInteraction = true;
    options.vibrate = [300, 150, 300, 150, 300];
  } else if (data.kind === 'cafe_order') {
    options.requireInteraction = true;
    options.vibrate = [200, 100, 200];
  }
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = safeLink(event.notification.data && event.notification.data.link);
  const target = new URL(link, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        // Focus first (allowed while handling the tap), then go to the page.
        const focused = await open.focus().catch(() => open);
        if (focused && 'navigate' in focused) {
          try {
            await focused.navigate(target);
            return;
          } catch {
            // Not controlled by this worker yet: fall through and open a window.
          }
        } else {
          return;
        }
      }
      await clients.openWindow(target);
    })(),
  );
});
