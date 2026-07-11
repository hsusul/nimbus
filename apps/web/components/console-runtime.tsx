"use client";

import type { MeResponse } from "@nimbus/contracts";
import {
  BriefcaseBusiness,
  Cloud,
  FileSearch,
  FolderOpen,
  HardDrive,
  LogOut,
  Menu,
  Search,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { NimbusApiClient, type ApiClientConfig } from "../lib/api-client";
import { formatFileSize } from "../lib/formatters";
import { Button } from "./ui/button";
import { ErrorNotice, TableSkeleton } from "./ui/feedback";
import { ToastProvider } from "./ui/toast";
import { UploadProvider } from "./uploads/upload-provider";

interface ConsoleRuntimeValue {
  api: NimbusApiClient;
  user: MeResponse["data"];
}

const ConsoleRuntimeContext = createContext<ConsoleRuntimeValue | null>(null);

const navigation = [
  { href: "/files", label: "Files", icon: FolderOpen },
  { href: "/search", label: "Search", icon: FileSearch },
  { href: "/jobs", label: "Jobs", icon: BriefcaseBusiness },
  { href: "/trash", label: "Trash", icon: Trash2 },
];

export function ConsoleRuntime({
  config,
  children,
}: {
  config: ApiClientConfig;
  children: ReactNode;
}) {
  const api = useMemo(() => new NimbusApiClient(config), [config]);
  const [user, setUser] = useState<MeResponse["data"] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [globalQuery, setGlobalQuery] = useState("");
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    let active = true;
    api.me
      .then((result) => active && setUser(result.data))
      .catch((reason) => active && setError(reason));
    return () => {
      active = false;
    };
  }, [api]);
  useEffect(() => setMobileOpen(false), [pathname]);

  if (error) {
    return (
      <main className="standalone-state">
        <ErrorNotice error={error} onRetry={() => window.location.reload()} />
      </main>
    );
  }
  if (!user) {
    return (
      <main className="standalone-state">
        <TableSkeleton rows={4} />
      </main>
    );
  }

  const quotaBytes = BigInt(user.storage.quotaBytes);
  const usedBytes = BigInt(user.storage.usedBytes);
  const storagePercent = quotaBytes > 0n ? Number((usedBytes * 100n) / quotaBytes) : 0;

  return (
    <ConsoleRuntimeContext.Provider value={{ api, user }}>
      <ToastProvider>
        <UploadProvider>
          <a className="skip-link" href="#main-content">
            Skip to main content
          </a>
          <div className="console-layout">
            <aside
              className={`sidebar ${mobileOpen ? "sidebar--open" : ""}`}
              aria-label="Primary navigation"
            >
              <div className="brand">
                <span className="brand-mark" aria-hidden="true">
                  <Cloud size={22} strokeWidth={2.2} />
                </span>
                <span>Nimbus</span>
              </div>
              <nav>
                {navigation.map(({ href, label, icon: Icon }) => (
                  <Link
                    key={href}
                    href={href}
                    className={pathname.startsWith(href) ? "nav-link nav-link--active" : "nav-link"}
                    aria-current={pathname.startsWith(href) ? "page" : undefined}
                  >
                    <Icon aria-hidden="true" size={18} /> {label}
                  </Link>
                ))}
              </nav>
              <div className="sidebar-storage">
                <div className="sidebar-storage__heading">
                  <span>
                    <HardDrive aria-hidden="true" size={17} /> Storage
                  </span>
                  <strong>{Math.min(storagePercent, 100)}%</strong>
                </div>
                <div className="sidebar-storage__meter" aria-hidden="true">
                  <span style={{ width: `${Math.min(storagePercent, 100)}%` }} />
                </div>
                <p>
                  <strong>{formatFileSize(user.storage.usedBytes)}</strong> of{" "}
                  {formatFileSize(user.storage.quotaBytes)} used
                </p>
              </div>
            </aside>
            {mobileOpen ? (
              <button
                className="sidebar-scrim"
                onClick={() => setMobileOpen(false)}
                aria-label="Close navigation"
              />
            ) : null}
            <div className="console-main">
              <header className="console-topbar">
                <form
                  className="global-search"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const query = globalQuery.trim();
                    router.push(`/search${query ? `?q=${encodeURIComponent(query)}` : ""}`);
                  }}
                >
                  <Search aria-hidden="true" size={18} />
                  <label className="sr-only" htmlFor="global-search-input">
                    Search all Nimbus
                  </label>
                  <input
                    id="global-search-input"
                    type="search"
                    value={globalQuery}
                    onChange={(event) => setGlobalQuery(event.target.value)}
                    placeholder="Search files and folders"
                  />
                </form>
                <div className="topbar-account">
                  <div>
                    <strong>{user.displayName}</strong>
                    <span>{user.email}</span>
                  </div>
                  <div className="account-avatar" aria-hidden="true">
                    {user.displayName.slice(0, 1).toUpperCase()}
                    <span />
                  </div>
                  {config.productionAuth ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Sign out"
                      onClick={() => void signOut({ callbackUrl: "/sign-in" })}
                    >
                      <LogOut aria-hidden="true" size={18} />
                    </Button>
                  ) : null}
                </div>
              </header>
              <header className="mobile-header">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setMobileOpen((value) => !value)}
                  aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
                  aria-expanded={mobileOpen}
                >
                  {mobileOpen ? (
                    <X aria-hidden="true" size={20} />
                  ) : (
                    <Menu aria-hidden="true" size={20} />
                  )}
                </Button>
                <div className="brand brand--mobile">
                  <span className="brand-mark" aria-hidden="true">
                    <Cloud size={19} strokeWidth={2.2} />
                  </span>
                  <span>Nimbus</span>
                </div>
                <div className="account-avatar account-avatar--mobile" aria-hidden="true">
                  {user.displayName.slice(0, 1).toUpperCase()}
                </div>
                {config.productionAuth ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Sign out"
                    onClick={() => void signOut({ callbackUrl: "/sign-in" })}
                  >
                    <LogOut aria-hidden="true" size={18} />
                  </Button>
                ) : null}
              </header>
              <main id="main-content" tabIndex={-1}>
                {children}
              </main>
            </div>
          </div>
        </UploadProvider>
      </ToastProvider>
    </ConsoleRuntimeContext.Provider>
  );
}

export function useConsole() {
  const value = useContext(ConsoleRuntimeContext);
  if (!value) throw new Error("useConsole must be used within ConsoleRuntime.");
  return value;
}
