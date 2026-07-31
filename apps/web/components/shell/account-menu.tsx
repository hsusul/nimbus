"use client";

import type { MeResponse } from "@nimbus/contracts";
import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";

import { Menu, MenuItem, MenuSeparator } from "../ui/menu";

/**
 * Account control. Replaces the always-visible name/email block, which
 * consumed top-bar width on every route and was duplicated in the mobile
 * header. Sign-out remains gated on production auth, unchanged.
 */
export function AccountMenu({
  user,
  productionAuth,
}: {
  user: MeResponse["data"];
  productionAuth: boolean;
}) {
  const initial = user.displayName.slice(0, 1).toUpperCase();

  return (
    <Menu
      className="account-menu"
      label={`Account: ${user.displayName}`}
      trigger={
        <span className="account-avatar" aria-hidden="true">
          {initial}
        </span>
      }
    >
      <div className="account-menu__identity">
        <strong>{user.displayName}</strong>
        <span>{user.email}</span>
      </div>
      {productionAuth ? (
        <>
          <MenuSeparator />
          <MenuItem onSelect={() => void signOut({ callbackUrl: "/sign-in" })}>
            <LogOut aria-hidden="true" size={14} /> Sign out
          </MenuItem>
        </>
      ) : null}
    </Menu>
  );
}
