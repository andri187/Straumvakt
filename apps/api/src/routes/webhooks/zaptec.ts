// Zaptec webhook receivers — Sprint 8.9.
//
// Real-time path for installations on AuthenticationType=1 (Webhooks).
// Zaptec POSTs to three URLs we expose:
//   • /api/webhooks/zaptec/auth          per RFID tap → Accept/Reject
//   • /api/webhooks/zaptec/session-start session start
//   • /api/webhooks/zaptec/session-end   session end + energy → ledger
//
// Latency is sub-second instead of the 5-min polling lag from 8.7/8.8.
// Polling stays in place as a backstop in case a webhook is dropped.
//
// Shape: Zaptec doesn't publish a stable webhook schema; the user-
// facing portal exposes URL + "Auth payload" fields. We accept any
// reasonable shape, log the raw body once per request for forensic
// adaptation, and pull the fields we need with permissive accessors.
//
// Trust: every callback must carry the shared secret in the
// Authorization header ("Bearer <secret>") matching env.ZAPTEC_WEBHOOK_SECRET.
// If the env is unset, the routes return 503 — the operator must
// intentionally provision the secret before turning these on.
//
// Idempotency: session-start and session-end use the same
// (sourceKind, sourceCdrId) unique index on charging.imported_cdr_refs
// that the polling-based 8.7 writer uses. Re-deliveries are no-ops.

import { Hono } from "hono";
import type { Env } from "../../bindings";
import { makePrisma } from "../../lib/prisma";
import {
  resolveTariffChainForSession,
  TariffResolutionError,
} from "../../lib/tariff/resolve-tariff-chain";
import { computeSessionCost } from "../../lib/tariff/compute-session-cost";
import type { Prisma, PrismaClient } from "../../generated/prisma/client";

export const zaptecWebhooks = new Hono<{ Bindings: Env }>();

