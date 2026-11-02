// Driver access to the shared live room: verification of the driver's bearer token and the grant that says WHICH of the
// driver's devices (and connectors) they may see. Pure over ports, plus the one Drizzle query that implements the port.
//
// WHAT A DRIVER MAY SEE: the live status of the device and connector of their own OPEN, AUTHORIZED charging session, while
// they are an active user - and nothing else. No organisation, no installation structure, no other driver's devices.
//
// WHERE AUTHORITY COMES FROM: the token proves who the driver is (the driver app's existing HMAC bearer token, the same
// format and secret as the driver API); the identity data decides what that person may see right now. Neither is cached
// beyond the access lease (live-projection LIVE_LEASE_MS), so a finished session or a deactivated user loses access at the
// next renewal. Revocation is therefore bounded by the lease, and renewal is one small indexed read per driver per lease -
// counted separately from data fanout, which costs no read at all.
//
// The token verifier mirrors apps/api/src/lib/driver-session.ts (kind "access", sub "driver"); the cross-check test mints with
// that implementation and verifies with this one so the two cannot drift silently.

import { and, eq, gt, isNull } from "drizzle-orm";
import { ocppTransactions } from "@straumvakt/shared/db/charging";
import { users } from "@straumvakt/shared/db/identity";
import type { Executor } from "@/lib/installations/db";
import { MAX_DRIVER_DEVICES, type DriverDevices } from "./live-fanout";

export type DriverClaims = { userId: string; expiresAtSec: number };

const enc = new TextEncoder();
const dec = new TextDecoder();
function b64urlToBytes(s: string): Uint8Array {
  const b = s.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b + "=".repeat((4 - (b.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

/** Constant-time HMAC check via WebCrypto verify. Returns null for anything but a valid, unexpired driver ACCESS token. */
export async function verifyDriverAccessToken(secret: string | undefined, token: string | undefined, nowSec: number): Promise<DriverClaims | null> {
  if (!secret || !token) return null;
  const [payloadPart, sigPart, extra] = token.split(".");
  if (!payloadPart || !sigPart || extra !== undefined) return null;
  try {
    const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    if (!(await crypto.subtle.verify("HMAC", key, b64urlToBytes(sigPart), enc.encode(payloadPart)))) return null;
    const p = JSON.parse(dec.decode(b64urlToBytes(payloadPart))) as { sub?: unknown; kind?: unknown; userId?: unknown; exp?: unknown };
    if (p.sub !== "driver" || p.kind !== "access" || typeof p.userId !== "string" || !/^[0-9a-f-]{36}$/i.test(p.userId)) return null;
    if (typeof p.exp !== "number" || !Number.isFinite(p.exp) || p.exp <= nowSec) return null;
    return { userId: p.userId, expiresAtSec: p.exp };
  } catch {
    return null;
  }
}

export type DriverGrant = { installationId: string; devices: DriverDevices };
/** null = the identity data could not be read (unavailable); [] = nothing the driver may see right now. */
export interface DriverGrantStore {
  grants(userId: string, nowMs: number): Promise<DriverGrant[] | null>;
}

/** A session open this long is treated as abandoned for access purposes (the transaction itself stays open and unresolved). */
export const DRIVER_SESSION_MAX_AGE_MS = 48 * 60 * 60 * 1000;

export function drizzleDriverGrantStore(x: Executor): DriverGrantStore {
  return {
    async grants(userId, nowMs) {
      try {
        const rows = await x
          .select({ installationId: ocppTransactions.installationId, deviceId: ocppTransactions.deviceId, connectorNo: ocppTransactions.connectorNo })
          .from(ocppTransactions)
          .innerJoin(users, eq(users.id, ocppTransactions.userId))
          .where(and(eq(ocppTransactions.userId, userId), isNull(ocppTransactions.stoppedReceivedAt), eq(ocppTransactions.authorized, true), eq(users.status, "active"), gt(ocppTransactions.startedReceivedAt, new Date(nowMs - DRIVER_SESSION_MAX_AGE_MS))))
          .limit(MAX_DRIVER_DEVICES * 2);
        return groupGrants(rows);
      } catch {
        return null;
      }
    },
  };
}

/** Rows -> one grant per installation, devices bounded. Pure. */
export function groupGrants(rows: { installationId: string; deviceId: string; connectorNo: number }[]): DriverGrant[] {
  const by = new Map<string, DriverDevices>();
  let devices = 0;
  for (const r of rows) {
    const d = by.get(r.installationId) ?? {};
    if (!(r.deviceId in d)) { if (devices >= MAX_DRIVER_DEVICES) continue; devices += 1; }
    d[r.deviceId] = [...new Set([...(d[r.deviceId] ?? []), r.connectorNo])];
    by.set(r.installationId, d);
  }
  return [...by].sort(([a], [b]) => (a < b ? -1 : 1)).map(([installationId, devices]) => ({ installationId, devices }));
}

export type DriverUpgradeDecision =
  | { kind: "grant"; grant: DriverGrant; expiresAtMs: number; userId: string }
  | { kind: "grants"; grants: DriverGrant[]; userId: string }
  | { kind: "deny"; status: 401 | 403 | 503 };

/**
 * The decision for one driver request. `wanted` is the installation the client asked to follow; absent means "list what I may
 * follow". Unauthenticated = 401, authenticated but nothing to see (no open session, deactivated, other installation) = 403,
 * the identity data unreadable = 503 (never a guess).
 */
export async function decideDriverAccess(
  input: { token: string | undefined; secret: string | undefined; wanted: string | null; nowMs: number; leaseMs: number },
  store: DriverGrantStore,
): Promise<DriverUpgradeDecision> {
  const claims = await verifyDriverAccessToken(input.secret, input.token, Math.floor(input.nowMs / 1000));
  if (!claims) return { kind: "deny", status: 401 };
  const grants = await store.grants(claims.userId, input.nowMs);
  if (grants === null) return { kind: "deny", status: 503 };
  if (input.wanted === null) return grants.length ? { kind: "grants", grants, userId: claims.userId } : { kind: "deny", status: 403 };
  const grant = grants.find((g) => g.installationId.toLowerCase() === input.wanted!.toLowerCase());
  if (!grant) return { kind: "deny", status: 403 };
  // Share expiry wakes in five-second buckets; never beyond the token's own life.
  const expiresAtMs = Math.min(Math.floor((input.nowMs + input.leaseMs) / 5000) * 5000, claims.expiresAtSec * 1000);
  return expiresAtMs > input.nowMs ? { kind: "grant", grant, expiresAtMs, userId: claims.userId } : { kind: "deny", status: 401 };
}
