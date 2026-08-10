import type { ReactNode } from "react";
import { Sidebar } from "@/components/sidebar";
import "./globals.css";

export const metadata = {
  title: "Straumvakt · Zaptec enrichment",
  description: "Live Zaptec charger profiles styled for Straumvakt",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen bg-bg-base text-ink-50">
          <Sidebar />
          <main className="flex-1 min-w-0 overflow-x-hidden md:ml-64">{children}</main>
        </div>
      </body>
    </html>
  );
}
