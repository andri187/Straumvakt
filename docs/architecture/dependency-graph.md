# Dependency graph — generated

**Do not edit.** Written by `scripts/gen-dependency-graph.mjs` from the
actual import graph. Regenerate with `npm run deps:graph`; `npm run check`
fails if this file is stale.

Boxes are folders, collapsed one level below each source root, so this shows
shape rather than files. Rules live in [`.dependency-cruiser.cjs`](../../.dependency-cruiser.cjs).

## Intended direction

```
  commercial ──► charging ──► assets ──► identity

  nothing may import vendor        an adapter must never appear in the core
  platform imports nothing         logs, audit, webhooks are a leaf
```

Prisma cannot express this — a relation is declared on both sides, so the
schema-level graph is necessarily symmetric. It is enforced over TypeScript
or nowhere.

## Actual

```mermaid
flowchart LR

subgraph 0["apps"]
subgraph 1["api"]
subgraph 2["src"]
3["bindings.ts"]
4["index.ts"]
5["lib"]
6["queues"]
7["repositories"]
8["routes"]
end
end
end
subgraph 9["docs"]
subgraph A["reference"]
B["iceland-energy-parties.json"]
end
end
C["fs"]
subgraph D["packages"]
E["shared"]
end
F["path"]
subgraph G["public"]
subgraph H["zaptec"]
I["openapi.json"]
J["zaptec-constants.json"]
end
end
subgraph K["src"]
L["app"]
M["components"]
N["lib"]
end
3-->5
4-->3
4-->5
4-->6
4-->8
5-->3
5-->7
5-->E
6-->3
6-->5
7-->5
7-->E
7-->3
8-->3
8-->5
8-->7
8-->E
L-->M
L-->N
L-->E
L-->C
L-->F
L-->I
L-->J
M-->N
M-->L
N-->B
```

## Known violations

23 recorded in [`.dependency-cruiser-known-violations.json`](../../.dependency-cruiser-known-violations.json).

These are grandfathered, not accepted. A new one fails the build; removing
an entry is how a leak gets fixed. Adding one requires saying why.

### `no-import-from-vendor` — 22

| from | to |
|---|---|
| `apps/api/src/index.ts` | `apps/api/src/lib/zaptec-sync-cron.ts` |
| `apps/api/src/repositories/charger-technical-read.ts` | `apps/api/src/lib/credential-crypto.ts` |
| `apps/api/src/repositories/charger-technical-read.ts` | `apps/api/src/lib/zaptec.ts` |
| `apps/api/src/repositories/charger-zaptec-config.ts` | `apps/api/src/lib/credential-crypto.ts` |
| `apps/api/src/repositories/charger-zaptec-config.ts` | `apps/api/src/lib/zaptec.ts` |
| `apps/api/src/repositories/chargers.ts` | `apps/api/src/lib/zaptec.ts` |
| `apps/api/src/repositories/chargers.ts` | `apps/api/src/repositories/credential-management.ts` |
| `apps/api/src/repositories/site-tree.ts` | `apps/api/src/lib/credential-crypto.ts` |
| `apps/api/src/repositories/site-tree.ts` | `apps/api/src/lib/zaptec.ts` |
| `apps/api/src/routes/admin/groups.ts` | `apps/api/src/repositories/vendor-user-groups.ts` |
| `apps/api/src/routes/admin/vendor-credentials.ts` | `apps/api/src/lib/zaptec.ts` |
| `apps/api/src/routes/admin/vendor-credentials.ts` | `apps/api/src/repositories/credential-management.ts` |
| `apps/api/src/routes/admin/vendor-credentials.ts` | `apps/api/src/repositories/vendor-credential-probe.ts` |
| `apps/api/src/routes/admin/vendor-credentials.ts` | `apps/api/src/repositories/vendor-credentials.ts` |
| `apps/api/src/routes/admin/vendor-credentials.ts` | `apps/api/src/repositories/zaptec-session-probe.ts` |
| `apps/api/src/routes/admin/vendor-credentials.ts` | `apps/api/src/repositories/zaptec-session-sync.ts` |
| `apps/api/src/routes/admin/zaptec.ts` | `apps/api/src/lib/zaptec.ts` |
| `apps/api/src/routes/admin/zaptec.ts` | `apps/api/src/repositories/vendor-credentials.ts` |
| `apps/api/src/routes/admin/zaptec.ts` | `apps/api/src/repositories/zaptec-bulk-config.ts` |
| `apps/api/src/routes/admin/zaptec.ts` | `apps/api/src/repositories/zaptec-import.ts` |
| `apps/api/src/routes/internal/zaptec-trigger-sync.ts` | `apps/api/src/repositories/credential-management.ts` |
| `apps/api/src/routes/internal/zaptec-trigger-sync.ts` | `apps/api/src/repositories/zaptec-session-sync.ts` |

### `no-circular` — 1

| from | to |
|---|---|
| `src/app/(app)/accounts/organizations/[id]/email-domains/email-domains-panel.tsx` | `src/app/(app)/accounts/organizations/[id]/email-domains/page.tsx` |

