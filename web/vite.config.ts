import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Vite configuration for the IBT Viewer frontend.
 *
 * - `@/*` alias mirrors the TypeScript paths config in tsconfig.json so the
 *   build tool resolves imports the same way the type checker does.
 * - `/api` proxy forwards any request starting with `/api` to the local
 *   Python sidecar on port 8000. This lets the frontend call `/api/parse-ibt`
 *   instead of the fully-qualified origin, which keeps the API client code
 *   identical between local dev and production (where nginx will do the same
 *   rewrite on p1doks.com).
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
