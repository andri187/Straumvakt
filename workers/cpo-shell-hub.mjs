// Durable Object: the cross-instance version hub (src/lib/sync/hub.ts).
//
// Holds only non-secret counters and installation ids. Thin wrapper: every
// decision lives in VersionHubCore, which is what the unit tests exercise.
// Binding name VERSION_HUB; creating the binding and its migration is a
// deployment step and is NOT part of this source change.
import { DurableObject } from 'cloudflare:workers';
import { VersionHubCore } from '../src/lib/sync/hub.ts';

export class VersionHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.core = new VersionHubCore(ctx.storage);
  }
  read() { return this.core.read(); }
  prime(ids, versions) { return this.core.prime(ids, versions); }
  bump(installationId, patch) { return this.core.bump(installationId, patch); }
  invalidate() { return this.core.invalidate(); }
}
