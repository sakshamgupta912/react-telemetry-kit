import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { functionTracing } from "react-telemetry-kit/vite";

export default defineConfig({
  plugins: [
    functionTracing({
      exclude: (file) => file.endsWith("excluded.ts") || file.endsWith("telemetry-setup.ts"),
    }),
    react(),
  ],
  build: {
    sourcemap: true,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        browser: fileURLToPath(new URL("./browser.html", import.meta.url)),
      },
    },
  },
});
