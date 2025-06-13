self.addEventListener('install', (e) => {
    console.log('Service Worker installato');
    self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
    // No cache offline per ora, passthrough
});
