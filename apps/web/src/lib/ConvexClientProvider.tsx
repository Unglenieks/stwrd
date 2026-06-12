import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { loadRuntimeConfig, type RuntimeConfig } from "./runtimeConfig";

const SiteUrlContext = createContext<string>("");

/** The Convex HTTP-actions origin, for the custom /auth/* endpoints (§22.1). */
export function useSiteUrl(): string {
  return useContext(SiteUrlContext);
}

/**
 * Loads runtime config, then mounts the Convex + Convex Auth providers. Rendered
 * client-side only (auth is inherently a browser concern here); during SSR and
 * the brief config fetch it shows a minimal splash.
 */
export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<
    { client: ConvexReactClient; config: RuntimeConfig } | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    loadRuntimeConfig().then((config) => {
      if (cancelled) return;
      const client = new ConvexReactClient(config.apiUrl);
      setState({ client, config });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!state) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-400">
        Loading…
      </div>
    );
  }

  return (
    <SiteUrlContext.Provider value={state.config.siteUrl}>
      <ConvexAuthProvider client={state.client}>{children}</ConvexAuthProvider>
    </SiteUrlContext.Provider>
  );
}
