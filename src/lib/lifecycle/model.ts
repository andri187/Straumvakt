// Charger lifecycle: types and the authoritative transition table.
//
// Three operations are kept DISTINCT (retirement policy, 2026-10-26):
//   remove   end this device's placement at an installation (it may return)
//   retire   end service permanently-until-reactivated (needs its own permission + reason)
//   return   put a known, detached device back (explicit; nothing is inherited)
// "Delete a charger" in the editor is `remove`. Both `remove` and `retire` share the
// same guarded sequence when a session is active, because the sequence is about the
// SESSION, not the label.
//
// Nothing here is "done" because a request was saved. A request completes only when
// the conditions in COMPLETION are observed from durable evidence, never from an
// accepted command.

export type LifecycleKind = "remove" | "retire";

export type LifecycleState =
  | "requested" //     recorded; new starts are blocked
  | "stopping" //      at least one open session still has no confirmed StopTransaction
  | "closing" //       all sessions confirmed stopped; placement/identity close is due
  | "settling" //      placement closed; at least one session's settlement is still pending
  | "completed" //     closed AND every session is settled or visibly held
  | "needs_attention" // a bounded step ran out of attempts; an operator must act; nothing is hidden
  | "cancelled"; //    undone before any stop command was accepted

export const OPEN_STATES: readonly LifecycleState[] = ["requested", "stopping", "closing", "settling", "needs_attention"];

export type StopOutcome = "accepted" | "rejected" | "offline" | "timeout" | "unavailable";

export type SessionStep = {
  transactionNo: number;
  transactionId: string;
  /** Number of stop commands attempted and the last outcome. An ACCEPTED command is not a stopped session. */
  stop: { attempts: number; lastOutcome: StopOutcome | null; lastAt: string | null; everAccepted: boolean };
  /** Confirmed only by a durable StopTransaction (ocpp_transactions.stopped_received_at), never by a command result. */
  stopConfirmedAt: string | null;
  /**
   * The charger started a NEWER transaction on this connector while this one never stopped. This is NOT a confirmed stop:
   * `stopConfirmedAt` stays null, no stop is fabricated, no cost is run, and it blocks closure until resolved.
   * The charger may no longer accept a stop command for this ID; settlement is held visibly pending evidence.
   * If the real StopTransaction ever arrives it is applied normally (late evidence is preserved).
   */
  superseded?: boolean;
  /** pending = costing not yet decided; settled = costed with lines; held = named unresolved state; not_applicable = unauthorized evidence. */
  settlement: { state: "pending" | "settled" | "held" | "not_applicable"; reason: string | null };
};

export type LifecycleRequest = {
  id: string;
  kind: LifecycleKind;
  state: LifecycleState;
  orgId: string;
  installationId: string;
  deviceId: string;
  placementId: string;
  reason: string;
  /** Honest attribution: the shared login today, never a named person. */
  actorKind: "shared_login";
  actorLabel: string;
  requestedAt: string;
  /** When the placement actually closed. Defaults to actual completion; backdating is a separate audited correction. */
  serviceEndedAt: string | null;
  completedAt: string | null;
  sessions: SessionStep[];
  /** A visible reason when the request needs attention or cannot proceed. */
  attention: string | null;
  /** True once the device's connection identity was closed; late messages from it can no longer be admitted. */
  identityClosed: boolean;
  version: number;
};

export const MAX_STOP_ATTEMPTS = 5;
/** Backoff between stop attempts (ms): 10 s, 30 s, 2 min, 5 min, then needs_attention. */
export const STOP_BACKOFF_MS = [10_000, 30_000, 120_000, 300_000] as const;

export type TransitionRow = {
  from: LifecycleState | "(none)";
  action: string;
  actor: string;
  effects: string;
  success: string;
  pendingOrFailure: string;
};

/** The table the tests enforce and the handoff publishes. One row per permitted transition. */
export const TRANSITIONS: readonly TransitionRow[] = [
  { from: "(none)", action: "request remove/retire", actor: "shared login (platform operator) today; scoped installer/admin later", effects: "block new starts on the placement immediately; record reason + request time; snapshot open sessions", success: "request row exists", pendingOrFailure: "refused when a stop is needed and no stop command path exists (action unavailable); refused for an unknown/already-detached device; repeating the same request key resumes the same request" },
  { from: "requested", action: "evaluate", actor: "system", effects: "no open sessions -> closing; open sessions -> stopping", success: "state advances", pendingOrFailure: "none" },
  { from: "stopping", action: "request stop", actor: "system (bounded retries)", effects: "RemoteStopTransaction per open session; outcome recorded; ACCEPTED is NOT confirmation", success: "StopTransaction received for the session (durable)", pendingOrFailure: "rejected/offline/timeout: retry with backoff up to 5 attempts, then needs_attention; never reported as stopped" },
  { from: "stopping", action: "late StopTransaction", actor: "charger", effects: "correlates by transaction number to the original device/placement; confirms the session", success: "stopConfirmedAt set", pendingOrFailure: "duplicate stops are idempotent; a conflicting stop is flagged by the engine" },
  { from: "closing", action: "close placement + identity", actor: "system", effects: "close placement period, close connection-identity period, bump installation revision, write history; the device row and ALL history are kept; service end = actual completion", success: "placement closed, history row written", pendingOrFailure: "failure rolls back wholly and stays closing (retry)" },
  { from: "settling", action: "settle", actor: "system", effects: "costing consumer decides each session: costed | held(reason) | not_applicable", success: "every session is settled, held or not applicable", pendingOrFailure: "pending while costing is undecided; a held session stays visible and does not block completion" },
  { from: "needs_attention", action: "operator retry / reconcile", actor: "authorised operator", effects: "resume the same request", success: "back to stopping/closing", pendingOrFailure: "audited reconciliation of a stale session is a separate action (not built)" },
  { from: "requested", action: "cancel", actor: "authorised operator", effects: "unblock starts", success: "state cancelled", pendingOrFailure: "refused once any stop command was accepted (the session is already being ended)" },
];

/** Completion, stated once so code and tests share it. */
export const COMPLETION = "closed placement AND every session has a confirmed durable stop AND every settlement is settled, held (visible) or not_applicable";
