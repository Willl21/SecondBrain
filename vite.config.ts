import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "web",
  publicDir: "../public",
  build: { outDir: "../dist", emptyOutDir: true },
  // Dev: `npm run dev` di terminal lain buat API (wrangler di 8787).
  server: { proxy: { "/api": "http://localhost:8787" } },
  plugins: [react()],
});
