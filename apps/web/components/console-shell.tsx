"use client";

import type { MeResponse } from "@nimbus/contracts";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import type { ApiClientConfig } from "../lib/api-client";
import { Sidebar } from "./shell/sidebar";
import { Topbar } from "./shell/topbar";

const MOBILE_QUERY = "(max-width: 899px)";

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
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const pathname = usePathname();

  useEffect(() => setMobileOpen(false), [pathname]);

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    const update = () => setMobileViewport(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  // Trap focus inside the mobile navigation drawer while it is open.
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

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <div className="console-layout">
        <Sidebar
          ref={sidebarRef}
          user={user}
          pathname={pathname}
          mobileViewport={mobileViewport}
          mobileOpen={mobileOpen}
          onClose={() => setMobileOpen(false)}
        />
        {mobileOpen ? (
          <button
            type="button"
            className="sidebar-scrim"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          />
        ) : null}
        <div className="console-main">
          <Topbar
            ref={mobileMenuButtonRef}
            user={user}
            productionAuth={Boolean(config.productionAuth)}
            mobileOpen={mobileOpen}
            onToggleNavigation={() => setMobileOpen((value) => !value)}
          />
          <main id="main-content" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
    </>
  );
}
