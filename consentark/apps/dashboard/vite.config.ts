import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Dashboard dev server proxies /api → the local API so the browser talks to
 * one origin (no CORS juggling in dev; production deployments set VITE_API_URL).
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: false,
      },
    },
  },
});
