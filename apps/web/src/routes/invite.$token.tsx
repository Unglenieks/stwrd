import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PASSWORD_MIN_LENGTH } from "@stwrd/shared";
import { Button, Card, FieldError, Input, Label } from "~/components/ui";
import { authApi, AuthError } from "~/lib/authApi";
import { useSiteUrl } from "~/lib/ConvexClientProvider";

export const Route = createFileRoute("/invite/$token")({
  component: AcceptInvite,
});

function AcceptInvite() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const siteUrl = useSiteUrl();
  const { signIn } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Navigate once the session is live on the Convex client (see login.tsx).
  useEffect(() => {
    if (isAuthenticated) void navigate({ to: "/" });
  }, [isAuthenticated, navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < PASSWORD_MIN_LENGTH) {
      setError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const res = await authApi.acceptInvite(siteUrl, token, password);
      await signIn("credentials", { completionToken: res.completionToken });
      // The isAuthenticated effect handles navigation once the session is live.
      // (TOTP enrollment under `required` policy gets its dedicated screen with
      // the Phase 2 member UI.)
    } catch (err) {
      setError(
        err instanceof AuthError
          ? err.code === "not_found"
            ? "This invite link is invalid or has expired."
            : err.message
          : "Could not accept the invite.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <h1 className="mb-1 text-2xl font-semibold">Accept your invitation</h1>
      <p className="mb-6 text-sm text-slate-500">Choose a password to finish creating your account.</p>
      <Card>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="confirm">Confirm password</Label>
            <Input
              id="confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </div>
          <FieldError>{error}</FieldError>
          <Button type="submit" disabled={busy}>
            {busy ? "Creating account…" : "Create account"}
          </Button>
        </form>
      </Card>
    </main>
  );
}
