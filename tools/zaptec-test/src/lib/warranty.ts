// Zaptec hardware warranty: 5 years from commission date.
// Commission date = Zaptec charger.CreatedOnDate (when the charger was first
// provisioned in the Zaptec portal). This mirrors Straumvakt's
// assets.chargers.warranty_expires which is stored separately so it can be
// overridden per unit if the vendor grants an extension.

const WARRANTY_YEARS = 5;

export type WarrantyStatus = {
  inWarranty: boolean;
  commissionedAt: Date | null;
  expiresAt: Date | null;
  // positive when in warranty, negative when expired
  daysRemaining: number | null;
  yearsInService: number | null;
};

export function computeWarranty(
  commissionIso: string | null | undefined,
  now: Date = new Date(),
): WarrantyStatus {
  if (!commissionIso) {
    return {
      inWarranty: false,
      commissionedAt: null,
      expiresAt: null,
      daysRemaining: null,
      yearsInService: null,
    };
  }
  const commissionedAt = new Date(commissionIso);
  if (Number.isNaN(commissionedAt.getTime())) {
    return {
      inWarranty: false,
      commissionedAt: null,
      expiresAt: null,
      daysRemaining: null,
      yearsInService: null,
    };
  }
  const expiresAt = new Date(commissionedAt);
  expiresAt.setFullYear(expiresAt.getFullYear() + WARRANTY_YEARS);
  const msRemaining = expiresAt.getTime() - now.getTime();
  const daysRemaining = Math.round(msRemaining / (1000 * 60 * 60 * 24));
  const msInService = now.getTime() - commissionedAt.getTime();
  const yearsInService = msInService / (1000 * 60 * 60 * 24 * 365.25);

  return {
    inWarranty: msRemaining > 0,
    commissionedAt,
    expiresAt,
    daysRemaining,
    yearsInService,
  };
}

export function fmtYears(years: number | null): string {
  if (years == null) return "—";
  if (years < 1) {
    const months = Math.round(years * 12);
    return `${months} mo`;
  }
  return `${years.toFixed(1)} y`;
}
