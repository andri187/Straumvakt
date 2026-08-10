// Authoritative enums from /api/constants. SmartWarnings, VarisciteWarnings,
// Phases, and Features are bitmasks: each set bit identifies an active flag.

export const SmartWarnings: Record<string, number> = {
  WARNING_OK: 0,
  WARNING_HUMIDITY: 1,
  WARNING_TEMPERATURE: 2,
  WARNING_TEMPERATURE_ERROR: 4,
  WARNING_EMETER_NO_RESPONSE: 8,
  WARNING_MAX_SESSION_RESTART: 16,
  WARNING_CHARGE_OVERCURRENT: 32,
  WARNING_PILOT_STATE: 64,
  WARNING_RELAY_WELDED: 128,
  WARNING_PILOT_LOW_LEVEL: 256,
  WARNING_FPGA_COM_TIMEOUT: 512,
  WARNING_REBOOT: 1024,
  WARNING_DISABLED: 2048,
  WARNING_RCD_AC: 4096,
  WARNING_RCD_DC: 8192,
  WARNING_RCD_PEAK: 16384,
  WARNING_RCD_TEST_AC: 65536,
  WARNING_RCD_TEST_DC: 131072,
  WARNING_RCD_FAILURE: 262144,
  WARNING_RCD_TEST_TIMEOUT: 524288,
  WARNING_FPGA_VERSION: 1048576,
  WARNING_FPGA_UNEXPECTED_RELAY: 2097152,
  WARNING_FPGA_CHARGING_RESET: 4194304,
  WARNING_PILOT_NO_PROXIMITY: 8388608,
  WARNING_EMETER_ALARM: 16777216,
  WARNING_EMETER_LINK: 33554432,
  WARNING_NO_VOLTAGE_L1: 67108864,
  WARNING_NO_VOLTAGE_L2_L3: 134217728,
  WARNING_FPGA_WATCHDOG: 268435456,
  WARNING_EMETER_CAL: 536870912,
  WARNING_MID: 1073741824,
};

export const VarisciteWarnings: Record<string, number> = {
  WARNING_MCU_BOOTLOADER: 1,
  WARNING_FPGA_INIT_FAILED: 2,
  WARNING_VARISCITE_ILLEGAL_PHASE: 4,
};

// Translate raw warning code "WARNING_RCD_AC" → "RCD AC fault"
const WARNING_LABELS: Record<string, { label: string; severity: "high" | "medium" | "low" }> = {
  WARNING_HUMIDITY: { label: "Internal humidity high", severity: "medium" },
  WARNING_TEMPERATURE: { label: "Temperature limit reached", severity: "medium" },
  WARNING_TEMPERATURE_ERROR: { label: "Temperature sensor error", severity: "high" },
  WARNING_EMETER_NO_RESPONSE: { label: "Energy meter not responding", severity: "high" },
  WARNING_MAX_SESSION_RESTART: { label: "Session restart limit hit", severity: "medium" },
  WARNING_CHARGE_OVERCURRENT: { label: "Charge overcurrent", severity: "high" },
  WARNING_PILOT_STATE: { label: "CP pilot state error", severity: "high" },
  WARNING_RELAY_WELDED: { label: "Relay welded — STOP USING", severity: "high" },
  WARNING_PILOT_LOW_LEVEL: { label: "CP pilot low level", severity: "medium" },
  WARNING_FPGA_COM_TIMEOUT: { label: "FPGA communication timeout", severity: "high" },
  WARNING_REBOOT: { label: "Recently rebooted", severity: "low" },
  WARNING_DISABLED: { label: "Charger disabled", severity: "medium" },
  WARNING_RCD_AC: { label: "RCD AC fault", severity: "high" },
  WARNING_RCD_DC: { label: "RCD DC fault", severity: "high" },
  WARNING_RCD_PEAK: { label: "RCD peak fault", severity: "high" },
  WARNING_RCD_TEST_AC: { label: "RCD self-test AC failed", severity: "high" },
  WARNING_RCD_TEST_DC: { label: "RCD self-test DC failed", severity: "high" },
  WARNING_RCD_FAILURE: { label: "RCD failure", severity: "high" },
  WARNING_RCD_TEST_TIMEOUT: { label: "RCD self-test timeout", severity: "high" },
  WARNING_FPGA_VERSION: { label: "FPGA version mismatch", severity: "medium" },
  WARNING_FPGA_UNEXPECTED_RELAY: { label: "FPGA reports unexpected relay state", severity: "high" },
  WARNING_FPGA_CHARGING_RESET: { label: "FPGA reset while charging", severity: "high" },
  WARNING_PILOT_NO_PROXIMITY: { label: "CP without proximity signal", severity: "medium" },
  WARNING_EMETER_ALARM: { label: "Energy meter alarm", severity: "high" },
  WARNING_EMETER_LINK: { label: "Energy meter link error", severity: "high" },
  WARNING_NO_VOLTAGE_L1: { label: "No voltage on L1", severity: "high" },
  WARNING_NO_VOLTAGE_L2_L3: { label: "No voltage on L2/L3", severity: "high" },
  WARNING_FPGA_WATCHDOG: { label: "FPGA watchdog tripped", severity: "high" },
  WARNING_EMETER_CAL: { label: "Energy meter calibration error", severity: "high" },
  WARNING_MID: { label: "MID metrology fault", severity: "high" },
  WARNING_MCU_BOOTLOADER: { label: "MCU stuck in bootloader", severity: "high" },
  WARNING_FPGA_INIT_FAILED: { label: "FPGA failed to initialize", severity: "high" },
  WARNING_VARISCITE_ILLEGAL_PHASE: { label: "Illegal phase selected", severity: "high" },
};

