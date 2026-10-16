/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null } | string> };

// App shell caching (works offline / loads instantly once installed).
const manifest = self.__WB_MANIFEST;
cleanupOutdatedCaches();
precacheAndRoute(manifest);
if (manifest.some((e) => (typeof e === 'string' ? e : e.url) === 'index.html')) {
  registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));
}
self.skipWaiting();
clientsClaim();

interface PushPayload {
  title?: string;
  body?: string;
  starts_at?: string | null;
  url?: string;
  tag?: string;
}

const fmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });

self.addEventListener('push', (event) => {
  let data: PushPayload = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { body: event.data?.text() };
  }
  // The server doesn't know the user's timezone, so format the start time here.
  const when = data.starts_at ? fmt.format(new Date(data.starts_at)) : null;
  const body = [when, data.body].filter(Boolean).join(' · ');

  event.waitUntil(
    self.registration.showNotification(data.title ?? 'LFG', {
      body,
      icon: '/pwa-192x192.png',
      badge: '/pwa-64x64.png',
      tag: data.tag,
      data: { url: data.url ?? '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data as { url?: string })?.url ?? '/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          try {
            await client.navigate(url);
          } catch {
            /* uncontrolled client — ignore */
          }
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
