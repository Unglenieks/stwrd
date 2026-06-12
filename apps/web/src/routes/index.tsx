import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";
import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { api } from "@cvx/api";
import { Button, Card } from "~/components/ui";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const setup = useQuery(api.settings.setupStatus);

  // Send fresh instances to the wizard; signed-out members to sign in (§6.3).
  useEffect(() => {
    if (setup && !setup.setupComplete) void navigate({ to: "/setup" });
    else if (!isLoading && !isAuthenticated) void navigate({ to: "/login" });
  }, [setup, isLoading, isAuthenticated, navigate]);

  if (isLoading || !isAuthenticated) return null;
  return <SignedInHome />;
}

function SignedInHome() {
  const me = useQuery(api.users.me);
  const { signOut } = useAuthActions();
  const settings = useQuery(api.settings.get);

  return (
    <main className="mx-auto max-w-2xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{settings?.orgName ?? "Library of Things"}</h1>
        <div className="w-28">
          <Button onClick={() => void signOut()}>Sign out</Button>
        </div>
      </div>
      <Card>
        <p className="text-slate-700">
          Signed in as <span className="font-medium">{me?.name ?? me?.email}</span>.
        </p>
        <p className="mt-2 text-sm text-slate-500">
          The catalog and circulation features arrive in Phase 2.
        </p>
      </Card>
    </main>
  );
}