export type DecodedWarning = {
  code: string;
  bit: number;
  label: string;
  severity: "high" | "medium" | "low";
};

export function decodeWarnings(raw: string | undefined): DecodedWarning[] {
  if (!raw) return [];
  // Values are returned as stringified bigints for high bits
  let value: bigint;
  try {
    value = BigInt(raw);
  } catch {
    const n = Number(raw);
    if (!Number.isFinite(n) || n === 0) return [];
    value = BigInt(n);
  }
  if (value === 0n) return [];

  const flags: DecodedWarning[] = [];
  const all: Array<[string, number]> = [
    ...Object.entries(SmartWarnings),
    ...Object.entries(VarisciteWarnings),
  ];
  for (const [code, bit] of all) {
    if (bit === 0) continue;
    if ((value & BigInt(bit)) !== 0n) {
      const meta = WARNING_LABELS[code] ?? { label: code, severity: "medium" as const };
      flags.push({ code, bit, label: meta.label, severity: meta.severity });
    }
  }
  return flags;
}

// ── Features bitmask (installation.AvailableFeatures / EnabledFeatures) ────
export const Features: Record<string, number> = {
  None: 0,
  Api_MessageSubscription: 1,
  Authentication_Internal: 2,
  PowerManagement_Apm: 4,
  PowerManagement_EcoMode: 8,
  PowerManagement_Schedule: 16,
  PowerManagement_Apm_PowerLimit: 32,
  Connectivity_4G: 64,
  Authentication_Ocpp: 128,
  PowerManagement_Apm_Tariff_PowerLimit: 256,
  Authentication_OcppNative: 512,
  PowerManagement_Apm_Tic: 65536,
  PowerManagement_Apm_SurplusMode: 131072,
};

const FEATURE_LABELS: Record<string, string> = {
  Api_MessageSubscription: "Real-time push (Service Bus)",
  Authentication_Internal: "Built-in driver auth",
  PowerManagement_Apm: "Active Power Management (DLB)",
  PowerManagement_EcoMode: "Eco Mode (off-peak charging)",
  PowerManagement_Schedule: "Charging schedules",
  PowerManagement_Apm_PowerLimit: "DLB power limit",
  Connectivity_4G: "Cellular (4G/LTE)",
  Authentication_Ocpp: "OCPP authorization",
  PowerManagement_Apm_Tariff_PowerLimit: "Tariff-aware power limit",
  Authentication_OcppNative: "Native OCPP auth (no Zaptec)",
  PowerManagement_Apm_Tic: "TIC HAN-port DLB (FR)",
  PowerManagement_Apm_SurplusMode: "PV surplus charging",
};

export type DecodedFeature = { code: string; label: string; bit: number };

