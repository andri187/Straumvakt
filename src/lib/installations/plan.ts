// Pure validation and diffing for a whole-state installation save.
//
// `planSave(current, input)` returns either field problems or an ordered list
// of operations plus the before/after diff of each. Nothing here touches a
// store, so every rule is testable without a database. The repository applies
// the operations in order inside one transaction.

import {
  MAX_CHARGERS,
  MAX_CIRCUITS,
  MAX_TREE_DEPTH,
  NEW_ID_PREFIX,
  type Amps,
  type ChargerState,
  type CircuitState,
  type FieldProblem,
  type InstallationState,
  type SaveInstallationInput,
  type Snapshot,
} from "./model";

export type Diff = Record<string, { from: unknown; to: unknown }>;

export type CircuitOp =
  | { kind: "create"; clientId: string; parentRef: string | null; displayName: string; ratingAmps: Amps; phaseCount: 1 | 2 | 3 | null; sortOrder: number; depth: number }
  | { kind: "update"; id: string; diff: Diff; patch: Partial<Pick<CircuitState, "displayName" | "ratingAmps" | "phaseCount" | "parentId" | "sortOrder">>; before: CircuitState }
  | { kind: "archive"; id: string; before: CircuitState; depth: number };

export type ChargerOp =
  | { kind: "create"; clientId: string; circuitRef: string; label: string; chargePointId: string; vendor: string | null; model: string | null; serialNumber: string | null }
  | { kind: "update"; id: string; diff: Diff; patch: Partial<Pick<ChargerState, "label" | "chargePointId" | "vendor" | "model" | "serialNumber">>; before: ChargerState }
  | { kind: "move"; id: string; placementId: string; fromCircuitId: string; circuitRef: string; before: ChargerState }
  | { kind: "detach"; id: string; placementId: string; before: ChargerState };

export type Plan = {
  installationDiff: Diff;
  electricianChanged: boolean;
  circuits: CircuitOp[];
  chargers: ChargerOp[];
  /** True when nothing (apart from a requested password action) differs from the stored state. */
  isEmpty: boolean;
};

const ci = (s: string | null) => (s ?? "").trim().toLowerCase();

function pushDiff(diff: Diff, field: string, from: unknown, to: unknown) {
  if (from !== to) diff[field] = { from, to };
}

/** Validation that needs no stored state: structure of the submitted tree and charger list. */
export function validateShape(input: SaveInstallationInput): FieldProblem[] {
  const problems: FieldProblem[] = [];
  const circuitIds = new Set<string>();

  if (input.circuits.length > MAX_CIRCUITS) problems.push({ path: "circuits", message: `At most ${MAX_CIRCUITS} circuits` });
  if (input.chargers.length > MAX_CHARGERS) problems.push({ path: "chargers", message: `At most ${MAX_CHARGERS} chargers` });

  input.circuits.forEach((c, i) => {
    if (circuitIds.has(c.id)) problems.push({ path: `circuits.${i}.id`, message: "Duplicate circuit id" });
    circuitIds.add(c.id);
  });

  const byId = new Map(input.circuits.map((c) => [c.id, c]));
  input.circuits.forEach((c, i) => {
    if (c.parentId === c.id) problems.push({ path: `circuits.${i}.parentId`, message: "A circuit cannot be its own parent" });
    else if (c.parentId !== null && !byId.has(c.parentId)) problems.push({ path: `circuits.${i}.parentId`, message: "Parent circuit not found in this installation" });
  });

  // Cycles and depth: walk up from every node with a visited set.
  input.circuits.forEach((c, i) => {
    const seen = new Set<string>([c.id]);
    let depth = 1;
    let cur = c.parentId;
    while (cur !== null) {
      if (seen.has(cur)) {
        problems.push({ path: `circuits.${i}.parentId`, message: "Circuits cannot form a loop" });
        return;
      }
      seen.add(cur);
      const next = byId.get(cur);
      if (!next) return; // reported above
      depth += 1;
      cur = next.parentId;
    }
    if (depth > MAX_TREE_DEPTH) problems.push({ path: `circuits.${i}.parentId`, message: `Nesting is limited to ${MAX_TREE_DEPTH} levels` });
  });

  const chargerIds = new Set<string>();
  const cpIds = new Set<string>();
  input.chargers.forEach((ch, i) => {
    if (chargerIds.has(ch.id)) problems.push({ path: `chargers.${i}.id`, message: "Duplicate charger id" });
    chargerIds.add(ch.id);
    if (!byId.has(ch.circuitId)) problems.push({ path: `chargers.${i}.circuitId`, message: "A charger must sit on a circuit of this installation" });
    const cp = ch.chargePointId.toLowerCase();
    if (cpIds.has(cp)) problems.push({ path: `chargers.${i}.chargePointId`, message: "Charge point id is used twice in this installation" });
    cpIds.add(cp);
  });

  const serials = new Map<string, number>();
  input.chargers.forEach((ch, i) => {
    if (!ch.serialNumber) return;
    const key = ci(ch.serialNumber);
    if (serials.has(key)) problems.push({ path: `chargers.${i}.serialNumber`, message: "Serial number is used twice in this installation" });
    serials.set(key, i);
  });

  return problems;
}

