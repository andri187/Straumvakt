// Sprint 9 / ADR 0019 — Driver pre-session repository (GAP-3).
//
// Powers two driver-facing endpoints:
//
//   • listDriverInstallations — installations the driver can charge at
//     RIGHT NOW. An installation qualifies when:
//       1. driver has a DriverGroupMembership pointing into an Agreement
//          targeting that installation
//       2. agreement.status='active' AND now() is within
//          [effectiveFrom, effectiveUntil)
//       3. agreement has ≥ 1 AgreementClause (no "draft-only" agreements
//          — the operator's promise to the driver is that at least one
//          pricing line is set)
//
//   • getDriverChargerPricing — full clause+headline for a single
//     charger. Access check matches listDriverInstallations at single-
//     installation scope. Returns null when the charger doesn't exist OR
//     the driver lacks membership — the route then surfaces 404 either
//     way (don't leak existence).
//
// Pricing returned here is a PREVIEW. The session-stop resolver in
// apps/api/src/lib/agreement/resolve.ts is the canonical billing path;
// this module deliberately doesn't import it. The headline summary is
// "what the driver would pay if every clause's default bearer/rate ref
// applied unchanged" — BearerRule overrides and TRD/WRK substitutions
// are out of scope for the preview headline. The legend on the driver
// app says "indicative".
//
// Rule 7: routes consume the typed return values; no Prisma types leak
// past this module.

import type { PrismaClient } from "../generated/prisma/client";

// ── Public types ─────────────────────────────────────────────────────

export interface InstallationSummaryPricing {
  /** Total per-kWh rate the driver would pay across all driver-paying
   *  per-kWh clauses, as currency-minor BigInt-as-string. */
  perKwhMinor: string;
  currency: string;
  /** VAT rate from the active per-kWh rate references (assumed uniform
   *  across the per-kWh clauses; if heterogeneous, the highest wins so
   *  the headline never under-promises). */
  vatRatePct: string;
  /** RateReference rows carry VAT-exclusive prices in priceMinor (the
   *  agreements-schema convention). We don't pre-multiply here — the
   *  driver app renders "+ VAT (24%)" alongside the headline. */
  vatInclusive: boolean;
}

export interface InstallationSummary {
  id: string;
  displayName: string;
  siteId: string;
  siteDisplayName: string;
  /** Stringified Property.address ({street, postalCode, city, ...} as
   *  set by the operator) — null if address JSON is empty / missing. */
  siteAddress: string | null;
  pricingSummary: InstallationSummaryPricing;
  chargerCount: number;
  availableConnectorCount: number;
}

export interface ChargerPricingClause {
  factorCode: string;
  factorDisplayName: string;
  basisType: "per_kwh" | "per_minute" | "per_day" | "per_session";
  /** Driver's unit price, VAT-exclusive, currency-minor BigInt-as-string. */
  unitPriceMinor: string;
  vatRatePct: string;
  /** Resolved bearer for this clause (clause.defaultBearerType — preview
   *  only; BearerRule overrides not walked here). */
  bearerType: string;
  /** Convenience flag — bearerType === "usr". */
  driverPays: boolean;
  /** Free-text the operator wrote on the matching RateReference row. */
  notes: string | null;
}

export interface ChargerPricingSummary {
  perKwhMinor: string;
  perMinuteMinor: string;
  perSessionMinor: string;
  currency: string;
  vatInclusive: boolean;
}

export interface ChargerPricing {
  charger: {
    id: string;
    displayName: string;
    installationId: string;
    installationDisplayName: string;
  };
  terms: {
    clauses: ChargerPricingClause[];
    summary: ChargerPricingSummary;
    effectiveFrom: string;
    effectiveUntil: string | null;
  };
  /**
   * True when at least one session at this charger in the last 90 days
   * had a non-null ocmfBlobRef — signals to the driver app that a signed
   * receipt is available after the session ends. False when no historical
   * data is present or the charger has never produced OCMF blobs.
   *
   * ENRICH-1 dependency: ChargeSession.ocmfBlobRef is declared in the
   * Prisma schema; the column exists once the ENRICH-1 migration lands.
   */
  signedReceiptSupported: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────

const DEFAULT_CURRENCY = "ISK";
const DEFAULT_VAT_PCT = "24.00";

// Pick the RateReference row active at `at` for a given code. Used by
// both endpoints to translate clause.defaultRateRefCode → unit price.
async function findActiveRateRef(
  db: PrismaClient,
  code: string,
  at: Date,
): Promise<{
  priceMinor: bigint;
  basis: "per_kwh" | "per_minute" | "per_day" | "per_session";
  vatRatePct: string;
  currency: string;
  notes: string | null;
} | null> {
  const row = await db.rateReference.findFirst({
    where: {
      code,
      effectiveFrom: { lte: at },
      OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: at } }],
    },
    select: {
      priceMinor: true,
      basis: true,
      vatRatePct: true,
      currency: true,
      notes: true,
    },
    orderBy: { effectiveFrom: "desc" },
  });
  if (!row) return null;
  return {
    priceMinor: row.priceMinor,
    basis: row.basis as ChargerPricingClause["basisType"],
    vatRatePct: row.vatRatePct.toString(),
    currency: row.currency,
    notes: row.notes ?? null,
  };
}

