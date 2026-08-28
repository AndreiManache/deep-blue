import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
    },
  },
});
