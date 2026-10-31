// Installation drafts: an unfinished "add installation" form, saved so it can be
// resumed. A draft is a copy of what the operator typed and nothing else. It
// creates no installation, device, identity or placement, so nothing can connect
// through it, and it has no say in the connection address (that is the CPO's
// host plus each charger's own charge point id).
//
// Required-field validation happens when the installation is created, not here:
// a draft may be as incomplete as the form is. The payload has no password field
// and the shape is strict, so a plaintext password is refused, never stored.
//
// Discarding closes the draft and nothing else: organisations, sites,
// installations, chargers, sessions and CDRs are separate records. A closed draft
// stays as a tombstone and is never reopened.

import { mayAdminister, type Actor } from "./actor";
import { DraftPayload } from "./model";
import { SaveError, type Draft, type DraftRow, type Store, type TxPort } from "./store";

/** Open drafts allowed at once; stops abandoned tabs from accumulating rows without bound. */
export const MAX_OPEN_DRAFTS = 25;
/** The stored document, serialised. Far above any real form, far below a request limit. */
export const MAX_DRAFT_BYTES = 128 * 1024;

export const UNKNOWN_DRAFT = "Draft not found";

export function closedMessage(state: "open" | "consumed" | "discarded"): string {
  return state === "consumed"
    ? "This draft was already used to create an installation."
    : "This draft was discarded. Start a new installation.";
}

/**
 * Why a draft cannot take this request, in a form the editor can act on. A USED draft names the installation it made
 * (when this actor may see it) so a second tab opens that installation instead of offering to create another.
 * A discarded draft created nothing. Callers hold the draft's row lock.
 */
export async function closedDraftError(tx: Pick<TxPort, "loadSnapshot">, actor: Actor, draft: Pick<DraftRow, "state" | "installationId">): Promise<SaveError> {
  if (draft.state === "consumed") {
    const snapshot = draft.installationId ? await tx.loadSnapshot(draft.installationId) : null;
    const installationId = snapshot && mayAdminister(actor, snapshot.installation.orgId) ? snapshot.installation.id : null;
    return new SaveError("draft_unavailable", closedMessage("consumed"), { state: "consumed", installationId });
  }
  return new SaveError("draft_unavailable", closedMessage(draft.state), { state: draft.state });
}

/** A draft with no organisation yet is the platform operator's; with one, the organisation's administrators'. */
export function mayUseDraft(actor: Actor, orgId: string | null): boolean {
  return orgId === null ? actor.kind === "shared_login" && actor.platformOperator === true : mayAdminister(actor, orgId);
}

/** Order-independent comparison: jsonb does not keep key order, so stored and submitted documents are compared by content. */
export function sameDocument(a: unknown, b: unknown): boolean {
  const canon = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([k, x]) => [k, canon(x)])) : v;
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}

export type SaveDraftInput = {
  draftId: string;
  orgId: string | null;
  /** The revision the editor last saw. Required to change an existing draft; absent when creating. */
  expectedRevision?: number;
  payload: unknown;
};

/**
 * Creates or updates a draft. Repeating the same call (double click, retry after a
 * lost response) changes nothing and returns the stored draft; a call built on an
 * older revision is refused with the current revision instead of overwriting.
 */
export async function saveDraft(
  store: Store,
  input: SaveDraftInput,
  actor: Actor,
): Promise<{ draft: Draft; created: boolean; unchanged: boolean }> {
  const parsed = DraftPayload.safeParse(input.payload);
  if (!parsed.success) {
    throw new SaveError("validation", "The draft could not be saved", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  const payload = parsed.data as Record<string, unknown>;
  if (JSON.stringify(payload).length > MAX_DRAFT_BYTES) throw new SaveError("validation", "The draft is too large to save", [{ path: "payload", message: "Too large" }]);

  return store.transaction(async (tx) => {
    if (!mayUseDraft(actor, input.orgId)) throw new SaveError("forbidden", "Not permitted");
    if (input.orgId !== null && !(await tx.loadCpoOrganisation(input.orgId))) throw new SaveError("not_found", "Organisation not found");

    const existing = await tx.lockDraft(input.draftId);
    if (!existing) {
      if (input.expectedRevision !== undefined) throw new SaveError("not_found", UNKNOWN_DRAFT);
      if ((await tx.countOpenDrafts()) >= MAX_OPEN_DRAFTS) {
        throw new SaveError("draft_unavailable", `There are already ${MAX_OPEN_DRAFTS} unfinished drafts. Resume or discard some first.`, { state: "limit" });
      }
      await tx.insertDraft({ id: input.draftId, orgId: input.orgId, payload, actorKind: actor.kind, actorLabel: actor.label });
      const draft = await tx.loadDraft(input.draftId);
      if (!draft) throw new SaveError("unavailable", "Saved draft could not be read back");
      return { draft, created: true, unchanged: false };
    }

    // Unknown and not-permitted answer identically so existence is not disclosed.
    if (!mayUseDraft(actor, existing.orgId)) throw new SaveError("not_found", UNKNOWN_DRAFT);
    if (existing.state !== "open") throw await closedDraftError(tx, actor, existing);

    const same = existing.orgId === input.orgId && sameDocument(existing.payload, payload);
    if (!same) {
      if (input.expectedRevision !== existing.revision) {
        throw new SaveError("stale_revision", "This draft was changed elsewhere since you opened it", { currentRevision: existing.revision });
      }
      await tx.updateDraft(existing.id, { orgId: input.orgId, payload });
    }
    const draft = await tx.loadDraft(existing.id);
    if (!draft) throw new SaveError("unavailable", "Saved draft could not be read back");
    return { draft, created: false, unchanged: same };
  });
}

export type DiscardOutcome =
  | { outcome: "discarded" }
  | { outcome: "already_discarded" }
  /** The installation was created first: nothing is discarded and the installation is untouched. */
  | { outcome: "already_used"; installationId: string };

/** Discards an unfinished draft. Idempotent; never touches anything but the draft. */
export async function discardDraft(store: Store, input: { draftId: string }, actor: Actor): Promise<DiscardOutcome> {
  return store.transaction(async (tx) => {
    const row = await tx.lockDraft(input.draftId);
    if (!row || !mayUseDraft(actor, row.orgId)) throw new SaveError("not_found", UNKNOWN_DRAFT);
    if (row.state === "consumed") return { outcome: "already_used", installationId: row.installationId as string };
    if (row.state === "discarded") return { outcome: "already_discarded" };
    await tx.closeDraft(row.id, "discarded", null);
    return { outcome: "discarded" };
  });
}

/** One draft for resuming, or null when it does not exist or the actor may not see it. */
export async function getDraft(store: Store, draftId: string, actor: Actor): Promise<Draft | null> {
  return store.transaction(async (tx) => {
    const draft = await tx.loadDraft(draftId);
    return draft && mayUseDraft(actor, draft.orgId) ? draft : null;
  });
}

/** Open (unfinished) drafts, most recently changed first. */
export async function listDrafts(store: Store, actor: Actor, limit = MAX_OPEN_DRAFTS): Promise<Draft[]> {
  return store.transaction(async (tx) => (await tx.listOpenDrafts(limit)).filter((d) => mayUseDraft(actor, d.orgId)));
}
