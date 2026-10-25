import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: ".",
  appType: "mpa",
  build: {
    outDir: "dist/vite",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        store: resolve(process.cwd(), "apps/web-user/index.html"),
        admin: resolve(process.cwd(), "apps/web-admin/index.html")
      }
    }
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true
  }
});
