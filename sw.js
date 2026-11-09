/* 電波が弱い山道でも止まらないよう、画面のファイルと音声をスマホに保存しておく */
const SHELL = 'nikko-shell-v1';
const AUDIO = 'nikko-audio-v1';
const FILES = ['./', 'index.html', 'styles.css', 'app.js', 'data/content.json', 'manifest.webmanifest', 'rules.html', 'privacy.html'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((k) => ![SHELL, AUDIO].includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  // 音声：一度読み込んだら保存して使い回す
  if (url.pathname.includes('/audio/')) {
    e.respondWith(caches.open(AUDIO).then(async (c) => {
      const hit = await c.match(e.request, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok && res.status === 200) c.put(e.request, res.clone());
      return res;
    }));
    return;
  }

  // 中身（content.json）：新しいものを優先。電波がなければ保存したもの
  if (url.pathname.endsWith('/data/content.json')) {
    e.respondWith(fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(SHELL).then((c) => c.put('data/content.json', copy));
      return res;
    }).catch(() => caches.match('data/content.json')));
    return;
  }

  // それ以外：保存したものをすぐ出し、裏で新しくする
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => {
    const net = fetch(e.request).then((res) => {
      if (res.ok) caches.open(SHELL).then((c) => c.put(e.request, res.clone()));
      return res;
    }).catch(() => hit);
    return hit || net;
  }));
});
