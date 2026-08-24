import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/chat": "http://localhost:3001",
      "/entries": "http://localhost:3001",
      "/profile": "http://localhost:3001",
    },
  },
});