function circuitDepth(id: string, byId: Map<string, { parentId: string | null }>): number {
  let d = 1;
  let cur = byId.get(id)?.parentId ?? null;
  while (cur !== null && d <= MAX_TREE_DEPTH + 1) {
    d += 1;
    cur = byId.get(cur)?.parentId ?? null;
  }
  return d;
}

export type PlanResult = { ok: true; plan: Plan } | { ok: false; problems: FieldProblem[] };

/**
 * Compares the submitted state with the stored one. `current` is null on create.
 * Identifiers the client sends that are neither stored nor `new-…` are rejected
 * generically: whether such an id exists elsewhere is not disclosed.
 */
export function planSave(current: Snapshot | null, input: SaveInstallationInput): PlanResult {
  const problems = validateShape(input);
  const curCircuits = new Map((current?.circuits ?? []).map((c) => [c.id, c]));
  const curChargers = new Map((current?.chargers ?? []).map((c) => [c.id, c]));

  input.circuits.forEach((c, i) => {
    if (!curCircuits.has(c.id) && !c.id.startsWith(NEW_ID_PREFIX)) problems.push({ path: `circuits.${i}.id`, message: "Unknown circuit — reload and try again" });
  });
  input.chargers.forEach((c, i) => {
    if (!curChargers.has(c.id) && !c.id.startsWith(NEW_ID_PREFIX)) problems.push({ path: `chargers.${i}.id`, message: "Unknown charger — reload and try again" });
  });
  if (problems.length > 0) return { ok: false, problems };

  const installationDiff: Diff = {};
  const inst: InstallationState | undefined = current?.installation;
  pushDiff(installationDiff, "displayName", inst?.displayName ?? null, input.installation.displayName);
  pushDiff(installationDiff, "mainDeviceType", inst?.mainDeviceType ?? null, input.installation.mainDeviceType);
  pushDiff(installationDiff, "mainRatingAmps", inst?.mainRatingAmps ?? null, input.installation.mainRatingAmps);
  pushDiff(installationDiff, "mainPhaseCount", inst?.mainPhaseCount ?? null, input.installation.mainPhaseCount);
  pushDiff(installationDiff, "mainGridType", inst?.mainGridType ?? null, input.installation.mainGridType);

  const e = input.electrician;
  const before = inst?.electrician ?? { name: null, email: null, phone: null };
  const electricianDiff: Diff = {};
  pushDiff(electricianDiff, "electricianName", before.name, e.name);
  pushDiff(electricianDiff, "electricianEmail", before.email, e.email);
  pushDiff(electricianDiff, "electricianPhone", before.phone, e.phone);
  Object.assign(installationDiff, electricianDiff);
  const electricianChanged = Object.keys(electricianDiff).length > 0;

  // ── Circuits ──────────────────────────────────────────────────────────
  const submittedById = new Map(input.circuits.map((c) => [c.id, c]));
  const depthIndex = new Map(input.circuits.map((c) => [c.id, { parentId: c.parentId }]));
  const circuitOps: CircuitOp[] = [];

  input.circuits.forEach((c, index) => {
    const stored = curCircuits.get(c.id);
    if (!stored) {
      circuitOps.push({
        kind: "create",
        clientId: c.id,
        parentRef: c.parentId,
        displayName: c.displayName,
        ratingAmps: c.ratingAmps,
        phaseCount: c.phaseCount,
        sortOrder: index,
        depth: circuitDepth(c.id, depthIndex),
      });
      return;
    }
    const diff: Diff = {};
    const patch: Extract<CircuitOp, { kind: "update" }>["patch"] = {};
    if (stored.displayName !== c.displayName) { diff.displayName = { from: stored.displayName, to: c.displayName }; patch.displayName = c.displayName; }
    if (stored.ratingAmps !== c.ratingAmps) { diff.ratingAmps = { from: stored.ratingAmps, to: c.ratingAmps }; patch.ratingAmps = c.ratingAmps; }
    if (stored.phaseCount !== c.phaseCount) { diff.phaseCount = { from: stored.phaseCount, to: c.phaseCount }; patch.phaseCount = c.phaseCount; }
    if (stored.parentId !== c.parentId) { diff.parentId = { from: stored.parentId, to: c.parentId }; patch.parentId = c.parentId; }
    if (stored.sortOrder !== index) patch.sortOrder = index; // ordering only; not worth a history row
    if (Object.keys(patch).length > 0) circuitOps.push({ kind: "update", id: c.id, diff, patch, before: stored });
  });

  const storedDepth = new Map([...curCircuits.values()].map((c) => [c.id, { parentId: c.parentId }]));
  for (const stored of curCircuits.values()) {
    if (!submittedById.has(stored.id)) {
      circuitOps.push({ kind: "archive", id: stored.id, before: stored, depth: circuitDepth(stored.id, storedDepth) });
    }
  }
  // Parents before children when creating; children before parents when archiving.
  const creates = circuitOps.filter((o): o is Extract<CircuitOp, { kind: "create" }> => o.kind === "create").sort((a, b) => a.depth - b.depth);
  const updates = circuitOps.filter((o) => o.kind === "update");
  const archives = circuitOps.filter((o): o is Extract<CircuitOp, { kind: "archive" }> => o.kind === "archive").sort((a, b) => b.depth - a.depth);

  // ── Chargers ──────────────────────────────────────────────────────────
  const chargerOps: ChargerOp[] = [];
  const submittedChargers = new Set(input.chargers.map((c) => c.id));
  for (const ch of input.chargers) {
    const stored = curChargers.get(ch.id);
    if (!stored) {
      chargerOps.push({
        kind: "create",
        clientId: ch.id,
        circuitRef: ch.circuitId,
        label: ch.label,
        chargePointId: ch.chargePointId,
        vendor: ch.vendor,
        model: ch.model,
        serialNumber: ch.serialNumber,
      });
      continue;
    }
    const diff: Diff = {};
    const patch: Extract<ChargerOp, { kind: "update" }>["patch"] = {};
    if (stored.label !== ch.label) { diff.label = { from: stored.label, to: ch.label }; patch.label = ch.label; }
    if (stored.chargePointId !== ch.chargePointId) { diff.chargePointId = { from: stored.chargePointId, to: ch.chargePointId }; patch.chargePointId = ch.chargePointId; }
    if (stored.vendor !== ch.vendor) { diff.vendor = { from: stored.vendor, to: ch.vendor }; patch.vendor = ch.vendor; }
    if (stored.model !== ch.model) { diff.model = { from: stored.model, to: ch.model }; patch.model = ch.model; }
    if (stored.serialNumber !== ch.serialNumber) { diff.serialNumber = { from: stored.serialNumber, to: ch.serialNumber }; patch.serialNumber = ch.serialNumber; }
    if (Object.keys(patch).length > 0) chargerOps.push({ kind: "update", id: ch.id, diff, patch, before: stored });
    if (stored.circuitId !== ch.circuitId) {
      chargerOps.push({ kind: "move", id: ch.id, placementId: stored.placementId, fromCircuitId: stored.circuitId, circuitRef: ch.circuitId, before: stored });
    }
  }
  for (const stored of curChargers.values()) {
    if (!submittedChargers.has(stored.id)) chargerOps.push({ kind: "detach", id: stored.id, placementId: stored.placementId, before: stored });
  }
  // Detach and move before create so a freed charge-point id or serial can be reused in the same save.
  const order = { detach: 0, move: 1, update: 2, create: 3 } as const;
  chargerOps.sort((a, b) => order[a.kind] - order[b.kind]);

  const circuits = [...creates, ...updates, ...archives];
  // Re-ordering alone (a sort-only circuit update) is not a change worth a revision.
  const meaningfulCircuits = circuits.filter((o) => o.kind !== "update" || Object.keys(o.diff).length > 0);
  const isEmpty =
    current !== null &&
    Object.keys(installationDiff).length === 0 &&
    meaningfulCircuits.length === 0 &&
    chargerOps.length === 0;

  return { ok: true, plan: { installationDiff, electricianChanged, circuits, chargers: chargerOps, isEmpty } };
}
