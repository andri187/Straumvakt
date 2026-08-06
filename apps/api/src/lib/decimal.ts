/**
 * Normalise a Postgres `numeric` string the way Prisma's Decimal.toString()
 * did, so the ORM change is invisible to API clients.
 *
 * WHY THIS EXISTS
 * ---------------
 * Postgres returns a `numeric(6,2)` column as `"77.40"` — the scale is part
 * of the stored value. Prisma parsed that into a Decimal and the repositories
 * called `.toString()`, which drops insignificant trailing zeros: `"77.4"`.
 * Drizzle's `numeric` is the raw string, so a port that changes nothing else
 * still changes what the driver app renders from `77.4 kWh` to `77.40 kWh`.
 *
 * Caught by the parity harness on people.vehicles.battery_capacity_kwh, where
 * the fixture stores 77.40 precisely to catch it.
 *
 * Arguably `"77.40"` is the better answer — it carries the column's declared
 * precision, and Prisma was discarding information. But a port is not the
 * place to decide that: this preserves the response bodies clients already
 * receive, and changing them is a separate decision with its own reason.
 *
 * TEXTUAL, NOT NUMERIC. `String(Number(x))` would give the same answer for
 * this column and quietly lose digits on a wider one — money columns here are
 * BigInt minor units for exactly that reason, and nothing should establish a
 * float round-trip as the house style for decimals.
 */
export function normaliseDecimalString(value: string | null): string | null {
  if (value === null) return null;
  if (!value.includes(".")) return value;
  const trimmed = value.replace(/0+$/, "").replace(/\.$/, "");
  // "0.00" -> "0", not "" ; "-0.0" -> "-0" is left alone as Decimal does.
  return trimmed === "" || trimmed === "-" ? "0" : trimmed;
}
