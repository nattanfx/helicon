import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The web app compiles the shared UI straight from source, so edits hot-reload without a package build.
const uiEntry = fileURLToPath(new URL("../../packages/ui/src/index.ts", import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // HELICON_BUILD is the git SHA from CI. Empty locally; the UI never invents one.
  envPrefix: ["VITE_", "HELICON_"],
  resolve: {
    alias: { "@helicon/ui": uiEntry },
    dedupe: ["react", "react-dom"],
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:3127",
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
});
