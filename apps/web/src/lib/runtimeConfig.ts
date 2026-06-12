// Runtime configuration (spec §19.5).
//
// The frontend never bakes the hostname at build time. The container entrypoint
// writes /runtime-config.json from PUBLIC_API_ORIGIN / PUBLIC_SITE_ORIGIN at
// startup; the client fetches it before opening the Convex connection. A
// hostname change therefore needs only a restart — no image rebuild.

export interface RuntimeConfig {
  /** Convex client API origin (WebSocket/HTTP), e.g. https://lib.example.org/api */
  apiUrl: string;
  /** Convex HTTP-actions (site) origin, where /auth/* lives. */
  siteUrl: string;
}

let cached: RuntimeConfig | null = null;

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  if (cached) return cached;
  const res = await fetch("/runtime-config.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`failed to load runtime-config.json: ${res.status}`);
  cached = (await res.json()) as RuntimeConfig;
  return cached;
}
