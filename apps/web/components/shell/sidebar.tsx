"use client";

import type { MeResponse } from "@nimbus/contracts";
import {
  BriefcaseBusiness,
  Clock3,
  Cloud,
  FileSearch,
  FolderOpen,
  Star,
  Trash2,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { forwardRef } from "react";

import { Button } from "../ui/button";
import { StorageSummary } from "./storage-summary";

interface NavDestination {
  href: string;
  label: string;
  icon: LucideIcon;
  /**
   * Destinations with no backing endpoint. `listShares` is per-file and there
   * is no recent-activity or favourites feed, so these are signposted as
   * unavailable rather than wired to a route that cannot return data.
   */
  unavailable?: boolean;
}

const NAVIGATION: NavDestination[] = [
  { href: "/files", label: "My Files", icon: FolderOpen },
  { href: "/recent", label: "Recent", icon: Clock3, unavailable: true },
  { href: "/shared", label: "Shared", icon: Users, unavailable: true },
  { href: "/favorites", label: "Favorites", icon: Star, unavailable: true },
  { href: "/search", label: "Search", icon: FileSearch },
  { href: "/jobs", label: "Jobs", icon: BriefcaseBusiness },
  { href: "/trash", label: "Trash", icon: Trash2 },
];

const UNAVAILABLE_REASON = "Not available yet";

export const Sidebar = forwardRef<
  HTMLElement,
  {
    user: MeResponse["data"];
    pathname: string;
    mobileViewport: boolean;
    mobileOpen: boolean;
    onClose(): void;
  }
>(function Sidebar({ user, pathname, mobileViewport, mobileOpen, onClose }, ref) {
  return (
    <aside
      ref={ref}
      id="primary-navigation"
      className={`sidebar ${mobileOpen ? "sidebar--open" : ""}`.trim()}
      aria-label="Primary navigation"
      aria-hidden={mobileViewport && !mobileOpen ? true : undefined}
      aria-modal={mobileViewport && mobileOpen ? true : undefined}
      inert={mobileViewport && !mobileOpen ? true : undefined}
      role={mobileViewport ? "dialog" : undefined}
    >
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <Cloud size={15} strokeWidth={2} />
        </span>
        <span className="brand-lockup">
          <strong>Nimbus</strong>
          <small>Object storage</small>
        </span>
        <Button
          className="sidebar-close"
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Close navigation"
        >
          <X aria-hidden="true" size={17} strokeWidth={1.8} />
        </Button>
      </div>

      <nav aria-label="Sections">
        {NAVIGATION.map(({ href, label, icon: Icon, unavailable }) => {
          if (unavailable) {
            return (
              <span
                key={href}
                className="nav-link nav-link--unavailable"
                aria-disabled="true"
                title={UNAVAILABLE_REASON}
              >
                <Icon aria-hidden="true" size={15} strokeWidth={1.8} />
                <span>{label}</span>
                <small>Soon</small>
              </span>
            );
          }
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={active ? "nav-link nav-link--active" : "nav-link"}
              aria-current={active ? "page" : undefined}
            >
              <Icon aria-hidden="true" size={15} strokeWidth={1.8} />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      <StorageSummary storage={user.storage} />
    </aside>
  );
});
