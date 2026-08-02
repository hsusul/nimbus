"use client";

import type { MeResponse } from "@nimbus/contracts";
import { Menu as MenuIcon, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { forwardRef, useEffect, useRef, useState } from "react";

import { Button } from "../ui/button";
import { AccountMenu } from "./account-menu";

/**
 * Application top bar: one header that adapts, rather than a desktop header
 * and a mobile header both sitting in the DOM with duplicated account
 * controls and duplicated accessible names.
 */
export const Topbar = forwardRef<
  HTMLButtonElement,
  {
    user: MeResponse["data"];
    productionAuth: boolean;
    mobileOpen: boolean;
    onToggleNavigation(): void;
  }
>(function Topbar({ user, productionAuth, mobileOpen, onToggleNavigation }, menuButtonRef) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focusQuickSearch = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.key !== "/" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        (target instanceof HTMLElement &&
          (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)))
      ) {
        return;
      }

      event.preventDefault();
      searchInputRef.current?.focus();
    };

    window.addEventListener("keydown", focusQuickSearch);
    return () => window.removeEventListener("keydown", focusQuickSearch);
  }, []);

  return (
    <header className="console-topbar">
      <Button
        ref={menuButtonRef}
        className="topbar-nav-toggle"
        variant="ghost"
        size="icon"
        onClick={onToggleNavigation}
        aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
        aria-controls="primary-navigation"
        aria-expanded={mobileOpen}
      >
        <MenuIcon aria-hidden="true" size={18} strokeWidth={1.8} />
      </Button>

      <form
        className="global-search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = query.trim();
          router.push(`/search${trimmed ? `?q=${encodeURIComponent(trimmed)}` : ""}`);
        }}
      >
        <Search aria-hidden="true" size={14} strokeWidth={1.8} />
        {/*
          Distinct from the search page's own input, which owns the name
          "Search files and folders". This one navigates to /search on submit.
        */}
        <label className="sr-only" htmlFor="global-search-input">
          Quick search
        </label>
        <input
          ref={searchInputRef}
          id="global-search-input"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Quick search files and folders"
        />
        <kbd aria-hidden="true">/</kbd>
      </form>

      <AccountMenu user={user} productionAuth={productionAuth} />
    </header>
  );
});
