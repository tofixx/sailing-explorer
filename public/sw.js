// Service Worker nur für Push-Benachrichtigungen (Konzept 17.7) – kein Offline-Cache.
// Der Weckruf ist leer: Text und Ziel holen wir mit der Sitzung von /api/notifications. Ohne Sitzung (abgemeldet)
// zeigen wir nur einen neutralen Hinweis, damit der Browser das Abo nicht wegen „stiller“ Pushes sperrt.
self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      let title = 'Sail Explorer';
      let body = 'Es gibt Neues für dich.';
      let href = '/';
      let tag = 'sx';
      try {
        const res = await fetch('/api/notifications', { credentials: 'same-origin' });
        if (res.ok) {
          const { items } = await res.json();
          const n = items.find((i) => !i.read);
          if (n) {
            body = n.text;
            href = n.href;
            tag = `sx-${n.kind}-${n.id}`;
          }
        }
      } catch {
        // offline – neutraler Hinweis
      }
      await self.registration.showNotification(title, { body, tag, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { href } });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const href = new URL(event.notification.data?.href || '/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const same = wins.find((w) => new URL(w.url).origin === self.location.origin);
      if (same) {
        try {
          await same.focus();
          return await same.navigate(href);
        } catch {
          // Seite nicht von diesem Service Worker gesteuert – dann neues Fenster
        }
      }
      return self.clients.openWindow(href);
    })(),
  );
});
