export function displayUnknown(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "Unavailable";
}

export function formatEnergyKwh(value: number | null): string {
  return value == null
    ? "Not reported"
    : `${value.toLocaleString("en-GB", { maximumFractionDigits: 3 })} kWh`;
}

export function formatPowerKw(value: number | null): string {
  return value == null ? "Unavailable" : `${value.toFixed(1)} kW`;
}

export function formatCost(value: string | null): string {
  return value?.trim() || "Pending";
}

export function normalizeStatus(value: string): string {
  return value.replaceAll("_", " ").trim() || "unknown";
}

export function statusTone(
  value: string,
): "ok" | "warning" | "danger" | "mut" {
  const status = value.toLowerCase();
  if (["online", "active", "approved", "completed", "charging"].includes(status)) {
    return "ok";
  }
  if (["pending", "preparing", "suspended", "unknown"].includes(status)) {
    return "warning";
  }
  if (["faulted", "failed", "denied", "rejected"].includes(status)) {
    return "danger";
  }
  return "mut";
}

export function validDenialReason(value: string): boolean {
  const length = value.trim().length;
  return length >= 3 && length <= 500;
}

export function demoValueIsReserved(value: string): boolean {
  return value.startsWith("demo-") || value.endsWith(".test");
}

export function previewFixtureIsReserved(value: unknown): boolean {
  if (typeof value === "string") {
    if (value.includes("@")) return value.endsWith(".test");
    if (/\b(?:id|org|driver|site|cp)-/i.test(value)) {
      return value.toLowerCase().includes("demo");
    }
    return true;
  }
  if (Array.isArray(value)) return value.every(previewFixtureIsReserved);
  if (value && typeof value === "object") {
    return Object.values(value).every(previewFixtureIsReserved);
  }
  return true;
}

