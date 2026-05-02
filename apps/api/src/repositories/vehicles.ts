// Vehicle repository — closure item 1 paperwork from sprint-03 retro.
// Gives the previously-orphan people.vehicles table a write path so
// the table is no longer schema-only. No admin UI yet — the first
// real caller is the post-pilot driver-app onboarding flow that lets
// drivers register their EVs. Sprint 4+.
//
// Kept minimal on purpose: create + list. Update/delete land when a
// real flow needs them.

import type { PrismaClient, Prisma } from "../generated/prisma/client";
import type { VehicleSummary } from "@straumvakt/shared/domain/users";

interface VehicleRow {
  id: string;
  userId: string;
  make: string | null;
  model: string | null;
  year: number | null;
  licensePlate: string | null;
  vin: string | null;
  batteryCapacityKwh: { toString: () => string } | null;
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
    // Decimal → string preserves precision (e.g. "77.40" doesn't lose
    // the trailing zero like Number() would).
    batteryCapacityKwh: row.batteryCapacityKwh
      ? row.batteryCapacityKwh.toString()
      : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createVehicle(
  db: PrismaClient,
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
  const data: Prisma.VehicleUncheckedCreateInput = {
    userId: input.userId,
    make: input.make ?? null,
    model: input.model ?? null,
    year: input.year ?? null,
    licensePlate: input.licensePlate ?? null,
    vin: input.vin ?? null,
    batteryCapacityKwh:
      input.batteryCapacityKwh !== undefined
        ? (input.batteryCapacityKwh as Prisma.Decimal | string | number)
        : null,
  };
  const row = (await db.vehicle.create({ data })) as VehicleRow;
  return toSummary(row);
}

export async function listVehiclesForUser(
  db: PrismaClient,
  userId: string,
): Promise<VehicleSummary[]> {
  const rows = (await db.vehicle.findMany({
    where: { userId },
    orderBy: [{ createdAt: "asc" }],
  })) as VehicleRow[];
  return rows.map(toSummary);
}
