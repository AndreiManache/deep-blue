import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// The PWA service worker (vite.config.ts) takes over control of this page
// in the background on every new deploy (skipWaiting + clientsClaim), but
// that alone doesn't get a page that's already open onto the new JS/CSS —
// only future navigations would pick it up. controllerchange fires exactly
// when a new worker takes over, so reload once right then instead of
// leaving an already-open tab (or an installed PWA that's never fully
// closed) silently stuck on a stale build.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then(() => {
        let reloaded = false;
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (reloaded) return;
          reloaded = true;
          window.location.reload();
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
