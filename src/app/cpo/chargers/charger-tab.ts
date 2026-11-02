// Which Chargers tab to open. Kept out of the client component so the server page can call it.
export type ChargerTab = "registered" | "knocking";

/** `?tab=knocking` opens the Knocking tab; anything else (absent, repeated, unknown) opens Already onboarded. */
export const parseChargerTab = (v: string | string[] | null | undefined): ChargerTab => ((Array.isArray(v) ? v[0] : v) === "knocking" ? "knocking" : "registered");
