import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const host = process.env.TAURI_DEV_HOST;

// Dev-server port. Tauri's `build.devUrl` must point at the SAME port, which
// is why `strictPort` is on (Vite must fail loudly rather than drift to
// 1421 and leave the app window on a dead URL). Override both sides at once
// with `npm run tauri:dev` (scripts/tauri-dev.mjs reads TAURI_DEV_PORT and
// passes the matching devUrl to Tauri); a bare `npm run dev` honours the
// variable too.
const devPort = Number(process.env.TAURI_DEV_PORT) || 1420;

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: devPort,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: devPort + 1,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
