import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },

  // transformers.js pulls in Node-only deps (onnxruntime-node, sharp) that must
  // NOT be bundled for the browser; exclude from pre-bundling and stub the
  // Node-only entries so the web build resolves cleanly.
  optimizeDeps: {
    exclude: ["@huggingface/transformers", "onnxruntime-web"],
  },

  // Vite options tailored for Tauri development
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
