// Tap & Auth — driver tap-intent routes (ADR 0024 addendum 2, 2026-08-02).
//
//   POST   /api/driver/tap-intent          arm / refresh at a charger
//   GET    /api/driver/tap-intent          the driver's live intents
//   DELETE /api/driver/tap-intent/:id      disarm
//
// Arming records intent only. It grants nothing on its own and is NOT on
// the access-grant path: a session starts only when the charger
// independently reports a physical tap and the resolver joins the two.
// That separation is why this module can ship ahead of the resolver hook
// (which is a Rule 5 change and gated on approval — see
// docs/notes/2026-08-02-tap-and-auth-implementation.md).
//
// Mounted into publicDriver so it inherits the same CORS allowlist and
// bearer contract as every other /api/driver route.

import { Hono } from "hono";
import { z } from "zod";
import { makePrisma } from "../../lib/prisma";
import { requireDriver } from "./driver";
import type { DriverTokenPayload } from "../../lib/driver-session";
import {
  upsertTapIntent,
  cancelTapIntent,
  listLiveTapIntentsForDriver,
  resolveDriverStationBySerial,
  TAP_INTENT_MIN_RSSI,
  TAP_INTENT_TTL_SECONDS,
} from "../../repositories/tap-intents";
import type { Env } from "../../bindings";

type Vars = { driverPayload: DriverTokenPayload };

export const driverTapIntent = new Hono<{ Bindings: Env; Variables: Vars }>();

// ── POST /api/driver/tap-intent ──────────────────────────────────────
//
// Body carries what the phone can actually observe: the serial it read
// from the charger's BLE advertisement, and the RSSI it saw. It does NOT
// carry a driver id — identity comes from the bearer token, server-side,
// so a client cannot arm on someone else's behalf.

const armSchema = z.object({
  // Zaptec advertises "ZPR074002 2305"; the app sends the serial token.
  serial: z.string().min(3).max(64),
  // Signed, always negative in practice. Bounded to reject nonsense.
  rssi: z.number().int().min(-127).max(0).optional(),
  // Opaque handle from the app's secure storage. Audit only.
  deviceHandle: z.string().min(8).max(128).optional(),
});

driverTapIntent.post("/", requireDriver, async (c) => {
  const { userId } = c.get("driverPayload");
  const raw = await c.req.json().catch(() => null);
  const parsed = armSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      { error: "validation", message: "serial is required; rssi must be an integer <= 0." },
      400,
    );
  }
  const { serial, rssi, deviceHandle } = parsed.data;

  // Server-side proximity gate. The app applies the same threshold, but
  // a client that skips it must not be able to arm from across the car
  // park — the RSSI is the only distance evidence in the whole flow.
  if (rssi !== undefined && rssi < TAP_INTENT_MIN_RSSI) {
    return c.json(
      {
        error: "too_far",
        message: "Move closer to the charger and try again.",
        minRssi: TAP_INTENT_MIN_RSSI,
        observedRssi: rssi,
      },
      409,
    );
  }

  const prisma = makePrisma(c.env);
  const station = await resolveDriverStationBySerial(prisma, userId, serial);

  switch (station.kind) {
    case "unknown_serial":
      return c.json(
        { error: "unknown_charger", message: "That charger is not in the system." },
        404,
      );
    case "no_installation":
      return c.json(
        { error: "charger_unassigned", message: "That charger is not assigned to an installation." },
        409,
      );
    case "no_access":
      return c.json(
        { error: "no_access", message: "You do not have access to this charger." },
        403,
      );
    case "ok":
      break;
  }

  const intent = await upsertTapIntent(prisma, userId, {
    orgId: station.orgId,
    chargingStationId: station.chargingStationId,
    deviceHandle: deviceHandle ?? null,
    bleRssi: rssi ?? null,
  });

  return c.json(
    {
      intentId: intent.id,
      chargerName: station.displayName,
      expiresAt: intent.expiresAt,
      ttlSeconds: TAP_INTENT_TTL_SECONDS,
    },
    201,
  );
});

// ── GET /api/driver/tap-intent ───────────────────────────────────────
// Powers the app's "armed — tap the charger now" indicator, and lets the
// app recover state after a process restart without re-arming blindly.

driverTapIntent.get("/", requireDriver, async (c) => {
  const { userId } = c.get("driverPayload");
  const prisma = makePrisma(c.env);
  const intents = await listLiveTapIntentsForDriver(prisma, userId);
  return c.json({ intents }, 200);
});

// ── DELETE /api/driver/tap-intent/:id ────────────────────────────────
// Driver walked away, backed out, or the app lost sight of the charger
// over BLE. Disarming promptly is what keeps the hijack window short, so
// the app should call this rather than letting the TTL lapse.

driverTapIntent.delete("/:id", requireDriver, async (c) => {
  const { userId } = c.get("driverPayload");
  const intentId = c.req.param("id");
  const prisma = makePrisma(c.env);
  const cancelled = await cancelTapIntent(prisma, userId, intentId);
  if (!cancelled) {
    return c.json(
      { error: "not_found", message: "No live intent with that id for this driver." },
      404,
    );
  }
  return c.json({ ok: true }, 200);
});
