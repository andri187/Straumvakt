// The money wire contract. One rule, stated once, in one place.
//
// ── THE RULE ─────────────────────────────────────────────────────────────
//
//   Money leaves this API in AURAR (1/100 króna) as a whole-number JSON
//   integer, in a field whose NAME ENDS IN `Aurar`; no repository, mapper or
//   route divides by 100, and the client converts for display using
//   roundAurarToIsk() from @straumvakt/commercial (half-up, symmetric about
//   zero).
//
// ── WHY IT HAD TO BE WRITTEN DOWN ────────────────────────────────────────
//
// The engine has computed in aurar since compute-session-cost.ts was written:
// per-kWh rates carry two decimals, so the arithmetic needs the precision, and
// projections.ts persists the aurar figure. A 649.88 kr session is 64988.
//
// Three driver-facing DTOs then emitted that number in a field called
// `costIsk`, and three different readers each guessed the unit differently:
//
//   • driver-sessions.ts had `minorToIsk = (minor) => Number(minor)` under a
//     comment asserting "ISK has no minor unit, so minor === major". ISK does
//     have a formally defined subunit; this codebase's minor IS 1/100 króna,
//     which is why formatIskMinor() in compute-session-cost.ts divides by 100
//     eleven lines away from the same value. The premise was simply false.
//   • driver-invoices.ts emitted the same raw aurar under the same field name,
//     but documented it correctly as "VAT-inclusive amount in aurar". Right
//     unit, wrong name — so the file that understood the value could not tell
//     anyone, because the name said otherwise.
//   • The Flutter client then split the difference: DriverHistorySession
//     divides by 100 and is correct today only because the server is wrong in
//     exactly the compensating direction, while ActiveSession renders the same
//     server field with toStringAsFixed(0) and shows every in-flight session
//     100× too large.
//
// ── WHY A RENAME AND NOT A VALUE CHANGE ──────────────────────────────────
//
// Keeping `costIsk` and dividing by 100 on the server would have fixed the
// number and broken the one client that was already compensating — silently,
// producing amounts 100× too SMALL that still look like plausible money. A
// rename cannot fail that way: a client reading `costIsk` gets `null` from a
// payload that now carries `costAurar`, and a null cost is a state every
// driver surface already has to render ("Not priced"). The failure is visible
// on the first screen instead of on the first invoice dispute.
//
// This is the whole reason the boundary is expressed as a NAME and not as a
// convention: a wrong unit under a right-looking name is undetectable, and
// that is precisely how it survived to production.

/**
 * Put a money amount on the wire, in aurar.
 *
 * Value-preserving by design — the conversion this function performs is to the
 * JSON number type, never between units. It exists so that every money field
 * leaving the API passes through one named, tested place, and so that a
 * BigInt too large to survive JSON's double precision throws here rather than
 * silently losing its low digits on the way to a driver's phone.
 *
 * @param amountAurar aurar as BigInt (the storage type) or number, or null
 * @returns the same amount as a JSON-safe integer, or null when absent
 * @throws when the amount is not a safe integer — corrupt money fails loudly
 */
export function toWireAurar(amountAurar: bigint | number | null | undefined): number | null {
  if (amountAurar === null || amountAurar === undefined) return null;
  const n = typeof amountAurar === "bigint" ? Number(amountAurar) : amountAurar;
  if (!Number.isSafeInteger(n)) {
    // Non-integer (a float crept into a money path) or beyond 2^53 (a BigInt
    // that JSON cannot carry). Both mean the amount on the wire would not be
    // the amount in the database, so neither may be shipped.
    throw new Error("money_wire_amount_not_a_safe_integer");
  }
  return n;
}
