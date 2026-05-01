import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv, type Plugin } from "vite";

/** Remove crossorigin dos tags HTML no build — quebra loadFile(file://) no Electron. */
function electronShellBuildPlugin(): Plugin {
  return {
    name: "electron-shell-html",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html: string) {
        return html.replace(/\s+crossorigin(?:=["'][^"']*["'])?/gi, "");
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget =
    env.VITE_API_BASE_URL?.trim() || "http://127.0.0.1:8081";

  return {
    plugins: [react(), tailwindcss(), electronShellBuildPlugin()],
    base: "./",
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
    server: {
      // 5173 é frequentemente usado por outros Vite projects e pode colidir no desktop.
      // O Electron em dev usa este porto.
      // host: true → escuta em IPv4+IPv6; evita ecrã em branco quando o browser usa `localhost`
      // e o stack resolve para ::1 enquanto só havia listener em 127.0.0.1 (ou o contrário).
      // Override opcional: variável `VITE_DEV_SERVER_HOST` (ex.: `127.0.0.1` só para testes).
      host: env.VITE_DEV_SERVER_HOST?.trim() ? env.VITE_DEV_SERVER_HOST.trim() : true,
      port: 5174,
      strictPort: true,
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
      proxy: {
        "/v1": { target: apiTarget, changeOrigin: true },
        "/health": { target: apiTarget, changeOrigin: true },
        "/healthz": { target: apiTarget, changeOrigin: true },
        "/ready": { target: apiTarget, changeOrigin: true },
        "/readyz": { target: apiTarget, changeOrigin: true },
      },
    },
    build: {
      chunkSizeWarningLimit: 1200,
      sourcemap: false,
    },
  };
});
