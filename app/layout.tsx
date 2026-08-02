import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import { SiteShell } from "./SiteShell";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.PUBLIC_APP_ORIGIN ?? "https://buzzrouter.com",
  ),
  title: "BuzzRouter",
  description: "Discover and compare Buzz communities.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SiteShell>{children}</SiteShell>
      </body>
    </html>
  );
}
