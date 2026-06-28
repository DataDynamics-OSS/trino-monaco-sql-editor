import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dts from "vite-plugin-dts";
import { resolve } from "node:path";

// Two modes:
//   - default `vite build`      -> builds the library (dist/)
//   - `vite build --mode demo`  -> builds the runnable demo site
export default defineConfig(({ mode }) => {
  if (mode === "demo") {
    // Proxy the demo's /trino requests to a real cluster to avoid CORS and to
    // keep credentials off the browser origin. Override the target with
    // VITE_TRINO_TARGET (default: the cluster used during development).
    const target = process.env.VITE_TRINO_TARGET ?? "https://trino.example.com:8443";
    const proxy = {
      "/trino": {
        target,
        changeOrigin: true,
        secure: false, // allow self-signed certs
        rewrite: (p: string) => p.replace(/^\/trino/, ""),
        // Strip WWW-Authenticate so a 401 never triggers the browser's native
        // Basic-auth popup; our fetch handles the 401 status in code instead.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        configure: (proxy: any) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          proxy.on("proxyRes", (proxyRes: any) => {
            delete proxyRes.headers["www-authenticate"];
          });
        },
      },
    };
    return {
      plugins: [react()],
      worker: { format: "es" },
      server: { proxy },
      preview: { proxy },
    };
  }

  return {
    plugins: [
      react(),
      dts({ include: ["src"], exclude: ["src/main.tsx", "src/App.tsx", "src/demo"] }),
    ],
    worker: { format: "es" },
    build: {
      lib: {
        entry: resolve(__dirname, "src/index.ts"),
        formats: ["es"],
        fileName: () => "trino-monaco.js",
      },
      rollupOptions: {
        external: ["react", "react-dom", "react/jsx-runtime", "@monaco-editor/react", "monaco-editor"],
      },
    },
  };
});