// Aggregate a list of clauses into the per-kWh headline used by the
// installations list. Sums priceMinor across every per-kWh clause where
// defaultBearerType === 'usr' (driver pays). Returns the
// active-rate-reference row VAT rate when uniform; otherwise the max.
function summarisePerKwhForList(
  resolved: Array<{
    basis: string;
    priceMinor: bigint;
    vatRatePct: string;
    currency: string;
    driverPays: boolean;
  }>,
): InstallationSummaryPricing {
  let total = 0n;
  let vat = DEFAULT_VAT_PCT;
  let currency = DEFAULT_CURRENCY;
  let any = false;
  for (const r of resolved) {
    if (r.basis !== "per_kwh") continue;
    if (!r.driverPays) continue;
    total += r.priceMinor;
    any = true;
    currency = r.currency;
    // Headline never under-promises VAT: take the max rate seen.
    if (parseFloat(r.vatRatePct) > parseFloat(vat)) vat = r.vatRatePct;
  }
  return {
    perKwhMinor: total.toString(),
    currency,
    vatRatePct: any ? vat : DEFAULT_VAT_PCT,
    // RateReference.priceMinor is VAT-exclusive in the agreements schema.
    vatInclusive: false,
  };
}

// Aggregate clauses into the three-axis headline used by the charger
// pricing detail (per-kWh / per-minute / per-session).
function summariseForCharger(
  resolved: Array<{
    basis: string;
    priceMinor: bigint;
    currency: string;
    driverPays: boolean;
  }>,
): ChargerPricingSummary {
  let perKwh = 0n;
  let perMin = 0n;
  let perSess = 0n;
  let currency = DEFAULT_CURRENCY;
  for (const r of resolved) {
    if (!r.driverPays) continue;
    currency = r.currency;
    if (r.basis === "per_kwh") perKwh += r.priceMinor;
    else if (r.basis === "per_minute") perMin += r.priceMinor;
    else if (r.basis === "per_session") perSess += r.priceMinor;
  }
  return {
    perKwhMinor: perKwh.toString(),
    perMinuteMinor: perMin.toString(),
    perSessionMinor: perSess.toString(),
    currency,
    vatInclusive: false,
  };
}

// Property.address is JSON. Operators write
//   { street, postalCode, city, ... }
// but anything is allowed. Render as a single comma-separated line; null
// when address is empty / missing recognisable parts.
function stringifyAddress(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof r.street === "string" && r.street.trim()) parts.push(r.street.trim());
  // Postal code + city render together so "101 Reykjavik" stays as one
  // semantic unit.
  const postal = typeof r.postalCode === "string" ? r.postalCode.trim() : "";
  const city = typeof r.city === "string" ? r.city.trim() : "";
  if (postal || city) parts.push([postal, city].filter(Boolean).join(" "));
  if (parts.length === 0) return null;
  return parts.join(", ");
}

// ── listDriverInstallations ──────────────────────────────────────────

