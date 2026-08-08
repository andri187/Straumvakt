// HARVESTED to @straumvakt/contracts (2026-08-08).
//
// This file is a re-export shim so the DTO vocabulary has ONE home
// without breaking the 127 files that import it from here. New callers
// should import "@straumvakt/contracts/domain/circuits" directly; old ones move
// under touch-it-convert-it (FOCUS.md rule 1).
//
// Nothing was deleted. When the last caller points at contracts, this file
// goes — and not before.
export * from "@straumvakt/contracts/domain/circuits";
export type * from "@straumvakt/contracts/domain/circuits";
