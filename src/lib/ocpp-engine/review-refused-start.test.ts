import { expect, it } from "vitest";
import { handleStartTransaction } from "./transactions";
import { memoryTxStore } from "./__tests__/memory-tx-store";
import type { ConnectionContext } from "./admission";

it("a start refused during removal must not mark the existing active session as superseded", async () => {
  const deviceId = "device-1";
  const blockedDevices = new Set<string>();
  const ctx: ConnectionContext = { orgId: "org-1", installationId: "installation-1", installationKey: "abcdefghijk1", chargePointId: "CP-1", identityString: "abcdefghijk1/CP-1", deviceId, placementId: "placement-1", credentialMode: "none", credentialEpoch: "e1" };
  const now = new Date("2026-10-30T12:00:00Z");
  const m = memoryTxStore({ blockedDevices, facts: () => ({ token: { id: "token", userId: "driver", status: "active", expiresAt: null, scopeInstallationId: null }, userActive: true, hasInstallationAccess: true }) });
  const start = (messageId: string) => handleStartTransaction({ store: m.store, now: () => now }, { ctx, messageId, requestHash: messageId, payload: { connectorId: 1, idTag: "GOOD", meterStart: 1000, timestamp: now.toISOString() }, receivedAt: now });
  expect(await start("original")).toMatchObject({ kind: "reply", payload: { idTagInfo: { status: "Accepted" } } });
  blockedDevices.add(deviceId);
  expect(await start("refused")).toMatchObject({ kind: "reply", payload: { idTagInfo: { status: "Blocked" } } });
  expect(m.state.txs[0]).toMatchObject({ authorized: true, stoppedAt: null, reconcileFlag: null });
  expect(m.state.txs[1]).toMatchObject({ authorized: false, stoppedAt: null, reconcileFlag: null });
  expect(m.state.receipts[1]).toMatchObject({ decision: { status: "Blocked", reason: "service_blocked_removal" } });
});

it("an invalid token does not supersede an existing authorized session", async () => {
  const ctx: ConnectionContext = { orgId: "org-1", installationId: "installation-1", installationKey: "abcdefghijk1", chargePointId: "CP-1", identityString: "abcdefghijk1/CP-1", deviceId: "device-1", placementId: "placement-1", credentialMode: "none", credentialEpoch: "e1" };
  const now = new Date("2026-10-30T12:00:00Z");
  const m = memoryTxStore({ facts: (tag) => tag === "GOOD" ? { token: { id: "token", userId: "driver", status: "active", expiresAt: null, scopeInstallationId: null }, userActive: true, hasInstallationAccess: true } : { token: null, userActive: false, hasInstallationAccess: false } });
  const start = (messageId: string, idTag: string) => handleStartTransaction({ store: m.store, now: () => now }, { ctx, messageId, requestHash: messageId, payload: { connectorId: 1, idTag, meterStart: 1000, timestamp: now.toISOString() }, receivedAt: now });
  await start("original", "GOOD");
  expect(await start("invalid", "BAD")).toMatchObject({ kind: "reply", payload: { idTagInfo: { status: "Invalid" } } });
  expect(m.state.txs[0]).toMatchObject({ authorized: true, stoppedAt: null, reconcileFlag: null });
  expect(m.state.txs[1]).toMatchObject({ authorized: false, stoppedAt: null });
});
