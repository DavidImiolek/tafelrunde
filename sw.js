// Service Worker für Prost – Bierzähler
// Version bei jeder Änderung hochzählen, damit Geräte die neue Version holen.
const CACHE = "tafelrunde-v17";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-180.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;                 // Supabase-Writes nie cachen
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;  // externe Aufrufe (Supabase, Fonts) durchlassen

  // Navigation: erst Netz, dann Cache (damit Updates ankommen)
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("./index.html")));
    return;
  }
  // Statische Dateien: erst Cache, dann Netz
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});

/* ---------- Push-Benachrichtigungen ---------- */

const REACTIONS = [
  "lass da schmegh",
  "arbeitsloses Schwein!",
  "Guape",
  "Hast ja auch Recht",
  "fick dich"
];

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : "" }; }
  const inner = d.data || {};
  const title = d.title || "Tafelrunde";
  const ptype = inner.type || d.type || "beer";
  const proom = inner.room || d.room || "";
  const pplayer = inner.player || d.player || "";
  const opts = {
    body: d.body || "",
    icon: "./icon-192.png",
    badge: "./icon-192.png",
    tag: d.tag || "tafelrunde",
    renotify: true,
    data: { url: d.url || "./", room: proom, player: pplayer, type: ptype }
  };

  // Reaktions-Buttons nur bei Bier-Benachrichtigungen (nicht bei Reaktions-Benachrichtigungen)
  if (ptype !== "reaction") {
    // Zufällig 2 aus den REACTIONS auswählen
    const shuffled = [...REACTIONS].sort(() => Math.random() - 0.5);
    opts.actions = [
      { action: "react_0", title: shuffled[0] },
      { action: "react_1", title: shuffled[1] }
    ];
    opts.data.reactions = [shuffled[0], shuffled[1]];
  }

  e.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const data = e.notification.data || {};
  const target = data.url || "./";

  // Reaktions-Button geklickt
  if (e.action && e.action.startsWith("react_")) {
    const idx = parseInt(e.action.split("_")[1], 10);
    const reaction = data.reactions ? data.reactions[idx] : "";
    if (reaction && data.room) {
      e.waitUntil(
        self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
          for (const c of list) {
            c.postMessage({
              type: "SEND_REACTION",
              room: data.room,
              originalPlayer: data.player,
              reaction: reaction
            });
            return;
          }
          // Kein offenes Fenster – öffne App und sende danach
          if (self.clients.openWindow) {
            return self.clients.openWindow(target);
          }
        })
      );
    }
    return;
  }

  // Normaler Klick – App öffnen/fokussieren + Reaktions-Popup bei Bier
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const isBeer = data.type === "beer" && data.room && data.player;
      if (list.length > 0) {
        const c = list[0];
        if (isBeer) {
          c.postMessage({ type: "SHOW_REACTION", room: data.room, player: data.player });
        }
        if ("focus" in c) return c.focus();
      }
      if (self.clients.openWindow) {
        // Wenn kein Fenster offen: URL mit Reaktionsdaten öffnen
        const url = isBeer ? `./?react_room=${encodeURIComponent(data.room)}&react_player=${encodeURIComponent(data.player)}` : target;
        return self.clients.openWindow(url);
      }
    })
  );
});
