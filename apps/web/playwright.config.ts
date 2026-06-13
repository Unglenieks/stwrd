import { defineConfig, devices } from "@playwright/test";

// Phase 1 smoke coverage; the full §24 conformance suite (C-01…C-21) is built in
// Phase 5. Assumes the local Convex backend is running (see deploy/) and that a
// dev server is reachable on :3000 (reused if already up).
export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  fullyParallel: false,
  // One worker: the suite runs against a single shared live backend, and a few
  // tests mutate global state (e.g. SMTP config), so serial execution keeps them
  // deterministic. (The email test needs a mailpit catcher on the backend's
  // docker network — see docs.)
  workers: 1,
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