export function decodeFeatures(raw: number | string | undefined): DecodedFeature[] {
  if (raw == null) return [];
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (!Number.isFinite(n) || n === 0) return [];
  const out: DecodedFeature[] = [];
  for (const [code, bit] of Object.entries(Features)) {
    if (bit === 0) continue;
    if ((n & bit) !== 0) {
      out.push({ code, bit, label: FEATURE_LABELS[code] ?? code });
    }
  }
  return out;
}

// ── Phases bitmask ──────────────────────────────────────────────────────────
export function decodePhases(raw: string | undefined): string[] {
  if (raw == null || raw === "") return [];
  const n = Number(raw);
  if (!Number.isFinite(n)) return [];
  const out: string[] = [];
  if (n & 1) out.push("L1");
  if (n & 2) out.push("L2");
  if (n & 4) out.push("L3");
  return out;
}

// ── Communication mode (StateId 150) ───────────────────────────────────────
// Live data shows Zaptec returns either numeric codes ("0"–"4") OR the
// literal label ("Wi-Fi", "PLC", etc.) depending on charger firmware. Accept
// both so the UI doesn't go blank when the form changes.
export function communicationModeLabel(raw: string | undefined): string {
  if (raw == null || raw === "") return "—";
  switch (raw) {
    case "0":
      return "None";
    case "1":
      return "Wi-Fi";
    case "2":
      return "Cellular (LTE)";
    case "3":
      return "PLC (powerline)";
    case "4":
      return "Ethernet";
  }
  // Already a label form
  if (/^pl[cl]$/i.test(raw)) return "PLC (powerline)";
  if (/^wi-?fi$/i.test(raw)) return "Wi-Fi";
  if (/^lte|cellular|4g$/i.test(raw)) return "Cellular (LTE)";
  if (/^ethernet|wired$/i.test(raw)) return "Ethernet";
  return raw;
}

// ── Cloud connection status (StateId 810) ──────────────────────────────────
export function cloudConnectionStatusLabel(raw: string | undefined): string {
  switch (raw) {
    case "0":
      return "Disconnected";
    case "1":
      return "Connecting";
    case "2":
      return "Connected";
    case "3":
      return "Reconnecting";
    default:
      return raw ?? "—";
  }
}

// ── Installation type (Pro vs Smart) ───────────────────────────────────────
export function installationTypeLabel(raw: number | undefined): string {
  switch (raw) {
    case 0:
      return "Pro";
    case 1:
      return "Smart";
    default:
      return raw != null ? `Type ${raw}` : "—";
  }
}

export function installationCategoryLabel(raw: string | undefined): string {
  switch (raw) {
    case "Community_Installation_Category":
      return "Community";
    case "Company_Installation_Category":
      return "Company";
    case "Private_Installation_Category":
      return "Private";
    case "Public_Installation_Category":
      return "Public";
    default:
      return raw ?? "—";
  }
}

// ── Authentication type (charger.AuthenticationType + installation) ────────
export function authenticationTypeLabel(raw: number | undefined): string {
  switch (raw) {
    case 0:
      return "Native (Zaptec)";
    case 1:
      return "Webhooks";
    case 2:
      return "OCPP (cloud-routed)";
    case 3:
      return "OCPP Native (direct)";
    default:
      return raw != null ? `Type ${raw}` : "—";
  }
}

// ── Cable type (StateId 714) ───────────────────────────────────────────────
export function cableTypeLabel(raw: string | undefined): string {
  if (raw == null || raw === "") return "—";
  // cable type returns the rated current from the proximity resistor
  return `${raw} A cable`;
}

// ── Format uptime (StateId 820/821) ────────────────────────────────────────
// Live data shows Zaptec returns uptime in HOURS as a decimal (e.g. 95.0512
// = ~95 h 3 min). Earlier I assumed milliseconds — that was wrong.
export function fmtUptimeHours(raw: string | undefined): string {
  if (!raw) return "—";
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours === 0) return "—";
  if (hours < 1) {
    const min = Math.round(hours * 60);
    return `${min} min`;
  }
  const d = Math.floor(hours / 24);
  const h = Math.floor(hours % 24);
  if (d > 0) return `${d}d ${h}h`;
  const m = Math.floor((hours - Math.floor(hours)) * 60);
  return `${Math.floor(hours)}h ${m}m`;
}

// Old name retained as alias for backwards compatibility
export const fmtUptimeMs = fmtUptimeHours;
