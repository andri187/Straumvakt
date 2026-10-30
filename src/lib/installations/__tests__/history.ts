// Test helper: the history view of a MemoryStore, shaped like loadHistory().

import type { MemoryStore } from "./memory-store";
import type { HistoryEntry } from "../drizzle-store";

export function loadHistoryForTest(store: MemoryStore, installationId: string): HistoryEntry[] {
  return store.state.changes
    .filter((c) => c.installationId === installationId)
    .map((c, i) => ({
      id: `h-${i}`,
      revision: c.revision,
      entityType: c.entityType,
      entityId: c.entityId,
      action: c.action,
      diff: c.diff,
      actorLabel: c.actorLabel,
      effectiveAt: c.effectiveAt ? c.effectiveAt.toISOString() : null,
      occurredAt: "2026-10-29T12:00:00.000Z",
    }))
    .reverse();
}
