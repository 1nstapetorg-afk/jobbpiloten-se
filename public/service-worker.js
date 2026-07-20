/**
 * JobbPiloten Service Worker
 * Handles push notifications for new job matches.
 */

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('push', (event) => {
  let data;
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }

  const title = data.title || 'Nytt jobb matchar dig! AI:n har förberett en ansökan.';
  const body = data.body || `${data.company ? data.company + ' — ' : ''}Klicka för att granska och skicka.`;
  const jobId = data.jobId || '';
  const tag = `jobbpiloten-${jobId || Date.now()}`;

  const options = {
    body,
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    tag,
    renotify: true,
    vibrate: [200, 100, 200],
    data: {
      jobId,
      url: data.url || (jobId ? `/dashboard?jobId=${jobId}` : '/dashboard'),
      company: data.company || '',
    },
    actions: [
      {
        action: 'prepare',
        title: 'Granska utkast',
      },
      {
        action: 'dismiss',
        title: 'Inte intresserad',
      },
    ],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const jobId = data.jobId || '';
  const url = data.url || `/dashboard${jobId ? `?jobId=${jobId}` : ''}`;

  if (event.action === 'prepare') {
    // Open dashboard with the job prepared
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        if (clientList.length > 0) {
          const client = clientList[0];
          client.navigate(url);
          client.focus();
        } else {
          clients.openWindow(url);
        }
      })
    );
  } else if (event.action === 'dismiss') {
    // Log dismissal to backend
    fetch('/api/push-dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId }),
    }).catch(() => {});
  } else {
    // Default: open dashboard
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        if (clientList.length > 0) {
          const client = clientList[0];
          client.navigate(url);
          client.focus();
        } else {
          clients.openWindow(url);
        }
      })
    );
  }
});