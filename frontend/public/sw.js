// Service worker — handles push events and notification clicks

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'The Forgetting Machine', body: event.data.text() };
  }

  const options = {
    body:              payload.body   || '',
    icon:              '/icon-192.png',
    badge:             '/icon-96.png',
    data:              payload.data   || {},
    requireInteraction: false,
    silent:            false,
    vibrate:           [100, 50, 100],
  };

  event.waitUntil(
    self.registration.showNotification(payload.title || 'The Forgetting Machine', options),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data           = event.notification.data || {};
  const surfaceEventId = data.surface_event_id;
  const url            = surfaceEventId
    ? `/surface?event_id=${surfaceEventId}`
    : '/surface';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    }),
  );
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(clients.claim()));