export async function listDriverInstallations(
  db: PrismaClient,
  userId: string,
  at?: Date,
): Promise<InstallationSummary[]> {
  const now = at ?? new Date();

  // One round-trip: pull every DriverGroupMembership whose Agreement is
  // active-at-now AND targets an installation AND has ≥1 clause. We
  // include clauses inline so we can resolve pricing without a second
  // pass.
  const memberships = await db.driverGroupMembership.findMany({
    where: {
      userId,
      driverGroup: {
        agreement: {
          agreementType: "installation",
          status: "active",
          installationId: { not: null },
          effectiveFrom: { lte: now },
          OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }],
          clauses: { some: {} }, // ≥1 clause → "not draft-only"
        },
      },
    },
    select: {
      driverGroup: {
        select: {
          agreement: {
            select: {
              id: true,
              installationId: true,
              installation: {
                select: {
                  id: true,
                  displayName: true,
                  siteId: true,
                  site: {
                    select: {
                      id: true,
                      displayName: true,
                      property: { select: { address: true } },
                    },
                  },
                },
              },
              clauses: {
                select: {
                  defaultBearerType: true,
                  defaultRateRefCode: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (memberships.length === 0) return [];

  // Dedup by installationId — a driver may be in multiple groups for
  // the same installation. We keep the FIRST agreement we saw per
  // installation; for the pilot, one active installation Agreement per
  // installation is the operator norm.
  const byInstallation = new Map<
    string,
    {
      installation: NonNullable<
        (typeof memberships)[number]["driverGroup"]["agreement"]["installation"]
      >;
      clauses: { defaultBearerType: string; defaultRateRefCode: string | null }[];
    }
  >();
  for (const m of memberships) {
    const inst = m.driverGroup.agreement.installation;
    if (!inst) continue;
    if (byInstallation.has(inst.id)) continue;
    byInstallation.set(inst.id, {
      installation: inst,
      clauses: m.driverGroup.agreement.clauses,
    });
  }

  const installationIds = Array.from(byInstallation.keys());
  if (installationIds.length === 0) return [];

  // Charger counts per installation — only ChargingStation rows that
  // have an EVSE/connector are "real". Mirror the existing /chargers
  // route filter (online-or-telemetry-seen) so the count matches what
  // the driver will see on the next screen.
  const stations = await db.chargingStation.findMany({
    where: {
      installationId: { in: installationIds },
      OR: [
        { onlineSinceAt: { not: null } },
        { lastTelemetryAt: { not: null } },
      ],
    },
    select: {
      siteAssetId: true,
      installationId: true,
      evses: {
        select: {
          connectors: {
            select: { status: true },
          },
        },
      },
    },
  });

  const chargerCount = new Map<string, number>();
  const availableConnectorCount = new Map<string, number>();
  for (const s of stations) {
    if (!s.installationId) continue;
    chargerCount.set(s.installationId, (chargerCount.get(s.installationId) ?? 0) + 1);
    let avail = 0;
    for (const e of s.evses) {
      for (const c of e.connectors) {
        // "Available" = status string is empty / null / explicitly says
        // available. Faulted / Charging / SuspendedEV / Preparing / etc.
        // do not count toward "available right now".
        const v = (c.status ?? "").toLowerCase();
        if (v === "" || v === "available" || v === "unknown") avail++;
      }
    }
    availableConnectorCount.set(
      s.installationId,
      (availableConnectorCount.get(s.installationId) ?? 0) + avail,
    );
  }

  // Resolve each unique rate-ref code once across all installations.
  const rateRefCodes = new Set<string>();
  for (const { clauses } of byInstallation.values()) {
    for (const c of clauses) {
      if (c.defaultRateRefCode) rateRefCodes.add(c.defaultRateRefCode);
    }
  }
  const rateRefByCode = new Map<
    string,
    Awaited<ReturnType<typeof findActiveRateRef>>
  >();
  await Promise.all(
    Array.from(rateRefCodes).map(async (code) => {
      rateRefByCode.set(code, await findActiveRateRef(db, code, now));
    }),
  );

  // Build the response in a stable order — by installation displayName.
  const out: InstallationSummary[] = [];
  for (const [installationId, { installation, clauses }] of byInstallation) {
    const resolved = clauses
      .map((c) => {
        if (!c.defaultRateRefCode) return null;
        const rr = rateRefByCode.get(c.defaultRateRefCode);
        if (!rr) return null;
        return {
          basis: rr.basis,
          priceMinor: rr.priceMinor,
          vatRatePct: rr.vatRatePct,
          currency: rr.currency,
          driverPays: c.defaultBearerType === "usr",
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    out.push({
      id: installation.id,
      displayName: installation.displayName,
      siteId: installation.site.id,
      siteDisplayName: installation.site.displayName,
      siteAddress: stringifyAddress(installation.site.property.address),
      pricingSummary: summarisePerKwhForList(resolved),
      chargerCount: chargerCount.get(installationId) ?? 0,
      availableConnectorCount: availableConnectorCount.get(installationId) ?? 0,
    });
  }
  out.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return out;
}

// ── getDriverChargerPricing ──────────────────────────────────────────

export async function getDriverChargerPricing(
  db: PrismaClient,
  userId: string,
  chargerId: string,
  at?: Date,
): Promise<ChargerPricing | null> {
  const now = at ?? new Date();

  // Resolve charger → installation in one shot. ChargingStation.id ===
  // siteAssetId — that's the model invariant from Sprint 0.
  const station = await db.chargingStation.findUnique({
    where: { siteAssetId: chargerId },
    select: {
      siteAssetId: true,
      installationId: true,
      siteAsset: { select: { displayName: true } },
      installation: { select: { id: true, displayName: true } },
    },
  });
  if (!station || !station.installationId || !station.installation) {
    // No charger / charger isn't placed at an installation → 404 at the
    // route. Don't distinguish — operator hasn't surfaced it for drivers.
    return null;
  }

  // Access check at installation scope. If the driver has NO membership
  // covering this installation, we return null and the route renders
  // 404 — same as if the charger didn't exist (don't leak existence).
  const access = await db.driverGroupMembership.findFirst({
    where: {
      userId,
      driverGroup: {
        agreement: {
          agreementType: "installation",
          installationId: station.installationId,
          status: "active",
          effectiveFrom: { lte: now },
          OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }],
          clauses: { some: {} },
        },
      },
    },
    select: {
      driverGroup: {
        select: {
          agreement: {
            select: {
              id: true,
              effectiveFrom: true,
              effectiveUntil: true,
              clauses: {
                select: {
                  defaultBearerType: true,
                  defaultRateRefCode: true,
                  costFactor: {
                    select: { code: true, displayNameEn: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!access) return null;

  const agreement = access.driverGroup.agreement;

  // signedReceiptSupported: check whether any session at this charger in
  // the last 90 days had a non-null ocmfBlobRef. Runs in parallel with
  // rate-ref resolution so there's no extra round-trip latency on the
  // happy path.
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  // Resolve every rate-ref code in parallel.
  const codes = Array.from(
    new Set(
      agreement.clauses
        .map((c) => c.defaultRateRefCode)
        .filter((x): x is string => !!x),
    ),
  );
  const rateRefByCode = new Map<
    string,
    Awaited<ReturnType<typeof findActiveRateRef>>
  >();
  const [, ocmfCheck] = await Promise.all([
    Promise.all(
      codes.map(async (code) => {
        rateRefByCode.set(code, await findActiveRateRef(db, code, now));
      }),
    ),
    db.chargeSession.findFirst({
      where: {
        chargingStationId: station.siteAssetId,
        startedAt: { gte: ninetyDaysAgo },
        ocmfBlobRef: { not: null },
      },
      select: { id: true },
    }),
  ]);

  const signedReceiptSupported = ocmfCheck !== null;

  // Build clause rows + a parallel "resolved" list for the headline.
  const clauseRows: ChargerPricingClause[] = [];
  const resolved: Array<{
    basis: string;
    priceMinor: bigint;
    currency: string;
    driverPays: boolean;
  }> = [];
  for (const c of agreement.clauses) {
    const rr = c.defaultRateRefCode ? rateRefByCode.get(c.defaultRateRefCode) : null;
    const driverPays = c.defaultBearerType === "usr";
    if (rr) {
      resolved.push({
        basis: rr.basis,
        priceMinor: rr.priceMinor,
        currency: rr.currency,
        driverPays,
      });
    }
    clauseRows.push({
      factorCode: c.costFactor.code,
      factorDisplayName: c.costFactor.displayNameEn,
      // If no rate-ref is set, the clause exists but has no price yet.
      // Surface basis as 'per_kwh' (safest default for the driver
      // headline; the price will be "0" and notes will be null).
      basisType: (rr?.basis ?? "per_kwh") as ChargerPricingClause["basisType"],
      unitPriceMinor: (rr?.priceMinor ?? 0n).toString(),
      vatRatePct: rr?.vatRatePct ?? DEFAULT_VAT_PCT,
      bearerType: c.defaultBearerType,
      driverPays,
      notes: rr?.notes ?? null,
    });
  }

  // Stable order — by factor code (DSO, ELE, ...). Helps the app render
  // a consistent list across refreshes.
  clauseRows.sort((a, b) => a.factorCode.localeCompare(b.factorCode));

  return {
    charger: {
      id: station.siteAssetId,
      displayName: station.siteAsset?.displayName ?? "Charger",
      installationId: station.installation.id,
      installationDisplayName: station.installation.displayName,
    },
    terms: {
      clauses: clauseRows,
      summary: summariseForCharger(resolved),
      effectiveFrom: agreement.effectiveFrom.toISOString(),
      effectiveUntil: agreement.effectiveUntil?.toISOString() ?? null,
    },
    signedReceiptSupported,
  };
}
