import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget =
    env.VITE_API_BASE_URL?.trim() || "http://127.0.0.1:8080";

  const crossOriginIsolationHeaders = {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
  };

  return {
    plugins: [react(), tailwindcss()],
    base: "./",
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
    server: {
      // 5173 é frequentemente usado por outros Vite projects e pode colidir no desktop.
      // O Electron em dev usa este porto.
      port: 5174,
      strictPort: true,
      headers: crossOriginIsolationHeaders,
      proxy: {
        "/v1": { target: apiTarget, changeOrigin: true },
        "/health": { target: apiTarget, changeOrigin: true },
        "/healthz": { target: apiTarget, changeOrigin: true },
        "/ready": { target: apiTarget, changeOrigin: true },
        "/readyz": { target: apiTarget, changeOrigin: true },
      },
    },
    preview: {
      port: 4174,
      strictPort: true,
      headers: crossOriginIsolationHeaders,
      proxy: {
        "/v1": { target: apiTarget, changeOrigin: true },
        "/health": { target: apiTarget, changeOrigin: true },
        "/healthz": { target: apiTarget, changeOrigin: true },
        "/ready": { target: apiTarget, changeOrigin: true },
        "/readyz": { target: apiTarget, changeOrigin: true },
      },
    },
  };
});
