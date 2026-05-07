// Signal-quality colour + label helpers for the operator UI.
// Sprint 9.8.2 — single source of truth so the /chargers list and
// the /chargers/[id] technical-read pills can't drift apart.
//
// Cisco-aligned Wi-Fi/RSSI thresholds (closer to industry practice
// than the stricter scale used in 8.4.7.2):
//
//   ≥ -67 dBm   excellent   green   HD video / VoIP grade
//   -67 to -75  good        yellow  reliable for most apps
//   -75 to -85  fair        orange  degrading, OCPP still works
//   <  -85 dBm  poor        red     unreliable
//
// Cellular (LTE / 4G / 5G) — Zaptec emits StateId 809 as a 0-100
// percentage on cellular modems where higher is better. Same four
// buckets, scaled to percent:
//
//   ≥ 75   excellent   green
//   50-75  good        yellow
//   25-50  fair        orange
//   < 25   poor        red
//
// PLC / Ethernet — no signal reported; null. Renders as "—" gray.

const DASH = "—";

export function isCellularComm(mode: string | null | undefined): boolean {
  if (!mode) return false;
  return /lte|cellular|4g|5g|3g|gsm/i.test(mode);
}

/**
 * Returns a Tailwind text-colour class. Pass `value` and `commMode`
 * (the Zaptec StateId 150 label) — `null` mode falls through to the
 * dBm interpretation which is correct for Wi-Fi and any RF transport
 * we don't recognise.
 */
export function signalIconClass(
  value: number | null,
  commMode: string | null,
): string {
  if (value == null) return "text-ink-500";
  if (isCellularComm(commMode)) {
    if (value >= 75) return "text-emerald-400";
    if (value >= 50) return "text-yellow-400";
    if (value >= 25) return "text-orange-400";
    return "text-rose-400";
  }
  // dBm — magnitude-based; smaller magnitude = stronger signal.
  // Some firmwares emit positive magnitude (60 meaning -60); use abs.
  const m = Math.abs(value);
  if (m <= 67) return "text-emerald-400";
  if (m <= 75) return "text-yellow-400";
  if (m <= 85) return "text-orange-400";
  return "text-rose-400";
}

/**
 * Render a signal value with its appropriate unit. Cellular -> "X%";
 * dBm transports -> "-X dBm" canonical-negative.
 */
export function formatSignal(
  value: number | null,
  commMode: string | null,
): string {
  if (value == null) return DASH;
  if (isCellularComm(commMode)) {
    return `${Math.round(value)}%`;
  }
  // RF: ensure displayed as negative dBm regardless of source sign.
  const v = value <= 0 ? value : -value;
  return `${v} dBm`;
}

/**
 * 0-100 quality proxy used for sorting heterogeneous transports.
 * Cellular passes through; dBm is mapped via 100-|dBm| so a -50 dBm
 * Wi-Fi (quality 50) and a 50% cellular sort identically.
 */
export function signalQuality(
  value: number | null,
  commMode: string | null,
): number | null {
  if (value == null) return null;
  if (isCellularComm(commMode)) return value;
  return 100 - Math.abs(value);
}
