import { defineConfig } from "vitest/config";

// Backend (Convex) unit tests run in the edge-runtime VM via convex-test, which
// executes functions in-process against an in-memory database — no Docker
// backend required. This is also the seed of the Phase 5 conformance harness.
export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["convex/**/*.test.ts"],
    server: { deps: { inline: ["convex-test"] } },
  },
});
