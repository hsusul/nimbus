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
import { useEffect, useRef, useState, type ReactNode } from "react";

import type { ApiClientConfig } from "../lib/api-client";
import { formatFileSize } from "../lib/formatters";
import { Button } from "./ui/button";

const navigation = [
  { href: "/files", label: "Files", icon: FolderOpen },
  { href: "/search", label: "Search", icon: FileSearch },
  { href: "/jobs", label: "Jobs", icon: BriefcaseBusiness },
  { href: "/trash", label: "Trash", icon: Trash2 },
];

export function ConsoleShell({
  config,
  user,
  children,
}: {
  config: ApiClientConfig;
  user: MeResponse["data"];
  children: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileViewport, setMobileViewport] = useState(false);
  const [globalQuery, setGlobalQuery] = useState("");
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => setMobileOpen(false), [pathname]);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 899px)");
    const updateViewport = () => setMobileViewport(media.matches);
    updateViewport();
    media.addEventListener("change", updateViewport);
    return () => media.removeEventListener("change", updateViewport);
  }, []);
  useEffect(() => {
    if (!mobileViewport || !mobileOpen) return;
    const sidebar = sidebarRef.current;
    const focusable = sidebar?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const first = focusable?.[0];
    const last = focusable?.[focusable.length - 1];
    const frame = window.requestAnimationFrame(() => first?.focus());
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileOpen(false);
        return;
      }
      if (event.key !== "Tab" || !first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      mobileMenuButtonRef.current?.focus();
    };
  }, [mobileOpen, mobileViewport]);

  const quotaBytes = BigInt(user.storage.quotaBytes);
  const usedBytes = BigInt(user.storage.usedBytes);
  const storagePercent = quotaBytes > 0n ? Number((usedBytes * 100n) / quotaBytes) : 0;
  const boundedStoragePercent = Math.min(Math.max(storagePercent, 0), 100);

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <div className="console-layout">
        <aside
          ref={sidebarRef}
          id="primary-navigation"
          className={`sidebar ${mobileOpen ? "sidebar--open" : ""}`}
          aria-label="Primary navigation"
          aria-hidden={mobileViewport && !mobileOpen ? true : undefined}
          aria-modal={mobileViewport && mobileOpen ? true : undefined}
          inert={mobileViewport && !mobileOpen ? true : undefined}
          role={mobileViewport ? "dialog" : undefined}
        >
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              <Cloud size={21} strokeWidth={1.7} />
            </span>
            <span className="brand-lockup">
              <strong>Nimbus</strong>
              <small>Object system</small>
            </span>
            <Button
              className="sidebar-close"
              variant="ghost"
              size="icon"
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation"
            >
              <X aria-hidden="true" size={19} strokeWidth={1.7} />
            </Button>
          </div>
          <nav>
            {navigation.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={pathname.startsWith(href) ? "nav-link nav-link--active" : "nav-link"}
                aria-current={pathname.startsWith(href) ? "page" : undefined}
              >
                <Icon aria-hidden="true" size={17} strokeWidth={1.7} />
                <span>{label}</span>
              </Link>
            ))}
          </nav>
          <section className="sidebar-storage" aria-labelledby="storage-usage-heading">
            <div className="sidebar-storage__heading">
              <span id="storage-usage-heading">
                <HardDrive aria-hidden="true" size={16} strokeWidth={1.7} /> Storage
              </span>
              <strong>{boundedStoragePercent}%</strong>
            </div>
            <meter
              className="sidebar-storage__meter"
              min={0}
              max={100}
              value={boundedStoragePercent}
              aria-label={`${boundedStoragePercent}% of storage quota used`}
            />
            <p>
              <strong>{formatFileSize(user.storage.usedBytes)}</strong> of{" "}
              {formatFileSize(user.storage.quotaBytes)} used
            </p>
          </section>
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
              <Search aria-hidden="true" size={17} strokeWidth={1.7} />
              <label className="sr-only" htmlFor="global-search-input">
                Quick search Nimbus
              </label>
              <input
                id="global-search-input"
                type="search"
                value={globalQuery}
                onChange={(event) => setGlobalQuery(event.target.value)}
                placeholder="Quick search files and folders"
              />
            </form>
            <div className="topbar-account">
              <div>
                <strong>{user.displayName}</strong>
                <span>{user.email}</span>
              </div>
              <div className="account-avatar" aria-hidden="true">
                {user.displayName.slice(0, 1).toUpperCase()}
              </div>
              {config.productionAuth ? (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Sign out"
                  onClick={() => void signOut({ callbackUrl: "/sign-in" })}
                >
                  <LogOut aria-hidden="true" size={18} strokeWidth={1.7} />
                </Button>
              ) : null}
            </div>
          </header>
          <header className="mobile-header">
            <Button
              ref={mobileMenuButtonRef}
              variant="ghost"
              size="icon"
              onClick={() => setMobileOpen((value) => !value)}
              aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
              aria-controls="primary-navigation"
              aria-expanded={mobileOpen}
            >
              {mobileOpen ? (
                <X aria-hidden="true" size={20} strokeWidth={1.7} />
              ) : (
                <Menu aria-hidden="true" size={20} strokeWidth={1.7} />
              )}
            </Button>
            <div className="brand brand--mobile">
              <span className="brand-mark" aria-hidden="true">
                <Cloud size={19} strokeWidth={1.7} />
              </span>
              <span className="brand-lockup">
                <strong>Nimbus</strong>
                <small>Object system</small>
              </span>
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
                <LogOut aria-hidden="true" size={18} strokeWidth={1.7} />
              </Button>
            ) : null}
          </header>
          <main id="main-content" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
    </>
  );
}
