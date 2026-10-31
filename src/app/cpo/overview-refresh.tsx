"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

// Only timestamps, never page data. Shared across remounts in this document.
// This paces ordinary UI clicks; it is not a distributed abuse limiter.
const nextAllowed = new Map<string, number>();
const COOLDOWN_MS = 30_000;

export function OverviewRefresh() {
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [now, setNow] = useState(0);
  const [until, setUntil] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    setUntil(nextAllowed.get(pathname) ?? 0);
  }, [pathname]);
  useEffect(() => {
    if (until <= now) return;
    // Local countdown only: no network requests or background checks.
    const timer = setTimeout(() => setNow(Date.now()), 1000);
    return () => clearTimeout(timer);
  }, [until, now]);
  const remaining = Math.max(0, Math.ceil((until - now) / 1000));
  return <button type="button" className="ws-button" disabled={pending || remaining > 0} aria-busy={pending}
    onClick={() => {
      const time = Date.now();
      if (pending || time < (nextAllowed.get(pathname) ?? 0)) return;
      const deadline = time + COOLDOWN_MS;
      nextAllowed.set(pathname, deadline);
      setNow(time); setUntil(deadline);
      startTransition(() => router.refresh());
    }}>
    <RefreshCw size={15} aria-hidden="true" />
    {pending ? "Refreshing…" : remaining > 0 ? `Refresh in ${remaining}s` : "Refresh"}
  </button>;
}
