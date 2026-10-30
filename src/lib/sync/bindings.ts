// Reads Cloudflare bindings (not just string variables) inside a Next route.
// Outside the Workers runtime (tests, `next dev` without a platform proxy) there
// is no context: the result is simply "no bindings", never an error, so the
// handlers degrade to plain database reads.

import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { SyncBindings } from "./live";

export function workerBindings(): SyncBindings {
  try {
    return (getCloudflareContext().env ?? {}) as SyncBindings;
  } catch {
    return {};
  }
}
