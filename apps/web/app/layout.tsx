import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./styles.css";
import "./console-theme.css";

export const metadata: Metadata = {
  title: { default: "Nimbus", template: "%s · Nimbus" },
  description: "API-first object storage and file collaboration platform.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light",
  themeColor: "#f5f9ff",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
