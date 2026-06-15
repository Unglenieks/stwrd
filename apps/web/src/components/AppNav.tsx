import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";
import { useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { api } from "@cvx/api";
import { PERMISSIONS } from "@stwrd/shared";
import { cn } from "~/lib/utils";

const HIDE_ON = ["/login", "/setup"];

export function AppNav() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { location } = useRouterState();
  const [menuOpen, setMenuOpen] = useState(false);

  const hideOnPath =
    HIDE_ON.includes(location.pathname) || location.pathname.startsWith("/invite/");

  if (isLoading || !isAuthenticated || hideOnPath) return null;

  return <NavBar menuOpen={menuOpen} setMenuOpen={setMenuOpen} />;
}

function NavBar({
  menuOpen,
  setMenuOpen,
}: {
  menuOpen: boolean;
  setMenuOpen: (v: boolean) => void;
}) {
  const { signOut } = useAuthActions();
  const settings = useQuery(api.settings.get);
  const unread = useQuery(api.notifications.unreadCount) ?? 0;
  const perms = useQuery(api.roles.myPermissions) ?? [];

  const showClaims =
    perms.includes(PERMISSIONS.claimsManageAny) || perms.includes(PERMISSIONS.usersManage);
  const showAudit = perms.includes(PERMISSIONS.instanceAuditView);
  const showSettings = perms.includes(PERMISSIONS.instanceSettings);
  const hasAdmin = showClaims || showAudit || showSettings;

  const orgName = settings?.orgName ?? "Stwrd";

  return (
    <nav className="sticky top-0 z-50 border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link
          to="/"
          className="text-base font-semibold text-slate-900 hover:text-slate-700"
          onClick={() => setMenuOpen(false)}
        >
          {orgName}
        </Link>

        {/* Desktop links */}
        <div className="hidden items-center gap-0.5 md:flex">
          <NavLink to="/items">Browse</NavLink>
          <NavLink to="/contribute">Contribute</NavLink>
          <NavLink to="/me">My Library</NavLink>
          <NavLink to="/branches">Branches</NavLink>
          {hasAdmin && (
            <AdminMenu
              showClaims={showClaims}
              showAudit={showAudit}
              showSettings={showSettings}
            />
          )}
        </div>

        <div className="flex items-center gap-1">
          <Link
            to="/notifications"
            className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100"
            aria-label="Notifications"
          >
            🔔
            {unread > 0 && (
              <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-0.5 text-[10px] font-medium text-white">
                {unread}
              </span>
            )}
          </Link>
          <button
            onClick={() => void signOut()}
            className="hidden h-9 items-center rounded-md px-3 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 md:inline-flex"
          >
            Sign out
          </button>
          {/* Mobile hamburger */}
          <button
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 md:hidden"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
          >
            {menuOpen ? "✕" : "☰"}
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {menuOpen && (
        <div className="border-t border-slate-100 bg-white px-4 pb-4 md:hidden">
          <div className="flex flex-col gap-0.5 pt-2">
            <MobileNavLink to="/items" onClick={() => setMenuOpen(false)}>
              Browse
            </MobileNavLink>
            <MobileNavLink to="/contribute" onClick={() => setMenuOpen(false)}>
              Contribute
            </MobileNavLink>
            <MobileNavLink to="/me" onClick={() => setMenuOpen(false)}>
              My Library
            </MobileNavLink>
            <MobileNavLink to="/branches" onClick={() => setMenuOpen(false)}>
              Branches
            </MobileNavLink>
            {hasAdmin && (
              <>
                <div className="mt-2 border-t border-slate-100 pt-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                  Admin
                </div>
                {showClaims && (
                  <MobileNavLink to="/admin/claims" onClick={() => setMenuOpen(false)}>
                    Circulation
                  </MobileNavLink>
                )}
                {showAudit && (
                  <MobileNavLink to="/admin/audit" onClick={() => setMenuOpen(false)}>
                    Audit &amp; Email
                  </MobileNavLink>
                )}
                {showSettings && (
                  <MobileNavLink to="/admin/settings" onClick={() => setMenuOpen(false)}>
                    Settings
                  </MobileNavLink>
                )}
              </>
            )}
            <button
              onClick={() => {
                setMenuOpen(false);
                void signOut();
              }}
              className="mt-2 flex h-10 items-center rounded-md px-3 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  const { location } = useRouterState();
  const isActive =
    location.pathname === to || (to !== "/" && location.pathname.startsWith(to));
  return (
    <Link
      to={to}
      className={cn(
        "inline-flex h-9 items-center rounded-md px-3 text-sm font-medium transition-colors",
        isActive
          ? "bg-slate-100 text-slate-900"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
      )}
    >
      {children}
    </Link>
  );
}

function MobileNavLink({
  to,
  children,
  onClick,
}: {
  to: string;
  children: React.ReactNode;
  onClick: () => void;
}) {
  const { location } = useRouterState();
  const isActive =
    location.pathname === to || (to !== "/" && location.pathname.startsWith(to));
  return (
    <Link
      to={to}
      onClick={onClick}
      className={cn(
        "flex h-10 items-center rounded-md px-3 text-sm font-medium",
        isActive ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:bg-slate-100",
      )}
    >
      {children}
    </Link>
  );
}

function AdminMenu({
  showClaims,
  showAudit,
  showSettings,
}: {
  showClaims: boolean;
  showAudit: boolean;
  showSettings: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="relative"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex h-9 items-center gap-1 rounded-md px-3 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      >
        Admin
        <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 rounded-lg border border-slate-200 bg-white py-1 shadow-md">
          {showClaims && (
            <Link
              to="/admin/claims"
              onClick={() => setOpen(false)}
              className="flex h-9 items-center px-3 text-sm text-slate-700 hover:bg-slate-50"
            >
              Circulation
            </Link>
          )}
          {showAudit && (
            <Link
              to="/admin/audit"
              onClick={() => setOpen(false)}
              className="flex h-9 items-center px-3 text-sm text-slate-700 hover:bg-slate-50"
            >
              Audit &amp; Email
            </Link>
          )}
          {showSettings && (
            <Link
              to="/admin/settings"
              onClick={() => setOpen(false)}
              className="flex h-9 items-center px-3 text-sm text-slate-700 hover:bg-slate-50"
            >
              Settings
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
