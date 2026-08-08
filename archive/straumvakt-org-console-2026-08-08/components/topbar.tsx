"use client";

import { useRouter } from "next/navigation";
import { LogOut, Menu } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { useSidebar } from "@/components/sidebar-context";
import { apiFetch } from "@/lib/api-client";

export function Topbar({
  title,
  email,
}: {
  title: string;
  email?: string;
}) {
  const { language } = useLanguage();
  const { toggle } = useSidebar();
  const router = useRouter();

  async function onLogout() {
    try {
      await apiFetch("/api/admin/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <header className="flex h-14 items-center justify-between border-b border-bg-border bg-bg-surface/60 px-4 backdrop-blur">
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="rounded-md p-2 text-ink-300 hover:bg-bg-raised hover:text-ink-50 md:hidden"
          onClick={toggle}
          aria-label="Toggle sidebar"
        >
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="text-sm font-semibold text-ink-100">{title}</h1>
      </div>
      <div className="flex items-center gap-3">
        {email ? (
          <span className="hidden text-xs text-ink-400 md:inline">{email}</span>
        ) : null}
        <button
          type="button"
          onClick={onLogout}
          className="flex items-center gap-2 rounded-md border border-bg-border px-3 py-1.5 text-xs font-medium text-ink-200 hover:bg-bg-raised hover:text-ink-50"
        >
          <LogOut className="h-4 w-4" />
          <span>{language === "is" ? "Skrá út" : "Sign out"}</span>
        </button>
      </div>
    </header>
  );
}
