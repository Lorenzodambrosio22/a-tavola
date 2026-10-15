import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [
    react(),
    cloudflare({
      // Workers AI funziona solo in remoto: in sviluppo si attiva con CF_REMOTE=1 (richiede `wrangler login`).
      remoteBindings: process.env.CF_REMOTE === "1",
    }),
  ],
});
