import { useAction, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { api } from "@cvx/api";
import {
  CLAIM_EXPIRY_HOURS_DEFAULT,
  PASSWORD_MIN_LENGTH,
} from "@lot/shared";
import { Button, Card, FieldError, Input, Label } from "~/components/ui";

export const Route = createFileRoute("/setup")({
  component: SetupWizard,
});

function SetupWizard() {
  const navigate = useNavigate();
  const status = useQuery(api.settings.setupStatus);
  const runWizard = useAction(api.setup.wizard);

  const [form, setForm] = useState({
    serverManagerName: "",
    serverManagerEmail: "",
    password: "",
    orgName: "",
    twoFactorPolicy: "required" as "required" | "off",
    claimExpiryHours: CLAIM_EXPIRY_HOURS_DEFAULT,
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Once setup is complete, /setup is closed (C-01) — send members to sign in.
  useEffect(() => {
    if (status?.setupComplete) void navigate({ to: "/login" });
  }, [status?.setupComplete, navigate]);

  if (status === undefined) return null;
  if (status.setupComplete) return null;

  const update = (k: keyof typeof form, v: string | number) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.password.length < PASSWORD_MIN_LENGTH) {
      setError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
      return;
    }
    setSubmitting(true);
    try {
      await runWizard(form);
      await navigate({ to: "/login" });
    } catch {
      setError("Setup failed. The instance may already be configured.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center p-6">
      <h1 className="mb-1 text-2xl font-semibold">Set up your library</h1>
      <p className="mb-6 text-sm text-slate-500">
        Create the first server-manager account and name your organization.
      </p>
      <Card>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label htmlFor="orgName">Organization name</Label>
            <Input
              id="orgName"
              value={form.orgName}
              onChange={(e) => update("orgName", e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="name">Your name</Label>
            <Input
              id="name"
              value={form.serverManagerName}
              onChange={(e) => update("serverManagerName", e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="email">Your email</Label>
            <Input
              id="email"
              type="email"
              value={form.serverManagerEmail}
              onChange={(e) => update("serverManagerEmail", e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={form.password}
              onChange={(e) => update("password", e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="policy">Two-factor policy</Label>
            <select
              id="policy"
              className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
              value={form.twoFactorPolicy}
              onChange={(e) => update("twoFactorPolicy", e.target.value)}
            >
              <option value="required">Required for everyone (recommended)</option>
              <option value="off">Off (password only)</option>
            </select>
          </div>
          <FieldError>{error}</FieldError>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Setting up…" : "Create library"}
          </Button>
        </form>
      </Card>
    </main>
  );
}
