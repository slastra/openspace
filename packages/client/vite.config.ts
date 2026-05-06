import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    conditions: ["source", "module", "browser", "default"],
  },
  server: {
    port: 5173,
    host: true,
    // In dev the Vite host (5173) and the game server (2567) run on
    // separate origins, so client-side fetches to `/build-info` must
    // be proxied to the game server. Production has both behind one
    // origin (the server statically serves the built bundle), so no
    // proxy config is needed there.
    proxy: {
      "/build-info": "http://localhost:2567",
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
