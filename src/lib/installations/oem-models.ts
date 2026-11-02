// The charger models offered on the "Add installation" board. A card is actionable only when the model maps to an OEM vendor
// that this deployment has switched on (enabledVendors: CPO_VENDOR_CONNECT intersected with the server's actual readers).
// Anything else is shown for orientation and cannot be chosen. The picture of a model is not evidence of support.
//
// Images: 360 px WebP derivatives of docs/reference/charger-images/onepole-2026-10-31/images (originals untouched). The
// filename keeps the original's hash for provenance. Their reuse rights are NOT verified; see public/oem-models/README.md.

export type OemModel = {
  id: string;
  brand: string;
  model: string;
  /** Path under /oem-models, listed in the shell's public asset allow-list. */
  image: string;
  /** The OEM reader that onboards this model, or null when no reader exists for it. */
  vendor: "easee" | "zaptec" | null;
};

export const OEM_MODELS: readonly OemModel[] = [
  { id: "easee-charge", brand: "Easee", model: "Charge", image: "easee-charge-72bf555c.webp", vendor: "easee" },
  { id: "zaptec-pro", brand: "Zaptec", model: "Pro", image: "zaptec-pro-1f7fbd29.webp", vendor: "zaptec" },
  { id: "alfen-eve-double-pro-line", brand: "Alfen", model: "Eve Double Pro-Line", image: "alfen-eve-double-pro-line-586466c3.webp", vendor: null },
  { id: "alfen-eve-single-pro-line", brand: "Alfen", model: "Eve Single Pro-Line", image: "alfen-eve-single-pro-line-a4f78743.webp", vendor: null },
  { id: "autel-maxicharger-ac-wallbox", brand: "Autel", model: "MaxiCharger AC Wallbox", image: "autel-maxicharger-ac-wallbox-f1774b29.webp", vendor: null },
  { id: "charge-amps-aura", brand: "Charge Amps", model: "Aura", image: "charge-amps-aura-a9f3a303.webp", vendor: null },
  { id: "charge-amps-dawn", brand: "Charge Amps", model: "Dawn", image: "charge-amps-dawn-9bbacca4.webp", vendor: null },
  { id: "charge-amps-halo", brand: "Charge Amps", model: "Halo", image: "charge-amps-halo-bc0afd5e.webp", vendor: null },
  { id: "charge-amps-luna", brand: "Charge Amps", model: "Luna", image: "charge-amps-luna-a0b003a9.webp", vendor: null },
  { id: "nexblue-edge", brand: "NexBlue", model: "Edge", image: "nexblue-edge-9f25d218.webp", vendor: null },
  // Zaptec Go is not offered: the Zaptec reader has been exercised against Pro-class installations only.
  { id: "zaptec-go", brand: "Zaptec", model: "Go", image: "zaptec-go-45a04b3f.webp", vendor: null },
];

export const OEM_IMAGE_PATHS: readonly string[] = OEM_MODELS.map((m) => `/oem-models/${m.image}`);

/** available: can be chosen. not_enabled: a reader exists but this deployment has not switched it on. unsupported: no reader. */
export type ModelCardState = "available" | "not_enabled" | "unsupported";
export type ModelCard = OemModel & { state: ModelCardState; href: string | null };

export const onboardHref = (vendor: string) => `/cpo/installations?onboard=1&model=${encodeURIComponent(vendor)}`;

export function modelCards(enabledVendors: readonly string[]): ModelCard[] {
  return OEM_MODELS.map((m) => {
    const state: ModelCardState = m.vendor === null ? "unsupported" : enabledVendors.includes(m.vendor) ? "available" : "not_enabled";
    return { ...m, state, href: state === "available" && m.vendor ? onboardHref(m.vendor) : null };
  });
}
