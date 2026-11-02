// The one browser-side StructuralStore for this document. Created lazily in the browser only: on the server (rendering) every
// call gets a fresh, empty, never-fetching store, so a server process can never hold one user's data for another.

import { StructuralStore } from "./structural-store";

let browserStore: StructuralStore | null = null;

export function structuralStore(): StructuralStore {
  if (typeof window === "undefined") return new StructuralStore({ fetch: () => Promise.reject(new Error("structural store is browser-only")) });
  browserStore ??= new StructuralStore({ fetch: (...args) => fetch(...args) });
  return browserStore;
}
