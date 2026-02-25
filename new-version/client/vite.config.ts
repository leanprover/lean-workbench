import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/static/dist/",
  build: {
    outDir: "../public/dist",
    emptyOutDir: true,
    rollupOptions: {
      input: "src/profile.tsx",
      output: {
        entryFileNames: "profile.js",
      },
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:3002",
      "/dev-login": "http://localhost:3002",
      "/logout": "http://localhost:3002",
    },
  },
});
