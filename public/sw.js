// AFVS service worker — offline shell supaya aplikasi tetap bisa dibuka & dipakai
// saat jaringan/server terputus (data scan sendiri tersimpan di localStorage /
// IndexedDB dan dikirim ulang oleh outbox).
// Strategy:
//   - navigasi halaman: network-first (batas tunggu), HTML sukses disimpan;
//     saat gagal → HTML tersimpan untuk path yang sama → offline.html
//   - /_next/static (ber-hash): cache-first di cache tersendiri
//   - aset publik path-stabil: stale-while-revalidate
//   - "warm-pages": muat HTML rute inti + aset yang dirujuknya ke cache, supaya
//     rute yang belum pernah dibuka pun tersedia offline
//   - lainnya (API, RSC): network passthrough
//
// Bump CACHE_VERSION whenever this file or precached assets change.

const CACHE_VERSION = "afvs-v3";
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const PAGE_CACHE = `${CACHE_VERSION}-pages`;
const PRECACHE = `${CACHE_VERSION}-precache`;
const OFFLINE_URL = "/offline.html";
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  // Suara hasil scan — harus tersedia saat kiosk offline.
  "/sounds/scan-berhasil.mp3",
  "/sounds/scan-duplikat.mp3",
  "/sounds/scan-gagal.mp3",
];
const RUNTIME_MAX_ENTRIES = 80; // P-14: batasi ukuran runtime cache (FIFO)
// Chunk build lama menumpuk tiap deploy. Pemanasan memasukkan ulang aset yang
// masih dirujuk halaman, jadi FIFO longgar ini aman untuk build aktif.
const STATIC_MAX_ENTRIES = 600;
// Halaman dinamis (mis. /flights/<id>) ikut tersimpan; rute inti dimasukkan
// ulang oleh pemanasan.
const PAGE_MAX_ENTRIES = 60;
// Server hang (LAN hidup, server mati) bisa membuat fetch menggantung lama;
// setelah batas ini halaman tersimpan dipakai.
const NAV_TIMEOUT_MS = 8000;
// Rute yang disiapkan untuk dibuka offline (kiosk + dashboard utama).
const APP_ROUTES = [
  "/",
  "/login",
  "/scan/kiosk",
  "/dashboard",
  "/scan",
  "/flights",
  "/scan-events",
  "/passengers",
];
const WARM_MIN_INTERVAL_MS = 10 * 60 * 1000;
let lastWarmAt = 0;

// P-14: pangkas entri terlama bila runtime cache melebihi batas, supaya tidak
// membengkak di disk klien (mis. aset gambar).
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  for (let i = 0; i < keys.length - maxEntries; i++) {
    await cache.delete(keys[i]);
  }
}

function pageKey(url) {
  const u = new URL(url, self.location.origin);
  return u.origin + u.pathname;
}

function fetchWithTimeout(req, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    fetch(req).then(
      (res) => {
        clearTimeout(timer);
        resolve(res);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function isHtml(res) {
  return (res.headers.get("content-type") || "").includes("text/html");
}

/** Path aset /_next/static yang dirujuk HTML (tag script/link & payload RSC). */
function staticAssetsIn(html) {
  const found = new Set();
  for (const m of html.matchAll(/\/_next\/static\/[^"'\\\s<>)]+/g)) found.add(m[0]);
  for (const m of html.matchAll(/["'](static\/(?:chunks|css|media)\/[^"'\\\s<>)]+)/g)) {
    found.add(`/_next/${m[1]}`);
  }
  return [...found];
}

async function warmPages() {
  if (Date.now() - lastWarmAt < WARM_MIN_INTERVAL_MS) return;
  lastWarmAt = Date.now();
  const pages = await caches.open(PAGE_CACHE);
  const statics = await caches.open(STATIC_CACHE);
  const assets = new Set();
  for (const route of APP_ROUTES) {
    try {
      const res = await fetch(route, { cache: "no-store", credentials: "same-origin" });
      if (!res.ok || !isHtml(res)) continue;
      await pages.put(pageKey(route), res.clone());
      for (const a of staticAssetsIn(await res.text())) assets.add(a);
    } catch {
      lastWarmAt = 0; // offline → coba lagi pada kesempatan berikutnya
      return;
    }
  }
  for (const asset of assets) {
    if (await statics.match(asset)) continue;
    try {
      const res = await fetch(asset);
      if (res.ok) await statics.put(asset, res);
    } catch {
      // Aset gagal → dicoba lagi saat pemanasan berikutnya.
    }
  }
  await trimCache(STATIC_CACHE, STATIC_MAX_ENTRIES);
}

async function handleNavigation(req) {
  const key = pageKey(req.url);
  try {
    const res = await fetchWithTimeout(req, NAV_TIMEOUT_MS);
    if (res.ok && isHtml(res) && new URL(req.url).origin === self.location.origin) {
      const copy = res.clone();
      caches
        .open(PAGE_CACHE)
        .then((cache) => cache.put(key, copy))
        .then(() => trimCache(PAGE_CACHE, PAGE_MAX_ENTRIES));
    }
    return res;
  } catch {
    const cached = await caches.match(key, { cacheName: PAGE_CACHE });
    if (cached) return cached;
    const offline = await caches.match(OFFLINE_URL, { cacheName: PRECACHE });
    return offline || Response.error();
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PRECACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => !k.startsWith(CACHE_VERSION))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim())
      .then(() => warmPages()),
  );
});

// Halaman meminta pemanasan setelah dimuat (lihat PWARegister).
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "warm-pages") {
    event.waitUntil(warmPages());
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  if (req.mode === "navigate") {
    event.respondWith(handleNavigation(req));
    return;
  }

  // Build assets ber-hash (/_next/static) — cache-first AMAN: URL berubah saat
  // konten berubah, jadi tidak akan basi.
  if (sameOrigin && url.pathname.startsWith("/_next/static")) {
    event.respondWith(
      caches.match(req, { cacheName: STATIC_CACHE }).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(STATIC_CACHE).then((cache) => cache.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Aset publik path-STABIL (icons, gambar termasuk .webp/.avif, font, manifest)
  // — stale-while-revalidate: sajikan cache cepat, lalu perbarui di latar
  // belakang supaya tidak basi saat file diganti (mis. gambar baru di P-01).
  if (
    sameOrigin &&
    (url.pathname.startsWith("/icons/") ||
      url.pathname === "/manifest.webmanifest" ||
      /\.(?:css|js|woff2?|ttf|svg|png|jpg|jpeg|gif|ico|webp|avif|mp3)$/i.test(
        url.pathname,
      ))
  ) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(async (cache) => {
        // Belum ada di runtime cache → pakai salinan precache (mis. suara
        // hasil scan yang dipasang saat install) agar tetap jalan offline.
        const cached = (await cache.match(req)) ?? (await caches.match(req));
        const network = fetch(req)
          .then((res) => {
            if (res && res.ok) {
              cache.put(req, res.clone());
              trimCache(RUNTIME_CACHE, RUNTIME_MAX_ENTRIES);
            }
            return res;
          })
          .catch(() => cached);
        return cached || network;
      }),
    );
  }
});
