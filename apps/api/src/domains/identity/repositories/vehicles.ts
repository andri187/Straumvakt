// Vehicle repository — closure item 1 paperwork from sprint-03 retro.
// Gives the previously-orphan people.vehicles table a write path so
// the table is no longer schema-only. No admin UI yet — the first
// real caller is the post-pilot driver-app onboarding flow that lets
// drivers register their EVs. Sprint 4+.
//
// Kept minimal on purpose: create + list. Update/delete land when a
// real flow needs them.
//
// Moved from src/repositories/vehicles.ts and ported from Prisma in the same
// commit. The Decimal handling is the only thing that needed thought — see
// createVehicle.

import { asc, eq } from "drizzle-orm";
import { normaliseDecimalString } from "../../../lib/decimal";
import type { VehicleSummary } from "@straumvakt/shared/domain/users";
import type { Db } from "../../../lib/drizzle";
import { vehicles } from "../schema";

interface VehicleRow {
  id: string;
  userId: string;
  make: string | null;
  model: string | null;
  year: number | null;
  licensePlate: string | null;
  vin: string | null;
  batteryCapacityKwh: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toSummary(row: VehicleRow): VehicleSummary {
  return {
    id: row.id,
    userId: row.userId,
    make: row.make,
    model: row.model,
    year: row.year,
    licensePlate: row.licensePlate,
    vin: row.vin,
    // Postgres returns numeric(6,2) as "77.40". Prisma's Decimal.toString()
    // dropped the trailing zero and clients have been receiving "77.4", so
    // the same normalisation is applied here rather than silently changing
    // what the driver app renders. Caught by the parity harness — see
    // lib/decimal.ts for why it is textual and not String(Number(x)).
    batteryCapacityKwh: normaliseDecimalString(row.batteryCapacityKwh),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const COLUMNS = {
  id: vehicles.id,
  userId: vehicles.userId,
  make: vehicles.make,
  model: vehicles.model,
  year: vehicles.year,
  licensePlate: vehicles.licensePlate,
  vin: vehicles.vin,
  batteryCapacityKwh: vehicles.batteryCapacityKwh,
  createdAt: vehicles.createdAt,
  updatedAt: vehicles.updatedAt,
} as const;

export async function createVehicle(
  db: Db,
  input: {
    userId: string;
    make?: string;
    model?: string;
    year?: number;
    licensePlate?: string;
    vin?: string;
    batteryCapacityKwh?: string | number;
  },
): Promise<VehicleSummary> {
  const [row] = await db
    .insert(vehicles)
    .values({
      userId: input.userId,
      make: input.make ?? null,
      model: input.model ?? null,
      year: input.year ?? null,
      licensePlate: input.licensePlate ?? null,
      vin: input.vin ?? null,
      // Drizzle's numeric takes a string. A caller passing a number is
      // accepted for signature compatibility and stringified here rather
      // than at the call sites — String(77.40) is "77.4", so a caller who
      // cares about trailing zeros must pass a string, exactly as before.
      batteryCapacityKwh:
        input.batteryCapacityKwh === undefined ? null : String(input.batteryCapacityKwh),
    })
    .returning(COLUMNS);
  return toSummary(row as VehicleRow);
}

export async function listVehiclesForUser(db: Db, userId: string): Promise<VehicleSummary[]> {
  const rows = await db
    .select(COLUMNS)
    .from(vehicles)
    .where(eq(vehicles.userId, userId))
    .orderBy(asc(vehicles.createdAt));
  return (rows as VehicleRow[]).map(toSummary);
}
