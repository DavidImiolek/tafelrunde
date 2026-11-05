// Service Worker für Prost – Bierzähler
// Version bei jeder Änderung hochzählen, damit Geräte die neue Version holen.
const CACHE = "tafelrunde-v15";
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

/* ── Konfigurierbare Reaktionen ──
   Gleiche Liste wie im Frontend – hier für die Notification-Actions. */
const REACTIONS = [
  "lass da schmegh",
  "arbeitsloses Schwein!",
  "Guape",
  "Hast ja auch Recht",
  "fick dich",
];

/* ---------- Push-Benachrichtigungen ---------- */
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : "" }; }
  const title = d.title || "Tafelrunde";
  const isBeer = d.data && d.data.type === "beer";
  const opts = {
    body: d.body || "",
    icon: "./icon-192.png",
    badge: "./icon-192.png",
    tag: d.tag || "tafelrunde",
    renotify: true,
    data: d.data || { url: d.url || "./" },
  };
  // Bier-Notifications bekommen Reaktions-Buttons
  if (isBeer) {
    opts.actions = REACTIONS.slice(0, 3).map((r, i) => ({ action: `react_${i}`, title: r }));
    opts.data.reactions = REACTIONS;
    opts.data.player = d.data.player;
    opts.data.room = d.data.room;
  }
  e.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const d = e.notification.data || {};
  const action = e.action; // z.B. "react_0", "react_1", ...

  // Reaktion auf Bier-Notification
  if (action && action.startsWith("react_") && d.reactions && d.room) {
    const idx = parseInt(action.split("_")[1], 10);
    const reaction = d.reactions[idx];
    if (reaction) {
      e.waitUntil(sendReaction(d.room, d.player, reaction));
      return;
    }
  }

  // Normal: App öffnen / fokussieren
  const target = d.url || "./";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ("focus" in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});

/* Reaktion an Edge Function senden */
async function sendReaction(room, originalPlayer, reaction) {
  // reactor = der aktuelle Nutzer; wir fragen die offene App oder nutzen den letzten bekannten Spieler
  let reactor = "Jemand";
  try {
    const clients = await self.clients.matchAll({ type: "window" });
    for (const c of clients) {
      c.postMessage({ type: "GET_PLAYER" });
    }
    // Wir holen den Spielernamen aus der URL oder einem gespeicherten Wert
  } catch {}

  // Spieler aus IndexedDB/Cache holen ist komplex – wir senden die Reaktion
  // über das Frontend via postMessage
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  if (clients.length > 0) {
    // App ist offen → Frontend macht den API-Call
    clients[0].postMessage({ type: "SEND_REACTION", room, originalPlayer, reaction });
    return;
  }

  // App ist zu → direkt an Edge Function senden
  // Wir brauchen den Spielernamen und die Supabase-URL
  // Diese sind im SW nicht direkt verfügbar, also versuchen wir es mit der Registration
  try {
    const resp = await fetch(
      "https://kxaeumlmoezythuencbj.supabase.co/functions/v1/send-reaction-push",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room, reactor, reaction, original_player: originalPlayer }),
      }
    );
  } catch {}
}