zaptecWebhooks.use("*", async (c, next) => {
  const expected = c.env.ZAPTEC_WEBHOOK_SECRET;
  if (!expected) {
    return c.json({ error: "webhook_secret_unset" }, 503);
  }
  const header = c.req.header("authorization") ?? c.req.header("Authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : header;
  if (provided !== expected) {
    console.warn("[zaptec-webhook] unauthorized", {
      path: c.req.path,
      hasHeader: header.length > 0,
    });
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
});

// ─── /auth ─────────────────────────────────────────────────────────────
// Per RFID tap. Zaptec asks "is cardId X allowed at chargerId Y?".
// We match cardId against IdToken.value (active tokens only). Reject
// by default if no match.
zaptecWebhooks.post("/auth", async (c) => {
  const raw = await c.req.json().catch(() => null);
  console.log("[zaptec-webhook] auth", { body: redactRfid(raw) });
  if (!raw || typeof raw !== "object") {
    return c.json({ result: "Reject", reason: "invalid_payload" }, 400);
  }
  const cardId = pickFirstString(raw, ["cardId", "rfid", "tag", "idTag", "tokenId"]);
  if (!cardId) {
    return c.json({ result: "Reject", reason: "no_card_id" }, 200);
  }
  const db = makePrisma(c.env);
  const idToken = await db.idToken.findFirst({
    where: { value: cardId, status: "active" },
    select: { id: true, userId: true, expiresAt: true },
  });
  if (!idToken) {
    return c.json({ result: "Reject", reason: "card_not_registered" }, 200);
  }
  if (idToken.expiresAt && idToken.expiresAt.getTime() < Date.now()) {
    return c.json({ result: "Reject", reason: "card_expired" }, 200);
  }
  // Best-effort lastUsedAt update — non-blocking on failure.
  await db.idToken
    .update({ where: { id: idToken.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);
  return c.json({ result: "Accept" }, 200);
});

// ─── /session-start ────────────────────────────────────────────────────
// Zaptec emits this when a session physically starts. We create a
// ChargeSession + ImportedCdrRef so the operator console sees the
// in-progress row. No cost yet — that's computed on session-end.
zaptecWebhooks.post("/session-start", async (c) => {
  const raw = await c.req.json().catch(() => null);
  console.log("[zaptec-webhook] session-start", { body: redactRfid(raw) });
  if (!raw || typeof raw !== "object") {
    return c.json({ ok: false, error: "invalid_payload" }, 400);
  }
  const zaptecSessionId = pickFirstString(raw, ["sessionId", "Id", "id"]);
  const chargerDeviceId = pickFirstString(raw, [
    "chargerId",
    "ChargerId",
    "deviceId",
    "DeviceId",
  ]);
  const startedIso = pickFirstString(raw, [
    "startedAt",
    "StartDateTime",
    "startTime",
  ]);
  const cardId = pickFirstString(raw, ["cardId", "rfid", "idTag", "tag"]);
  if (!zaptecSessionId || !chargerDeviceId || !startedIso) {
    return c.json({ ok: false, error: "missing_required_fields" }, 400);
  }

  const db = makePrisma(c.env);
  try {
    const outcome = await db.$transaction(async (tx) => {
      const existing = await tx.importedCdrRef.findUnique({
        where: {
          sourceKind_sourceCdrId: {
            sourceKind: "zaptec",
            sourceCdrId: zaptecSessionId,
          },
        },
        select: { id: true, sessionId: true },
      });
      if (existing) {
        return { kind: "already_started", sessionId: existing.sessionId } as const;
      }

      const placement = await placeSyntheticSession(tx, chargerDeviceId);
      if (placement.kind !== "ok") return placement;

      const driverUserId = await resolveDriver(tx, cardId);
      const sessionId = crypto.randomUUID();
      const startedAt = new Date(startedIso);

      await tx.chargeSession.create({
        data: {
          id: sessionId,
          orgId: placement.orgId,
          siteId: placement.siteId,
          chargingStationId: placement.chargingStationId,
          evseId: placement.evseId,
          ocppIdentityId: placement.ocppIdentityId,
          connectorId: null,
          userId: driverUserId,
          idTag: cardId ?? null,
          startedAt,
          energyWh: null,
          status: "in_progress",
        },
      });
      await tx.importedCdrRef.create({
        data: {
          orgId: placement.orgId,
          sessionId,
          sourceKind: "zaptec",
          sourceCdrId: zaptecSessionId,
          importedAt: new Date(),
          rawPayload: raw as unknown as Prisma.InputJsonValue,
        },
      });
      return { kind: "ok", sessionId } as const;
    });
    if (outcome.kind === "ok" || outcome.kind === "already_started") {
      return c.json({ ok: true, sessionId: outcome.sessionId }, 200);
    }
    return c.json({ ok: false, error: outcome.kind }, 200);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[zaptec-webhook] session-start failed", { detail });
    return c.json({ ok: false, error: "tx_failed", detail }, 500);
  }
});

// ─── /session-end ──────────────────────────────────────────────────────
// Zaptec emits this with energy + duration. We close the ChargeSession,
// resolve the tariff chain, compute cost, and upsert session_ledger.
// If we never saw the session-start (e.g. webhook dropped), we still
// create the row + ledger from the end payload alone.
zaptecWebhooks.post("/session-end", async (c) => {
  const raw = await c.req.json().catch(() => null);
  console.log("[zaptec-webhook] session-end", { body: redactRfid(raw) });
  if (!raw || typeof raw !== "object") {
    return c.json({ ok: false, error: "invalid_payload" }, 400);
  }
  const zaptecSessionId = pickFirstString(raw, ["sessionId", "Id", "id"]);
  const chargerDeviceId = pickFirstString(raw, [
    "chargerId",
    "ChargerId",
    "deviceId",
    "DeviceId",
  ]);
  const startedIso = pickFirstString(raw, [
    "startedAt",
    "StartDateTime",
    "startTime",
  ]);
  const endedIso = pickFirstString(raw, [
    "endedAt",
    "EndDateTime",
    "endTime",
    "stoppedAt",
  ]);
  const energyKwh = pickFirstNumber(raw, ["energyKwh", "Energy", "energy"]) ?? 0;
  const cardId = pickFirstString(raw, ["cardId", "rfid", "idTag", "tag"]);
  if (!zaptecSessionId || !chargerDeviceId || !endedIso) {
    return c.json({ ok: false, error: "missing_required_fields" }, 400);
  }

  const db = makePrisma(c.env);
  try {
    const outcome = await db.$transaction(async (tx) => {
      // Reuse an existing session if session-start fired earlier.
      let sessionId: string | null = null;
      let orgId: string | null = null;
      let siteId: string | null = null;
      let chargingStationId: string | null = null;
      let startedAt: Date | null = null;
      const existingRef = await tx.importedCdrRef.findUnique({
        where: {
          sourceKind_sourceCdrId: {
            sourceKind: "zaptec",
            sourceCdrId: zaptecSessionId,
          },
        },
        select: { sessionId: true, orgId: true },
      });
      if (existingRef) {
        const session = await tx.chargeSession.findUnique({
          where: { id: existingRef.sessionId },
          select: {
            id: true,
            orgId: true,
            siteId: true,
            chargingStationId: true,
            startedAt: true,
          },
        });
        if (session) {
          sessionId = session.id;
          orgId = session.orgId;
          siteId = session.siteId;
          chargingStationId = session.chargingStationId;
          startedAt = session.startedAt;
        }
      }

      if (!sessionId) {
        // No session-start fired (or webhook dropped) — create both rows now.
        const placement = await placeSyntheticSession(tx, chargerDeviceId);
        if (placement.kind !== "ok") return placement;
        if (!startedIso) return { kind: "missing_start_time" } as const;
        sessionId = crypto.randomUUID();
        orgId = placement.orgId;
        siteId = placement.siteId;
        chargingStationId = placement.chargingStationId;
        startedAt = new Date(startedIso);

        const driverUserId = await resolveDriver(tx, cardId);
        await tx.chargeSession.create({
          data: {
            id: sessionId,
            orgId,
            siteId,
            chargingStationId,
            evseId: placement.evseId,
            ocppIdentityId: placement.ocppIdentityId,
            connectorId: null,
            userId: driverUserId,
            idTag: cardId ?? null,
            startedAt,
            energyWh: BigInt(Math.round(energyKwh * 1000)),
            status: "completed",
          },
        });
        await tx.importedCdrRef.create({
          data: {
            orgId,
            sessionId,
            sourceKind: "zaptec",
            sourceCdrId: zaptecSessionId,
            importedAt: new Date(),
            rawPayload: raw as unknown as Prisma.InputJsonValue,
          },
        });
      }

      const stoppedAt = new Date(endedIso);
      const energyWh = BigInt(Math.round(energyKwh * 1000));
      const durationSec = Math.max(
        0,
        Math.round((stoppedAt.getTime() - startedAt!.getTime()) / 1000),
      );

      await tx.chargeSession.update({
        where: { id: sessionId! },
        data: {
          endedAt: stoppedAt,
          status: "completed",
          energyWh,
        },
      });

      const chain = await resolveTariffChainForSession(tx, {
        siteId: siteId!,
        chargingStationId: chargingStationId!,
      });
      const breakdown = computeSessionCost(
        { startedAt: startedAt!, stoppedAt, energyKwh },
        chain,
      );

      const driverUserId = await resolveDriver(tx, cardId);
      await tx.sessionLedger.upsert({
        where: { sessionId: sessionId! },
        create: {
          sessionId: sessionId!,
          orgId: orgId!,
          siteId,
          chargingStationId,
          driverUserId,
          driverIdTag: cardId ?? null,
          startedAt: startedAt!,
          stoppedAt,
          durationSec,
          energyKwh: energyKwh.toFixed(3),
          costIskMinor: breakdown.totalIncVatMinor,
          tariffDefinitionId: null,
        },
        update: {
          stoppedAt,
        },
      });

      return {
        kind: "ok" as const,
        sessionId: sessionId!,
        costIskMinor: String(breakdown.totalIncVatMinor),
      };
    });

    if (outcome.kind === "ok") {
      return c.json(
        {
          ok: true,
          sessionId: outcome.sessionId,
          costIskMinor: outcome.costIskMinor,
        },
        200,
      );
    }
    return c.json({ ok: false, error: outcome.kind }, 200);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const code =
      err instanceof TariffResolutionError ? err.code : "tx_failed";
    console.error("[zaptec-webhook] session-end failed", { code, detail });
    return c.json({ ok: false, error: code, detail }, 500);
  }
});

// ─── helpers ───────────────────────────────────────────────────────────

type Placement =
  | {
      kind: "ok";
      orgId: string;
      siteId: string;
      chargingStationId: string;
      evseId: string;
      ocppIdentityId: string;
    }
  | { kind: "no_station_mapped" }
  | { kind: "no_site_for_station" }
  | { kind: "no_evse_under_station" };

async function placeSyntheticSession(
  tx: Prisma.TransactionClient,
  chargerDeviceId: string,
): Promise<Placement> {
  const identity = await tx.ocppIdentity.findFirst({
    where: { vendor: "Zaptec", vendorResourceId: chargerDeviceId },
    select: { id: true, orgId: true, chargingStationId: true },
  });
  if (!identity) return { kind: "no_station_mapped" };
  const siteAsset = await tx.siteAsset.findUnique({
    where: { id: identity.chargingStationId },
    select: { siteId: true },
  });
  if (!siteAsset) return { kind: "no_site_for_station" };
  const evse = await tx.eVSE.findFirst({
    where: { chargingStationId: identity.chargingStationId },
    orderBy: { evseIndex: "asc" },
    select: { id: true },
  });
  if (!evse) return { kind: "no_evse_under_station" };
  return {
    kind: "ok",
    orgId: identity.orgId,
    siteId: siteAsset.siteId,
    chargingStationId: identity.chargingStationId,
    evseId: evse.id,
    ocppIdentityId: identity.id,
  };
}

async function resolveDriver(
  tx: Prisma.TransactionClient,
  cardId: string | undefined,
): Promise<string | null> {
  if (!cardId) return null;
  const idToken = await tx.idToken.findFirst({
    where: { value: cardId, status: "active" },
    select: { userId: true },
  });
  return idToken?.userId ?? null;
}

function pickFirstString(obj: unknown, keys: string[]): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const rec = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

function pickFirstNumber(obj: unknown, keys: string[]): number | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const rec = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

/**
 * Mask the cardId/rfid in logs — these are pseudonymous identifiers
 * but logging them long-term is bad hygiene. Mask preserves length so
 * we can still see "did Zaptec send a card vs nothing?" in the log.
 */
function redactRfid(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const rec = { ...(raw as Record<string, unknown>) };
  for (const k of ["cardId", "rfid", "tag", "idTag", "tokenId"]) {
    const v = rec[k];
    if (typeof v === "string" && v.length > 0) {
      rec[k] = `***${v.slice(-2)}`;
    }
  }
  return rec;
}

declare const crypto: { randomUUID: () => string };
