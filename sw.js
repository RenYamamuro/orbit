/* オフラインで開けるようにするためのサービスワーカー。
   アプリ本体は1ファイルなので、シェルを丸ごと先読みして
   「まずキャッシュを返し、裏で更新する」方式にしている。 */
const VERSION = "v22";
const CACHE = `subman-${VERSION}`;
const SHELL = [
  "./",
  "./index.html",
  "./i18n.js",
  "./brands.js",
  "./manifest.webmanifest",
  "./fonts/nunito-latin.woff2",
  "./fonts/mplus.css",
  "./icons/icon-180-v4.png",
  "./icons/icon-192-v4.png",
  "./icons/icon-512-v4.png",
  "./icons/icon-maskable-512-v4.png",
];

// 足りないものだけ入れ直す。
// install は同じ版では二度と走らないので、保存領域が整理されてキャッシュが
// 消えた場合に備えて activate でも呼ぶ（消えたままだとオフラインで開けなくなる）
async function ensureShell() {
  const cache = await caches.open(CACHE);
  await Promise.allSettled(SHELL.map(async u => {
    if (await cache.match(u, { ignoreSearch: true })) return;
    const res = await fetch(new Request(u, { cache: "reload" }));
    if (res && res.ok) await cache.put(u, res);
  }));
}

self.addEventListener("install", e => {
  e.waitUntil(ensureShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await ensureShell();
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // 同期用の外部通信には触らない

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    // GitHub Pages は 10 分の HTTP キャッシュを指示してくるので、画面と処理（HTML・JS・CSS）は
    // 毎回サーバーに確かめる（変わっていなければ中身は送られてこないので軽い）。フォントや画像はそのまま
    const fresh = req.mode === "navigate" || /(\/|\.html|\.js|\.css|\.webmanifest)$/.test(url.pathname);
    const net = (fresh ? fetch(req.url, { cache: "no-cache", credentials: "same-origin" }) : fetch(req)).then(res => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => null);

    if (hit) { e.waitUntil(net); return hit; }        // 表示は即座に、更新は裏で
    const res = await net;
    if (res) return res;
    // オフラインで初回アクセスのときは、あればシェルを返す
    return (await cache.match("./index.html")) || new Response("オフラインです", {
      status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  })());
});

// 新しい版に即座に切り替えるための合図
self.addEventListener("message", e => { if (e.data === "skipWaiting") self.skipWaiting(); });
