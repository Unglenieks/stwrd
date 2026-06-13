import { useAuthActions } from "@convex-dev/auth/react";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { api } from "@cvx/api";
import { PERMISSIONS } from "@lot/shared";
import { Button, Card, Input, Label } from "~/components/ui";

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
  const unread = useQuery(api.notifications.unreadCount) ?? 0;

  return (
    <main className="mx-auto max-w-2xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{settings?.orgName ?? "Library of Things"}</h1>
        <div className="flex items-center gap-3">
          <Link
            to="/notifications"
            className="relative inline-flex h-10 items-center rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            🔔
            {unread > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1 text-xs text-white">
                {unread}
              </span>
            )}
          </Link>
          <div className="w-28">
            <Button onClick={() => void signOut()}>Sign out</Button>
          </div>
        </div>
      </div>
      <Card>
        <p className="text-slate-700">
          Signed in as <span className="font-medium">{me?.name ?? me?.email}</span>.
        </p>
        <div className="mt-4 flex gap-3">
          <Link
            to="/items"
            className="inline-flex h-10 items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800"
          >
            Browse catalog
          </Link>
          <Link
            to="/contribute"
            className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            Contribute an item
          </Link>
          <Link
            to="/me"
            className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            My library
          </Link>
          <Link
            to="/branches"
            className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            Branches
          </Link>
        </div>
        <AdminLinks />
        <NotificationPref pref={me?.notificationPref} />
      </Card>
      <InviteMember />
    </main>
  );
}

function AdminLinks() {
  const perms = useQuery(api.roles.myPermissions) ?? [];
  const showClaims = perms.includes(PERMISSIONS.claimsManageAny) || perms.includes(PERMISSIONS.usersManage);
  const showSettings = perms.includes(PERMISSIONS.instanceSettings);
  if (!showClaims && !showSettings) return null;
  return (
    <div className="mt-3 flex gap-3 text-sm">
      <span className="text-slate-400">Admin:</span>
      {showClaims && (
        <Link to="/admin/claims" className="text-slate-700 underline">
          Circulation
        </Link>
      )}
      {showSettings && (
        <Link to="/admin/settings" className="text-slate-700 underline">
          Settings
        </Link>
      )}
    </div>
  );
}

function NotificationPref({ pref }: { pref?: "in_app" | "email" }) {
  const update = useMutation(api.users.updateProfile);
  if (!pref) return null;
  return (
    <label className="mt-4 flex items-center gap-2 text-sm text-slate-600">
      <input
        type="checkbox"
        checked={pref === "email"}
        onChange={(e) =>
          void update({ notificationPref: e.target.checked ? "email" : "in_app" })
        }
      />
      Also email me notifications
    </label>
  );
}

function InviteMember() {
  const perms = useQuery(api.roles.myPermissions);
  const invite = useAction(api.users.invite);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!perms?.includes(PERMISSIONS.usersCreate)) return null;

  async function onInvite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { inviteUrl } = await invite({ name, email });
      setLink(inviteUrl);
      setName("");
      setEmail("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-4">
      <h2 className="mb-3 text-lg font-semibold">Invite a member</h2>
      <form onSubmit={onInvite} className="flex flex-wrap items-end gap-3">
        <div className="min-w-40 flex-1">
          <Label htmlFor="inv-name">Name</Label>
          <Input id="inv-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="min-w-40 flex-1">
          <Label htmlFor="inv-email">Email</Label>
          <Input
            id="inv-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="w-32">
          <Button type="submit" disabled={busy}>
            Create invite
          </Button>
        </div>
      </form>
      {link && (
        <p className="mt-3 break-all text-sm text-slate-600">
          Invite link: <span data-testid="invite-link">{link}</span>
        </p>
      )}
    </Card>
  );
}
