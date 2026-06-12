import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button, Card, FieldError, Input, Label } from "~/components/ui";
import { authApi, AuthError, type LoginResult } from "~/lib/authApi";
import { useSiteUrl } from "~/lib/ConvexClientProvider";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const siteUrl = useSiteUrl();
  const { signIn } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState<LoginResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Navigate only once the session has actually propagated to the Convex client
  // (signIn stores tokens, but isAuthenticated flips a tick later) — otherwise
  // "/" would bounce back here before auth is live.
  useEffect(() => {
    if (isAuthenticated) void navigate({ to: "/" });
  }, [isAuthenticated, navigate]);

  async function establishSession(completionToken: string) {
    await signIn("credentials", { completionToken });
  }

  async function onPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await authApi.login(siteUrl, email, password);
      if (res.status === "complete" && res.completionToken) {
        await establishSession(res.completionToken);
      } else {
        setPending(res); // mfa_required → show second-factor step
      }
    } catch (err) {
      setError(err instanceof AuthError ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  if (pending?.status === "mfa_required" && pending.pendingToken) {
    return (
      <SecondFactor
        siteUrl={siteUrl}
        pendingToken={pending.pendingToken}
        methods={pending.methods ?? []}
        onComplete={establishSession}
      />
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <h1 className="mb-6 text-2xl font-semibold">Sign in</h1>
      <Card>
        <form onSubmit={onPassword} className="space-y-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
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
          <FieldError>{error}</FieldError>
          <Button type="submit" disabled={busy}>
            {busy ? "Checking…" : "Continue"}
          </Button>
        </form>
      </Card>
    </main>
  );
}

function SecondFactor({
  siteUrl,
  pendingToken,
  methods,
  onComplete,
}: {
  siteUrl: string;
  pendingToken: string;
  methods: string[];
  onComplete: (completionToken: string) => Promise<void>;
}) {
  const [method, setMethod] = useState<string>(methods[0] ?? "totp");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [otpSent, setOtpSent] = useState(false);

  async function sendOtp() {
    setError(null);
    try {
      await authApi.sendOtp(siteUrl, pendingToken);
      setOtpSent(true);
    } catch (err) {
      setError(err instanceof AuthError ? err.message : "Could not send code.");
    }
  }

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const factor =
        method === "totp"
          ? { totp: code }
          : method === "otp"
            ? { otp: code }
            : { recoveryCode: code };
      const res = await authApi.verifyMfa(siteUrl, pendingToken, factor);
      await onComplete(res.completionToken);
    } catch (err) {
      setError(err instanceof AuthError ? err.message : "Verification failed.");
    } finally {
      setBusy(false);
    }
  }

  const label =
    method === "totp"
      ? "Authenticator code"
      : method === "otp"
        ? "Emailed code"
        : "Recovery code";

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <h1 className="mb-1 text-2xl font-semibold">Two-factor verification</h1>
      <p className="mb-6 text-sm text-slate-500">Confirm it's you to finish signing in.</p>
      <Card>
        <form onSubmit={onVerify} className="space-y-4">
          {methods.length > 1 && (
            <div>
              <Label htmlFor="method">Method</Label>
              <select
                id="method"
                className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                value={method}
                onChange={(e) => {
                  setMethod(e.target.value);
                  setCode("");
                  setOtpSent(false);
                }}
              >
                {methods.includes("totp") && <option value="totp">Authenticator app</option>}
                {methods.includes("otp") && <option value="otp">Email code</option>}
                {methods.includes("recovery") && <option value="recovery">Recovery code</option>}
              </select>
            </div>
          )}
          {method === "otp" && !otpSent && (
            <Button type="button" onClick={sendOtp}>
              Email me a code
            </Button>
          )}
          {(method !== "otp" || otpSent) && (
            <div>
              <Label htmlFor="code">{label}</Label>
              <Input
                id="code"
                inputMode={method === "recovery" ? "text" : "numeric"}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoFocus
                required
              />
            </div>
          )}
          <FieldError>{error}</FieldError>
          {(method !== "otp" || otpSent) && (
            <Button type="submit" disabled={busy}>
              {busy ? "Verifying…" : "Verify"}
            </Button>
          )}
        </form>
      </Card>
    </main>
  );
}
