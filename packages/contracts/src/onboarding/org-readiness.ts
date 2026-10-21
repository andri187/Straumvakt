// Is this organisation invoiceable?
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────
//
// Claude A's pipeline correctly REFUSES to invoice an org that is not ready —
// one of its dry-run refusal cases is `refuses-host-without-kennitala`. That
// refusal is right, and it arrives at the worst possible moment: month end,
// when someone is trying to bill a customer.
//
// The answer is not to relax the refusal. It is to ask the same question at
// ONBOARDING, when fixing it is free. This module is that question.
//
// ── WHY HOLDS AND NOT A BOOLEAN ─────────────────────────────────────────
//
// Deliberately the same shape as A's `FlatFeeHold`: an array of named
// reasons. A's rule applies here for the same reason it applies there —
// report EVERY reason at once, so that fixing one does not reveal the next a
// month later. An org missing a kennitala AND an agreement should learn both
// facts in one call, not across two billing cycles.
//
// A bare `false` tells an operator nothing they can act on.
//
// ── PURE, AND A PORT ────────────────────────────────────────────────────
//
// No database, no network, no clock. Facts in, holds out. That is what lets
// scripts/dry-run-onboard-org.mts prove the whole path offline, the way A
// proved the invoice.

/** Every reason an org cannot be invoiced. */
export type ReadinessReason =
  | "org_missing"
  | "org_not_active"
  | "org_roles_unset"
  | "legal_name_missing"
  | "kennitala_missing"
  | "kennitala_invalid"
  | "currency_unset"
  | "no_enrolled_user"
  | "no_charger_attached"
  | "no_connector_in_asset_chain"
  | "no_agreement"
  | "agreement_not_in_force_for_period"
  | "agreement_has_no_connector_rate";

export interface ReadinessHold {
  reason: ReadinessReason;
  /** One line, for a human reading an onboarding screen or a CLI. */
  detail: string;
  /** What to DO. A hold without a remedy is a complaint. */
  remedy: string;
}

export interface ReadinessOrgFacts {
  id: string;
  status: string;
  displayName: string;
  legalName: string | null;
  /** Normalised, digits only. Never logged. */
  kennitala: string | null;
  vskNr: string | null;
  countryCode: string;
  defaultCurrency: string | null;
  roles: readonly string[];
}

export interface ReadinessAgreementFacts {
  /** ISO date the agreement takes effect. */
  effectiveFrom: string;
  /** ISO date it stops, or null for open-ended. */
  effectiveTo: string | null;
  /** Does it carry the per-connector cost factor the flat fee needs? */
  hasConnectorRate: boolean;
}

export interface OrgReadinessFacts {
  org: ReadinessOrgFacts | null;
  /** Users enrolled with an active membership in this org. */
  enrolledUserCount: number;
  /** Chargers bound to this org. */
  attachedChargerCount: number;
  /** Connectors reachable through the asset chain for those chargers. */
  connectorCount: number;
  agreements: readonly ReadinessAgreementFacts[];
  /** The billing period being tested. ISO dates, inclusive. */
  period: { from: string; to: string };
  /**
   * Whether the kennitala passes checksum validation.
   *
   * Passed IN rather than computed here so this module never handles a
   * kennitala value it does not need — the caller validates once and reports
   * the verdict. That keeps the identifier out of one more code path.
   */
  kennitalaValid: boolean;
}

export interface OrgReadiness {
  invoiceable: boolean;
  holds: ReadinessHold[];
  /** Every prerequisite met, so a UI can show progress rather than only failure. */
  satisfied: string[];
}

const hold = (reason: ReadinessReason, detail: string, remedy: string): ReadinessHold => ({
  reason,
  detail,
  remedy,
});

/**
 * Assess an org against every precondition A's pipeline requires.
 *
 * Reports ALL holds — never short-circuits. See the file header.
 */
