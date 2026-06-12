// Runtime configuration (spec §19.5).
//
// The frontend never bakes the hostname at build time. The container entrypoint
// writes /runtime-config.json from PUBLIC_API_ORIGIN / PUBLIC_SITE_ORIGIN at
// startup; the client fetches it before opening the Convex connection. A
// hostname change therefore needs only a restart — no image rebuild.
import { z } from "zod";

const runtimeConfigSchema = z.object({
  /** Convex client API origin (WebSocket/HTTP), e.g. https://lib.example.org/api */
  apiUrl: z.string().url(),
  /** Convex HTTP-actions (site) origin, where /auth/* lives. */
  siteUrl: z.string().url(),
});

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

// Cache the in-flight promise (not just the result) so concurrent callers during
// startup share a single fetch rather than racing separate requests.
let cached: Promise<RuntimeConfig> | null = null;

export function loadRuntimeConfig(): Promise<RuntimeConfig> {
  if (!cached) {
    cached = (async () => {
      const res = await fetch("/runtime-config.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`failed to load runtime-config.json: ${res.status}`);
      // Validate at runtime — a malformed config should fail loudly here, not
      // surface as a confusing connection error later.
      return runtimeConfigSchema.parse(await res.json());
    })().catch((err) => {
      cached = null; // allow a retry on transient failure
      throw err;
    });
  }
  return cached;
}
