import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // App-shell caching only — precaches the built JS/CSS/HTML/icons so a
    // repeat launch is instant and doesn't blank-screen on a flaky
    // connection. Deliberately does NOT cache any API route: /chat,
    // /entries, /auth etc. must always hit the network fresh (live
    // conversation state, auth tokens) — see BACKLOG.md's PWA item, this is
    // an installability/launch-speed win, not offline data sync.
    VitePWA({
      registerType: "autoUpdate",
      // Registered manually in main.tsx instead — the auto-injected
      // registerSW.js only calls navigator.serviceWorker.register() with no
      // update-reload logic, so a new deploy's service worker takes over
      // control in the background (skipWaiting+clientsClaim below) without
      // ever telling an already-open tab to reload and actually fetch the
      // new JS/CSS it's now supposed to be serving.
      injectRegister: false,
      manifest: false, // manifest.webmanifest is already hand-authored in public/
      includeAssets: ["apple-touch-icon.png", "icon-192.png", "icon-512.png"],
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/chat": "http://localhost:3001",
      "/entries": "http://localhost:3001",
      "/profile": "http://localhost:3001",
      "/greeting": "http://localhost:3001",
      "/auth": "http://localhost:3001",
      "/stats": "http://localhost:3001",
      "/transcribe": "http://localhost:3001",
      "/feedback": "http://localhost:3001",
      "/admin": "http://localhost:3001",
      "/barcode": "http://localhost:3001",
      "/foods": "http://localhost:3001",
    },
  },
});
