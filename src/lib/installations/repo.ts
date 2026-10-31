// Wires the handlers' Repo to Drizzle. One client per call, always closed.

import { DatabaseUnavailableError, type ApiDeps, type Repo } from "./api";
import { readDatabaseUrl, openDb, type Db, type ShellDbEnv } from "./db";
import { readContextOrgId } from "./context";
import {
  allocateRoutingId,
  createCpoOrganisation,
  createSite,
  drizzleStore,
  listInstallations,
  loadDirectory,
  loadHistory,
  loadRoutingId,
  loadSnapshot,
} from "./drizzle-store";
import { bootCaptureFor, incomingChargers, signalAttached } from "./discovery";
import type { PendingGateway } from "./pending-gateway";
import { discardDraft, getDraft, listDrafts, saveDraft } from "./drafts";
import { saveInstallation } from "./service";
import { notifyCommitted, type HubClient } from "@/lib/sync/hub";

export function repoFor(db: Db, hub: HubClient | null = null, gateway: PendingGateway | null = null): Repo {
  const store = drizzleStore(db);
  return {
    async save(input, actor) {
      const result = await saveInstallation(store, input, actor);
      // After the commit, never inside it. A replay or an unchanged save wrote nothing, so nothing to announce.
      // A failed notification is recovered by the hub's age bound; it never fails the save.
      if (!result.replayed && !result.unchanged) await notifyCommitted(hub, result.snapshot.installation.id, { rev: result.snapshot.installation.revision });
      // Same rule for a charger that was waiting: only after the commit, and a failed signal never fails the save.
      // The intent was committed WITH the attach (service.ts); this is the first delivery attempt, recorded either way.
      if (gateway && result.attachedChargePointIds?.length) await signalAttached(store, gateway, result.snapshot.installation.orgId, result.attachedChargePointIds);
      return result;
    },
    async get(id) {
      const snapshot = await loadSnapshot(db, id);
      if (!snapshot) return null;
      const [routingId, history] = await Promise.all([loadRoutingId(db, snapshot.installation.orgId), loadHistory(db, id)]);
      return { snapshot, routingId, history };
    },
    list: (limit, offset) => listInstallations(db, { limit, offset }),
    directory: () => loadDirectory(db),
    async contextDirectory(orgId) {
      const all = await loadDirectory(db);
      const org = all.organisations.find((o) => o.id === orgId);
      if (!org) return null;
      // The CPO's stable routing id is the existing once-only allocation, done before the form is shown rather than at first save.
      const routingId = org.routingId ?? (await allocateRoutingId(db, org.id, org.displayName));
      return { organisations: [{ ...org, routingId }], sites: all.sites.filter((s) => s.orgId === orgId) };
    },
    listIncoming: (orgId, actor) => incomingChargers(store, orgId, actor, undefined, undefined, gateway, gateway),
    getBootCapture: (orgId, actor, chargePointId) => bootCaptureFor(store, orgId, actor, chargePointId),
    createOrganisation: (displayName) => createCpoOrganisation(db, { displayName }),
    createSite: (input) => createSite(db, input),
    saveDraft: (input, actor) => saveDraft(store, input, actor),
    discardDraft: (input, actor) => discardDraft(store, input, actor),
    getDraft: (draftId, actor) => getDraft(store, draftId, actor),
    listDrafts: (actor) => listDrafts(store, actor),
  };
}

export function liveDeps(env: ShellDbEnv = process.env, hub: HubClient | null = null, gateway: PendingGateway | null = null): ApiDeps {
  return {
    env,
    contextOrgId: readContextOrgId(env),
    async withRepo(fn) {
      const url = readDatabaseUrl(env);
      if (!url) throw new DatabaseUnavailableError();
      const { db, close } = openDb(url);
      try {
        return await fn(repoFor(db, hub, gateway));
      } finally {
        await close();
      }
    },
  };
}
