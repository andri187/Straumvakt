// Driver-facing release of a charger's local BLE PIN (ADR 0046 — renumbered
// from 0044 on 2026-08-04 to resolve a collision; see the ADR header).
//
//   GET /api/driver/chargers/:serial/ble-pin  →  { pin }
//
// WHY THIS EXISTS
//
// A charger that loses its IP lease is unreachable by any cloud API —
// which is precisely when a driver needs it restarted. The only remaining
// channel is local BLE, and that is PIN-gated. The PIN is an attribute of
// the access right: hold access, and your DEVICE holds the PIN. The driver
// never sees or types it (see apps/mobile/lib/charger_settings/pin_store.dart).
//
// ACCESS RULE
//
// Deliberately the SAME membership rule the OCPP authorize resolver and
// the tap-intent arming path apply: an active DriverGroupMembership under
// an active installation-type Agreement anchored at the charger's
// installation. If those three rules ever diverged, this endpoint would
// become a way to reach a charger the driver could not otherwise use.
//
// WHAT MAKES THIS DIFFERENT FROM EVERY OTHER GRANT
//
// The Zaptec PIN is factory-set, printed on the box, and **cannot be
// rotated**. Releasing it is therefore effectively permanent: revoking a
// driver's access does not un-teach a PIN their device already holds, and
// there is no rotation remedy short of replacing hardware.
//
// That is why every release is audited, and why the client binds its cache
// to the access list (reconcile-on-sync) with a TTL backstop rather than
// treating the PIN as a durable local secret.

import { Hono } from "hono";
import { makePrisma } from "../../lib/prisma";
import { requireDriver } from "./driver";
import { recordAuditAction } from "../../lib/audit";
import { getChargerTechnicalRead } from "../../repositories/charger-technical-read";
import type { DriverTokenPayload } from "../../lib/driver-session";
import type { Env } from "../../bindings";

type Vars = { driverPayload: DriverTokenPayload };

export const driverChargerPin = new Hono<{ Bindings: Env; Variables: Vars }>();

driverChargerPin.get("/:serial/ble-pin", requireDriver, async (c) => {
  const { userId } = c.get("driverPayload");
  const serial = (c.req.param("serial") ?? "").trim().toUpperCase();
  if (!serial) {
    return c.json({ error: "validation", message: "serial required" }, 400);
  }

  const prisma = makePrisma(c.env);

  const station = await prisma.chargingStation.findUnique({
    where: { serialNumber: serial },
    select: { siteAssetId: true, orgId: true, installationId: true },
  });
  if (!station) {
    return c.json(
      { error: "unknown_charger", message: "No such charger." },
      404,
    );
  }
  if (!station.installationId) {
    return c.json(
      {
        error: "charger_unassigned",
        message: "That charger is not assigned to an installation.",
      },
      409,
    );
  }

  // Same gate as ADR 0019 A.11 / the authorize resolver.
  const now = new Date();
  const membership = await prisma.driverGroupMembership.findFirst({
    where: {
      userId,
      driverGroup: {
        agreement: {
          agreementType: "installation",
          installationId: station.installationId,
          status: "active",
          effectiveFrom: { lte: now },
          OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }],
        },
      },
    },
    select: { id: true },
  });
  if (!membership) {
    return c.json(
      {
        error: "no_access",
        message: "You do not have access to this charger.",
      },
      403,
    );
  }

  // The PIN rides along on the vendor telemetry read, which already owns
  // the credential-unsealing chain (ChargingStation → OcppIdentity →
  // VendorCredential). Reusing it means one place decrypts vendor
  // credentials rather than two.
  let pin: string | null = null;
  try {
    const read = await getChargerTechnicalRead(
      prisma,
      station.siteAssetId,
      c.env.OCPP_CRED_KEK,
    );
    pin = read.pin ?? null;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[driver-ble-pin] technical read failed", { serial, detail });
    return c.json(
      {
        error: "unavailable",
        message: "Charger credentials are not available right now.",
      },
      503,
    );
  }

  if (!pin) {
    // Not every model exposes one, and a cached-but-stale telemetry read
    // may not carry it. Honest 404 rather than a misleading error.
    return c.json(
      {
        error: "no_pin",
        message: "This charger has no local access code.",
      },
      404,
    );
  }

  // Audited on EVERY release — an unrotatable credential leaving the
  // system is exactly the event an operator needs to be able to reconstruct.
  await recordAuditAction(prisma, {
    orgId: station.orgId,
    actorUserId: userId,
    actorKind: "user",
    action: "charger.ble_pin.released",
    targetType: "charging_station",
    targetId: station.siteAssetId,
    metadata: { serial },
  }).catch(() => undefined);

  // No caching anywhere in front of this.
  c.header("cache-control", "no-store");
  return c.json({ pin }, 200);
});
