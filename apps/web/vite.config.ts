import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  // Allow importing the Convex generated API from the repo-root convex/ dir.
  server: { port: 3000, fs: { allow: [".."] } },
  plugins: [
    tsConfigPaths(),
    tanstackStart(),
    viteReact(),
  ],
  // Bundle all dependencies into the SSR build so the container needs no node_modules.
  ssr: { noExternal: true },
});
