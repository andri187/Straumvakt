// Fyrirtækjaskrá rekstrarform → human label.
//
// Source: Skatturinn / Fyrirtækjaskrá. Codes are letter+digit; the
// most common ones cover ~95% of Iceland's registered companies.
// Add more as needed; an unknown code just leaves the label blank
// for the operator to fill.

export const LEGAL_FORM_CODES: Record<string, string> = {
  // Hlutafélög + einkahlutafélög (most common)
  D1: "Hlutafélag, almennt (hf)",
  D2: "Einkahlutafélag (ehf)",
  D3: "Sameignarfélag (sf)",
  D4: "Samvinnufélag (svf)",
  D5: "Útibú erlends fyrirtækis",

  // Sjálfseignarstofnanir + opinber rekstur
  E1: "Sjálfseignarstofnun",
  E2: "Sjóður",
  E3: "Stofnun",
  F1: "Sveitarfélag",
  F2: "Ríkisstofnun",
  F3: "Ráðuneyti",

  // Félagasamtök
  G1: "Félag eða samtök",
  G2: "Trúfélag",
  G3: "Stéttarfélag",

  // Einstaklingsrekstur
  H1: "Einstaklingsrekstur",

  // Erlend félög
  J1: "Erlent félag (skráð útibú)",
  J2: "Erlent félag (ekki skráð útibú)",
};

/**
 * Look up a Fyrirtækjaskrá legal-form code. Returns null when not in
 * the table — operator can type the long label manually.
 */
export function lookupLegalForm(rawCode: string): string | null {
  const code = rawCode.trim().toUpperCase();
  return LEGAL_FORM_CODES[code] ?? null;
}
