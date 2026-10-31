// Client-side bookkeeping for the "add installation" form: which server draft the
// form is attached to, which revision it last saw, and what to do with each
// answer. Pure and dependency-free (the editor is a client component), so the
// rules that keep overlapping actions and late answers from doing damage are
// tested directly rather than only by reading the React handlers.
//
// The server is the authority (idempotency key, draft id, revision, single use);
// this module only makes the browser not fight it.

/** The draft the form belongs to. `revision` is undefined until the server has confirmed the draft exists. */
export type DraftSession = { id: string; revision: number | undefined };

export function startSession(existing?: { id: string; revision: number }, newId: () => string = () => crypto.randomUUID()): DraftSession {
  return existing ? { id: existing.id, revision: existing.revision } : { id: newId(), revision: undefined };
}

/**
 * One action at a time. A second request while one is in flight is ignored (not queued), and the slot is freed
 * however the first one ends, including by throwing. The form is read-only while it is held, so nothing is edited
 * under a request and no answer can arrive over text typed after it was sent.
 */
export function createSingleFlight<K extends string>(onChange?: (current: K | null) => void) {
  let current: K | null = null;
  return {
    get current(): K | null {
      return current;
    },
    async run<T>(kind: K, fn: () => Promise<T>): Promise<{ ran: false } | { ran: true; value: T }> {
      if (current !== null) return { ran: false };
      current = kind;
      onChange?.(kind);
      try {
        return { ran: true, value: await fn() };
      } finally {
        current = null;
        onChange?.(null);
      }
    },
  };
}

export type ServerAnswer = { ok: boolean; status: number; json: Record<string, unknown> };

export type SaveDraftOutcome =
  | { kind: "saved"; session: DraftSession; unchanged: boolean }
  /** Newer text exists on the server (another tab, or an earlier request answered late). Nothing was overwritten. */
  | { kind: "stale"; session: DraftSession }
  /** The draft was discarded elsewhere. Nothing was made from it; the next save starts a new draft. */
  | { kind: "gone"; session: DraftSession }
  /** The draft was already used: an installation exists. The session is kept, so nothing quietly starts over beside it. */
  | { kind: "consumed"; session: DraftSession; installationId: string | null }
  | { kind: "invalid"; session: DraftSession; problems: { path: string; message: string }[] }
  | { kind: "failed"; session: DraftSession };

export function saveDraftBody(session: DraftSession, orgId: string, payload: unknown): Record<string, unknown> {
  return {
    action: "save-draft",
    draftId: session.id,
    orgId: orgId || null,
    ...(session.revision !== undefined ? { expectedRevision: session.revision } : {}),
    payload,
  };
}

export function afterSaveDraft(session: DraftSession, answer: ServerAnswer, newId: () => string = () => crypto.randomUUID()): SaveDraftOutcome {
  if (answer.ok) {
    const draft = answer.json.draft as { revision?: unknown } | undefined;
    const revision = typeof draft?.revision === "number" ? draft.revision : session.revision;
    return { kind: "saved", session: { id: session.id, revision }, unchanged: answer.json.unchanged === true };
  }
  if (answer.status === 409 && answer.json.error === "stale_revision") return { kind: "stale", session };
  // Only a draft the server says was discarded is replaced. A 409 that does not say why (the draft limit, a race) changes nothing.
  if (answer.status === 409 && answer.json.error === "draft_unavailable") {
    if (answer.json.draftState === "consumed") return { kind: "consumed", session, installationId: installationIdOf(answer) };
    if (answer.json.draftState === "discarded") return { kind: "gone", session: detach(newId) };
  }
  if (answer.status === 422) return { kind: "invalid", session, problems: (answer.json.problems as { path: string; message: string }[] | undefined) ?? [] };
  return { kind: "failed", session };
}

function installationIdOf(answer: ServerAnswer): string | null {
  return typeof answer.json.installationId === "string" ? answer.json.installationId : null;
}

/** The form stops belonging to any server draft. It does not create or discard anything. */
export function detach(newId: () => string = () => crypto.randomUUID()): DraftSession {
  return { id: newId(), revision: undefined };
}

/** The create names the draft only when the server has confirmed one, so it can never cite a draft that does not exist. */
export function createDraftRef(session: DraftSession): { draftId?: string } {
  return session.revision !== undefined ? { draftId: session.id } : {};
}

export type CreateOutcome =
  /** The server closed the draft in the same transaction as the installation. */
  | { kind: "created"; session: DraftSession }
  /** The draft was discarded. This attempt created nothing, and the form is detached from it. */
  | { kind: "draft_gone"; session: DraftSession }
  /**
   * The draft was already used, so an installation may exist already (this form's own earlier create whose answer was
   * lost, or another tab). The session is KEPT and no new draft id is offered; the editor shows that installation and
   * requires a deliberate step before anything else is created.
   */
  | { kind: "draft_consumed"; session: DraftSession; installationId: string | null }
  | { kind: "other"; session: DraftSession };

export function afterCreate(session: DraftSession, answer: ServerAnswer, newId: () => string = () => crypto.randomUUID()): CreateOutcome {
  if (answer.ok) return { kind: "created", session: { id: session.id, revision: undefined } };
  if (answer.status === 409 && answer.json.error === "draft_unavailable") {
    if (answer.json.draftState === "consumed") return { kind: "draft_consumed", session, installationId: installationIdOf(answer) };
    if (answer.json.draftState === "discarded") return { kind: "draft_gone", session: detach(newId) };
  }
  return { kind: "other", session };
}

export type DiscardOutcome =
  | { kind: "gone"; session: DraftSession }
  | { kind: "already_used"; session: DraftSession }
  | { kind: "failed"; session: DraftSession };

/** Discarding a draft that is already unknown (404) or discarded is a success: the goal, "no open draft", holds. */
export function afterDiscard(session: DraftSession, answer: ServerAnswer): DiscardOutcome {
  if (answer.ok && answer.json.outcome === "already_used") return { kind: "already_used", session };
  if (answer.ok || answer.status === 404) return { kind: "gone", session: { id: session.id, revision: undefined } };
  return { kind: "failed", session };
}
