import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/static/dist/",
  build: {
    outDir: "../public/dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: "projects.js",
      },
    },
  },
});
