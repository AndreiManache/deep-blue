import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// The PWA service worker (vite.config.ts) precaches the app shell, which
// means a stale worker will happily keep serving an old build forever
// unless something actively pushes it forward. Two halves to that:
//
//  1. controllerchange -> reload once. skipWaiting + clientsClaim make a new
//     worker take control of already-open pages, but that alone never gets
//     THIS page onto the new JS/CSS — only a future navigation would.
//  2. An explicit update() check on load and every time the app returns to
//     the foreground. Without this, an installed PWA that's only ever
//     backgrounded (never fully closed) can go a long time without the
//     browser deciding to re-check /sw.js on its own — which is exactly how
//     a phone ends up sitting on a days-old build. update() is cheap: it's
//     a conditional request against a max-age=0 script, so it's a 304 in
//     the common case where nothing has shipped.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((registration) => {
        let reloaded = false;
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (reloaded) return;
          reloaded = true;
          window.location.reload();
        });

        const checkForUpdate = () => {
          // Rejects when offline or the script 404s — neither is worth
          // surfacing, the app works fine either way.
          void registration.update().catch(() => {});
        };
        checkForUpdate();
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") checkForUpdate();
        });
      })
      .catch(() => {
        /* offline-shell just won't be available this session — the app still works online */
      });
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
