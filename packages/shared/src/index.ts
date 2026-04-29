// Single source of truth for the contract between apps/web (UI) and apps/api
// (Workers). Zod schemas live under `inputs/`, runtime-free TypeScript
// interfaces under `domain/`. Both apps depend on this package; neither
// duplicates the shapes.

export * as OrgInputs from "./inputs/orgs";
export type * from "./domain/orgs";
