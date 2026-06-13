import { useConvexAuth, useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { api } from "@cvx/api";
import { PERMISSIONS } from "@lot/shared";
import { Button, Card, FieldError, Input, Label } from "~/components/ui";

export const Route = createFileRoute("/admin/settings")({
  component: AdminSettingsPage,
});

function AdminSettingsPage() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const perms = useQuery(api.roles.myPermissions);
  useEffect(() => {
    if (!isLoading && !isAuthenticated) void navigate({ to: "/login" });
  }, [isLoading, isAuthenticated, navigate]);
  if (isLoading || !isAuthenticated || perms === undefined) return null;
  if (!perms.includes(PERMISSIONS.instanceSettings)) {
    return <main className="p-6 text-slate-500">You don't have access to settings.</main>;
  }
  return <SettingsForm />;
}

function SettingsForm() {
  const settings = useQuery(api.settings.get);
  const update = useMutation(api.settings.update);
  const testSmtp = useAction(api.emailDrain.testSmtp);

  const [smtp, setSmtp] = useState({
    host: "",
    port: 587,
    secure: false,
    username: "",
    password: "",
    fromAddress: "",
  });
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus(null);
    setBusy(true);
    try {
      await update({ smtp });
      setStatus("Saved.");
    } catch {
      setError("Could not save SMTP settings.");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setError(null);
    setStatus(null);
    setBusy(true);
    try {
      await testSmtp({});
      setStatus("Test email sent.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="mb-1 text-2xl font-semibold">Settings</h1>
      <p className="mb-6 text-sm text-slate-500">
        Org: {settings?.orgName} · SMTP {settings?.smtpConfigured ? "configured" : "not configured"}
      </p>
      <Card>
        <h2 className="mb-3 font-semibold">Email (SMTP)</h2>
        <form onSubmit={save} className="space-y-3">
          <div>
            <Label htmlFor="host">Host</Label>
            <Input id="host" value={smtp.host} onChange={(e) => setSmtp({ ...smtp, host: e.target.value })} required />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <Label htmlFor="port">Port</Label>
              <Input
                id="port"
                type="number"
                value={smtp.port}
                onChange={(e) => setSmtp({ ...smtp, port: Number(e.target.value) })}
                required
              />
            </div>
            <label className="mt-7 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={smtp.secure}
                onChange={(e) => setSmtp({ ...smtp, secure: e.target.checked })}
              />
              TLS
            </label>
          </div>
          <div>
            <Label htmlFor="username">Username</Label>
            <Input id="username" value={smtp.username} onChange={(e) => setSmtp({ ...smtp, username: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" value={smtp.password} onChange={(e) => setSmtp({ ...smtp, password: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="from">From address</Label>
            <Input id="from" type="email" value={smtp.fromAddress} onChange={(e) => setSmtp({ ...smtp, fromAddress: e.target.value })} required />
          </div>
          {status && <p className="text-sm text-green-700">{status}</p>}
          <FieldError>{error}</FieldError>
          <div className="flex flex-wrap gap-2">
            <div className="w-32">
              <Button type="submit" disabled={busy}>Save</Button>
            </div>
            <div className="w-40">
              <Button type="button" disabled={busy} onClick={sendTest}>Send test email</Button>
            </div>
            {settings?.smtpConfigured && (
              <div className="w-44">
                <Button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setError(null);
                    setStatus(null);
                    setBusy(true);
                    try {
                      await update({ smtp: null });
                      setStatus("Email configuration removed.");
                    } catch {
                      setError("Could not remove email configuration.");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Remove email config
                </Button>
              </div>
            )}
          </div>
        </form>
      </Card>
    </main>
  );
}
