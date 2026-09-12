// @ts-check
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import node from "@astrojs/node";

// SSR ("server" output) so Astro can expose server routes that hold secrets
// (NVIDIA key) and proxy to the Python rendering engine server-to-server.
// React is used only for interactive islands (the editor); Astro owns the rest.
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [react()],
  server: { port: 4321 },
});
