export type ProductSurface = "staff" | "cpo" | "driver";
export type ContractState = "ready" | "read_only" | "blocked" | "unsafe";

export type ProductWorkflow = {
  id: string;
  surface: ProductSurface;
  label: string;
  state: ContractState;
  dependency: string;
};

export const PRODUCT_WORKFLOWS: readonly ProductWorkflow[] = [
  {
    id: "staff-application-queue",
    surface: "staff",
    label: "Organisation application queue",
    state: "ready",
    dependency: "Existing host-application reads",
  },
  {
    id: "staff-onboarding-aggregate",
    surface: "staff",
    label: "Singular onboarding workflow",
    state: "blocked",
    dependency: "Onboarding aggregate and step commands",
  },
  {
    id: "staff-support-context",
    surface: "staff",
    label: "Organisation support context",
    state: "read_only",
    dependency: "Persisted scope, expiry and audit command",
  },
  {
    id: "cpo-charger-inventory",
    surface: "cpo",
    label: "Charger and installation inventory",
    state: "ready",
    dependency: "Existing tenant-scoped reads",
  },
  {
    id: "cpo-charger-create",
    surface: "cpo",
    label: "Add a charger to an existing site",
    state: "ready",
    dependency: "Existing charger create route",
  },
  {
    id: "cpo-access-review",
    surface: "cpo",
    label: "Review driver access requests",
    state: "ready",
    dependency: "Existing list, approve and deny routes",
  },
  {
    id: "cpo-driver-visibility",
    surface: "cpo",
    label: "Driver visibility policy",
    state: "blocked",
    dependency: "Explicit visibility contract",
  },
  {
    id: "cpo-cost-assignment",
    surface: "cpo",
    label: "Driver cost assignment",
    state: "read_only",
    dependency: "Narrow assignment command and effective-date rules",
  },
  {
    id: "driver-guest",
    surface: "driver",
    label: "Guest and unaffiliated states",
    state: "ready",
    dependency: "Local state and existing sign-in",
  },
  {
    id: "driver-installation-code",
    surface: "driver",
    label: "Installation code and passphrase",
    state: "blocked",
    dependency: "Join command, credential persistence and rate limiting",
  },
  {
    id: "driver-invite",
    surface: "driver",
    label: "Organisation invite bootstrap",
    state: "unsafe",
    dependency: "No password overwrite and identity binding",
  },
  {
    id: "driver-sessions",
    surface: "driver",
    label: "Concurrent and completed sessions",
    state: "ready",
    dependency: "Existing session endpoints",
  },
] as const;

export function readinessCounts(workflows = PRODUCT_WORKFLOWS) {
  return workflows.reduce(
    (counts, workflow) => {
      counts[workflow.state] += 1;
      return counts;
    },
    { ready: 0, read_only: 0, blocked: 0, unsafe: 0 },
  );
}

export function workflowsFor(surface: ProductSurface) {
  return PRODUCT_WORKFLOWS.filter((workflow) => workflow.surface === surface);
}
