# ADR 0041 — Complete local authorization list management (SendLocalList Half C + Native-mode parity)

**Status:** Proposed — 2026-08-03. Not scheduled; captured as backlog per [CLAUDE.md](../../CLAUDE.md) Rule 11.
**Relates to:** [ADR 0019](./0019-agreement-and-bearer-architecture.md) (contract gate reused by the push path), [ADR 0020](./0020-driver-access-via-driver-groups.md) (driver access — the roster this list mirrors), the read-only CSMS roster in `apps/api/src/repositories/charger-technical-read.ts` (Half A), and the single-token push in `apps/api/src/repositories/local-auth-list-push.ts` (Half B).
**Rule 5 flag:** This touches OCPP handler semantics *and* access-grant propagation. Any implementation of this ADR must stop-and-summarise before writing code, per Rule 5.

---

## Context

Control of a charger's on-device local authorization list is currently **half-built**, and the gaps are load-bearing for offline authorization correctness.

**What exists today:**
- **Half A — read-only roster.** `getLocalAuthRosterForInstallation` surfaces the CSMS-side view (what *would* be pushed) on the Technical Read page. It is a projection of the `IdToken` table, not the charger's actual list — OCPP 1.6J has no read-contents call and Zaptec REST exposes none, so the charger's real list is unreadable by design. Only its version counter (StateId 751, `AuthenticationListVersion`) is observable.
- **Half B — single-token Differential push.** `POST /api/admin/chargers/:ocppIdentityId/local-auth-list/push` → `pushIdTokenToCharger` mints a **Differential** `SendLocalList` with **one** IdToken, bumps the monotonic `charging_stations.pushed_auth_list_version`, writes an `ocpp.outbound_commands` row (`controlDomain='send_local_list'`), and publishes to `OUTBOUND_QUEUE`. The dispatcher maps `send_local_list → SendLocalList` (`lib/dispatch-targets.ts`) and the gateway forwards the Call generically over the charger's WebSocket. Rule-5 guards (status / scope / contract per ADR 0019) are enforced before the push.

**What is missing:**
1. **Bulk / full sync** — no way to push the whole roster; only one token per call.
2. **Full replace + Clear** — `updateType:"Full"` and empty-list clear are not exposed; only Differential *add*.
3. **Delete / deactivate an entry** — revocation does not propagate. Removing an IdToken from the CSMS roster leaves it live on the charger until a manual re-push. This is the sharpest correctness gap: a revoked token still authorizes during a CSMS-outage tap (Zaptec defaults `LocalAuthorizeOffline=true`).
4. **`GetLocalListVersion`** — not in the dispatcher action map; the CSMS cannot read the charger's list version over OCPP. Version drift is only inferable from StateId 751 via the Zaptec REST/AMQP mirror.
5. **VersionMismatch recovery** — if the charger's version is ahead of ours (prior CSMS, or Zaptec Portal management), the push lands `failed` with `VersionMismatch` and requires manual re-sync of `pushed_auth_list_version`. No auto-recovery loop.
6. **Native-mode (AuthenticationType 0) parity** — OCPP `SendLocalList` does not apply; the list is owned by the Zaptec Portal and controlled via Zaptec's REST user-groups / "Allowed users" API. No abstraction spans the two control planes.

## Decision (to implement, timing TBD)

Land the remaining halves behind one repository-level abstraction so callers express intent ("this roster should be the charger's list") and the layer picks the transport by the charger's `AuthenticationType`.

### C1 — Full replace + Clear (OCPP)
Extend `local-auth-list-push.ts` with `replaceLocalList(roster)` (`updateType:"Full"`) and `clearLocalList()` (Full with empty `localAuthorizationList`). Same outbox/version/guard machinery; the guard set runs per entry.

### C2 — Delete / revocation propagation (OCPP)
On IdToken revoke/suspend/expire (and on roster removal), enqueue a Differential push that sets the entry's `idTagInfo.status` to a non-authorizing value (or omits it in a Full replace). Wire this into the same hook that mutates IdToken status so revocation and propagation are atomic from the operator's view.

### C3 — GetLocalListVersion + drift reconciliation
Add `get_local_list_version → GetLocalListVersion` to the dispatcher action map and a reconcile routine that compares the charger's reported version (Call result, cross-checked against StateId 751) with `pushed_auth_list_version`, and on mismatch performs a Full replace to converge. This closes the VersionMismatch (item 5) gap and makes pushes idempotent-safe.

### C4 — Bulk roster sync
A `syncLocalList(ocppIdentityId)` that materialises the effective roster (the `would_authorize` set already computed by the roster builder) and pushes it as one Full replace. This is the operator's "make the charger match the CSMS" button.

### C5 — Native-mode transport (Zaptec REST)
A parallel target that, for `AuthenticationType=0`, controls the list via Zaptec's user-group / Allowed-users REST API instead of OCPP, exposing the same `syncLocalList` intent. StateId 751 remains the observable version. Unifies the two control planes behind the repository abstraction.

## Consequences

**Benefits**
- Revocation actually reaches the charger — the current silent gap (item 3) is the real risk this ADR exists to close.
- Offline authorization becomes trustworthy: the local list can be made to match the CSMS's contract-gated roster and kept converged.
- One intent-level API regardless of OCPP vs Native install.

**Costs / risks**
- **Rule 5 surface.** Full replace and clear can strand or over-authorize an installation if the roster is wrong at push time. Every entry must pass the same ADR 0019 contract/status/scope gate the single-token path already enforces — no bypass in the bulk path.
- **VersionMismatch races.** Concurrent pushes must serialise on `pushed_auth_list_version`; C3's reconcile must be the single writer during convergence.
- **Native/OCPP divergence.** The two transports have different failure modes and latency; the abstraction must surface which plane a given result came from, not hide it.
- **No contents read-back, ever.** Even complete, we can only ever *assert* the list via version, never verify contents. C3's version reconciliation is the strongest guarantee available.

## Implementation order

C2 (revocation propagation) first — it's the correctness gap. Then C3 (version reconcile) to make pushes safe, C1/C4 (Full replace + bulk sync) on top, and C5 (Native REST parity) last. Each is independently shippable; C2+C3 together already remove the dangerous silent-authorization window.