export function assessOrgReadiness(facts: OrgReadinessFacts): OrgReadiness {
  const holds: ReadinessHold[] = [];
  const satisfied: string[] = [];
  const ok = (what: string) => satisfied.push(what);

  const org = facts.org;
  if (!org) {
    return {
      invoiceable: false,
      holds: [hold("org_missing", "no organisation was found", "create the org via POST /api/admin/orgs")],
      satisfied: [],
    };
  }
  ok("org exists");

  if (org.status !== "active") {
    holds.push(hold("org_not_active", `org status is ${org.status}`, "set the org status to active"));
  } else ok("org is active");

  if (!org.roles || org.roles.length === 0) {
    holds.push(
      hold(
        "org_roles_unset",
        "org has no roles; a host org needs at least site_host",
        "PATCH the org with roles including site_host",
      ),
    );
  } else ok("org roles set");

  if (!org.legalName || org.legalName.trim() === "") {
    holds.push(
      hold(
        "legal_name_missing",
        "no legal name; the invoice header names the kroefuhafi by legal name",
        "PATCH the org with legalName",
      ),
    );
  } else ok("legal name present");

  // The one this whole round exists for.
  if (!org.kennitala || org.kennitala.trim() === "") {
    holds.push(
      hold(
        "kennitala_missing",
        "no kennitala; the invoice header refuses to render without the claim holder's registered identity",
        "PATCH the org with kennitala — ask the host, it cannot be derived",
      ),
    );
  } else if (!facts.kennitalaValid) {
    holds.push(
      hold(
        "kennitala_invalid",
        "kennitala fails checksum or date validation",
        "re-enter the kennitala; a transposed pair is the usual cause",
      ),
    );
  } else ok("kennitala captured and valid");

  if (!org.defaultCurrency || org.defaultCurrency.trim() === "") {
    holds.push(hold("currency_unset", "org has no default currency", "set defaultCurrency to ISK"));
  } else ok("currency set");

  if (facts.enrolledUserCount < 1) {
    holds.push(
      hold(
        "no_enrolled_user",
        "no user is enrolled in this org",
        "invite or add a membership via POST /api/admin/orgs/:orgId/memberships",
      ),
    );
  } else ok("at least one user enrolled");

  if (facts.attachedChargerCount < 1) {
    holds.push(
      hold("no_charger_attached", "no charger is attached to this org", "attach a charger — see the operator script"),
    );
  } else ok("at least one charger attached");

  // A charger with no connectors bills nothing: the flat fee is per CONNECTOR.
  if (facts.connectorCount < 1) {
    holds.push(
      hold(
        "no_connector_in_asset_chain",
        "no connector exists in the asset chain; the flat fee is per connector, so this org would bill zero",
        "create the EVSE and connector rows for the attached charger",
      ),
    );
  } else ok("connectors present in the asset chain");

  if (facts.agreements.length === 0) {
    holds.push(
      hold(
        "no_agreement",
        "no agreement exists for this org",
        "create the flat-fee agreement — one cost factor, one rate reference",
      ),
    );
  } else {
    const inForce = facts.agreements.filter(
      (a) =>
        a.effectiveFrom <= facts.period.from &&
        (a.effectiveTo === null || a.effectiveTo >= facts.period.to),
    );
    if (inForce.length === 0) {
      holds.push(
        hold(
          "agreement_not_in_force_for_period",
          `no agreement covers ${facts.period.from}..${facts.period.to}`,
          "extend or backdate the agreement to cover the billing period",
        ),
      );
    } else if (!inForce.some((a) => a.hasConnectorRate)) {
      holds.push(
        hold(
          "agreement_has_no_connector_rate",
          "an agreement is in force but carries no per-connector rate reference",
          "add the per_connector cost factor and its rate reference",
        ),
      );
    } else ok("flat-fee agreement in force for the period");
  }

  return { invoiceable: holds.length === 0, holds, satisfied };
}

/**
 * Human-readable report.
 *
 * Safe to print and safe to paste into a ticket: it names the org by label
 * only and carries no kennitala, no member identity and no charger identity.
 */
export function formatReadiness(r: OrgReadiness, orgLabel: string): string {
  const lines: string[] = [];
  lines.push(`Org readiness — ${orgLabel}`);
  lines.push("");
  for (const s of r.satisfied) lines.push(`  OK    ${s}`);
  for (const h of r.holds) {
    lines.push(`  HOLD  ${h.reason}`);
    lines.push(`          ${h.detail}`);
    lines.push(`          remedy: ${h.remedy}`);
  }
  lines.push("");
  lines.push(
    r.invoiceable
      ? "  INVOICEABLE — every precondition the billing pipeline requires is satisfied."
      : `  NOT INVOICEABLE — ${r.holds.length} hold(s).`,
  );
  return lines.join("\n");
}
