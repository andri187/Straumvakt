"use client";

// React bindings for the shared structural store (src/lib/sync/structural-store.ts). The layout supplies the session
// partition; the store is one per document, so navigating between /cpo pages keeps what has been loaded and a different
// session can never see it.

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import type { StructuralStore } from "@/lib/sync/structural-store";
import { structuralStore } from "@/lib/sync/structural-singleton";

const PartitionContext = createContext<string | null>(null);

export function StructuralProvider({ partition, children }: { partition: string; children: ReactNode }) {
  return <PartitionContext.Provider value={partition}>{children}</PartitionContext.Provider>;
}

export function useStructural(): StructuralStore {
  const partition = useContext(PartitionContext);
  const store = useMemo(() => structuralStore(), []);
  if (partition) store.bind(partition); // idempotent; a different session's partition drops everything first
  useSyncExternalStore(store.subscribe, store.getVersion, () => 0);
  return store;
}

/** Runs `load` when a page is shown, then one eligible check on entry and on every return to the tab. No timers. */
export function useViewEntry(store: StructuralStore, load: () => Promise<void>) {
  useEffect(() => {
    let alive = true;
    void load().then(() => (alive ? store.onViewEnter() : undefined));
    const onVisible = () => {
      if (document.visibilityState === "visible") void store.onViewEnter();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);
}
