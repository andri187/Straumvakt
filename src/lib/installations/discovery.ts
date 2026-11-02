// Chargers that are knocking, as the CPO sees them.
//
// The OCPP engine refuses an unknown charger before the WebSocket upgrade and only writes a throttled row to
// ocpp.pending_discoveries, keyed `{cpo-org-id}/{charge-point-id}`. This module turns those rows into what an
// operator may act on. It never registers anything: attaching is the one existing installation save, so a charger
// picked from this list and one typed by hand end in exactly the same operation (device, connection identity and
// dated placement, in one transaction).
//
// What the list is, and is not:
//   - Scoped by CPO on the server. A row belonging to another CPO, or with a legacy/ambiguous key, is never returned.
//   - first/last seen and the attempt count are recorded observations, throttled by the engine. They are not online
//     status and not an exact retry count.
//   - The claimed identity is unverified: a host presenting an id is not proof of who owns the charger. The operator's
//     save is the explicit acceptance, and it is audited with the actor and the discovery evidence.
//   - Unknown chargers are listed for INCOMING_WINDOW_MS after their last recorded knock (see incoming-window.ts), or for as
//     long as the gateway reports a pending socket open for them. That presence is gateway-observed, not proof of recent
//     device liveness, and it is read on demand (a list read or manual Refresh), never pushed or polled.
//   - A charger that already has a connection identity in this CPO is not a new candidate. If it was knocking with a
//     recorded refusal reason it is a RECOVERY case (return it through its installation); otherwise it is simply
//     registered and drops out of the list. The discovery rows themselves are never edited or deleted.

import { mayAdminister, type Actor } from "./actor";
import { incomingVisible } from "./incoming-window";
import type { BootCaptureRow, Store } from "./store";
import { ACTIVATION_WAIT_MS } from "@/lib/ocpp-engine/pending";

/**
 * What happened to the "you are registered now" signal for a charger that was attached while it was waiting.
 *   waiting      delivered; the charger has not yet sent an accepted BootNotification since the save.
 *   undelivered  the gateway could not be told yet; it is re-sent when this list is read (bounded).
 *   failed       still undelivered after MAX_PROMOTE_ATTEMPTS; no more retries, the charger connects when it next reconnects.
 *   incomplete   delivered, but no accepted BootNotification within ACTIVATION_WAIT_MS of the save. Computed at read time from the
 *                retained promotion timestamp (no timer, no write). It does not say why; a later accepted boot clears the row.
 */
export type Activation = "waiting" | "undelivered" | "failed" | "incomplete";

export type IncomingCharger = {
  chargePointId: string;
  firstSeenAt: string;
  lastSeenAt: string;
  /** Recorded observations, throttled by the engine. Not an exact count of attempts. */
  attempts: number;
  /** "incoming": unknown, can be attached. "recovery": a known charger that needs attention; it is not a new candidate. */
  state: "incoming" | "recovery";
  /** Short plain explanation, only for recovery rows. Never contains a credential value. */
  note: string | null;
  /** When and which BootNotification was last captured. The body is a separate, on-demand read. */
  boot: { messageId: string; receivedAt: string } | null;
  /** Gateway-observed pending socket: true = open now, false = not open, null = not asked or the gateway did not answer. */
  socket: boolean | null;
  /** Only for recovery rows of a charger that was attached while waiting. */
  activation: Activation | null;
};

/** Which of these charge point ids hold a pending socket at the gateway right now. Null when it cannot be asked. */
export interface PresencePort {
  connected(orgId: string, chargePointIds: string[]): Promise<{ connected: Set<string>; unknown: Set<string> } | null>;
}

/** Tells the gateway that these charge point ids are registered now. Resolves to an outcome per id; a missing id is a failure. */
export interface PromotionPort {
  promote(orgId: string, chargePointIds: string[]): Promise<Record<string, string>>;
}

/** One gateway call asks about at most this many ids (the gateway enforces the same bound); one read makes at most MAX_PRESENCE_CALLS calls. */
export const MAX_PRESENCE_IDS = 25;
export const MAX_PRESENCE_CALLS = 4;
export const MAX_PROMOTE_ATTEMPTS = 5;
export const MAX_RETRIES_PER_READ = 10;
/** A fresh intent is left alone for this long: the post-commit attempt of the same save may still be in flight. */
export const PROMOTE_RETRY_MIN_AGE_MS = 15_000;

/** Reason codes that mean "this REGISTERED charger was refused at the door". A successful boot afterwards clears them. */
export const CREDENTIAL_REASONS: ReadonlySet<string> = new Set(["credentials_not_configured", "credentials_required", "username_mismatch", "bad_credentials"]);

const RECOVERY_NOTE: Record<string, string> = {
  identity_not_current: "Known charger that is no longer registered here. Return it from its installation.",
  no_active_placement: "Known charger with no current installation. Return it from its installation.",
  credentials_not_configured: "Refused: this installation has no OCPP password setting yet. Set one on the installation, then configure the same on the charger.",
  credentials_required: "Refused: the charger connected without credentials but this installation requires an OCPP password. Enter the password on the charger.",
  username_mismatch: "Refused: the username the charger sent is not its charge point id. Set the charger's username to its charge point id.",
  bad_credentials: "Refused: the password the charger sent does not match this installation's OCPP password. Re-enter it on the charger.",
};

export const activationNote = (a: Activation): string =>
  a === "waiting"
    ? "Saved to a circuit. Waiting for the charger to reconnect and send its BootNotification. Saving does not mean it is online."
    : a === "undelivered"
      ? "Saved to a circuit, but the connection signal has not reached the gateway yet. It is re-sent whenever this list is read. The charger also connects by itself when it next reconnects."
      : a === "failed"
        ? "Saved to a circuit, but the connection signal could not be delivered after several tries. The charger connects the next time it reconnects by itself."
        : "Saved to a circuit and the gateway was told, but no accepted BootNotification has arrived since. This does not show why: the charger may not have reconnected, may have been refused, or may be offline. A later accepted BootNotification clears this.";

/** `reconnect_requested` (a waiting socket was told) and `not_connected` (nothing is waiting; normal admission applies) both mean nothing is left to deliver. */
export const promotionDelivered = (outcome: string): boolean => outcome === "reconnect_requested" || outcome === "not_connected";

export const MAX_INCOMING = 50;

/** Presence for many ids: batched into at most MAX_PRESENCE_CALLS bounded calls, in parallel. Ids of a failed call are unknown, not absent. */
async function askPresence(port: PresencePort, orgId: string, ids: string[]): Promise<{ connected: Set<string>; unknown: Set<string> }> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length && chunks.length < MAX_PRESENCE_CALLS; i += MAX_PRESENCE_IDS) chunks.push(ids.slice(i, i + MAX_PRESENCE_IDS));
  const connected = new Set<string>();
  const unknown = new Set<string>(ids.slice(MAX_PRESENCE_IDS * MAX_PRESENCE_CALLS));
  await Promise.all(
    chunks.map(async (chunk) => {
      const r = await port.connected(orgId, chunk).catch(() => null);
      if (!r) return void chunk.forEach((id) => unknown.add(id));
      r.connected.forEach((id) => connected.add(id));
      r.unknown.forEach((id) => unknown.add(id));
    }),
  );
  return { connected, unknown };
}

/**
 * Unregistered rows are listed while their last recorded knock is inside INCOMING_WINDOW_MS (`now` is injectable) or while
 * the gateway reports an open pending socket for them. Hiding is a read-time filter: nothing is written or deleted.
 *
 * Known chargers appear as "recovery" rows only while something needs attention: an old refusal reason, a credential refusal
 * that no accepted boot has cleared, or a save whose activation has not produced a boot yet. An accepted BootNotification
 * AFTER the save/refusal is the evidence that clears the last two; nothing is polled to find it, it is read here.
 *
 * `promoter`, when given, re-sends undelivered activation signals (bounded per read, at most MAX_PROMOTE_ATTEMPTS each).
 */
export async function incomingChargers(
  store: Store,
  orgId: string,
  actor: Actor,
  limit = MAX_INCOMING,
  now: () => Date = () => new Date(),
  presence: PresencePort | null = null,
  promoter: PromotionPort | null = null,
): Promise<IncomingCharger[]> {
  // The caller's authority over the CPO is checked here as well as by whoever chose `orgId`.
  if (!mayAdminister(actor, orgId)) return [];
  const { rows, known, bootAt } = await store.transaction(async (tx) => {
    const found = await tx.listDiscoveries(orgId, limit * 2);
    const knownIds = await tx.knownChargePointIds(orgId, found.map((r) => r.chargePointId));
    const needsEvidence = found.filter((r) => knownIds.has(r.chargePointId.toLowerCase()) && (r.promote || (r.reason && CREDENTIAL_REASONS.has(r.reason)))).map((r) => r.chargePointId);
    return { rows: found, known: knownIds, bootAt: await tx.lastBootAt(orgId, needsEvidence) };
  });
  const nowMs = now().getTime();
  // The transaction is over before the gateway is asked, so no database connection waits on it.
  const candidates = rows.filter((r) => !known.has(r.chargePointId.toLowerCase()) && !r.reason).slice(0, MAX_PRESENCE_IDS * MAX_PRESENCE_CALLS);
  const asked = presence && candidates.length > 0 ? await askPresence(presence, orgId, candidates.map((r) => r.chargePointId)) : null;
  const askedIds = new Set(candidates.map((r) => r.chargePointId));

  const out: IncomingCharger[] = [];
  const retryable: { row: IncomingCharger; promote: NonNullable<(typeof rows)[number]["promote"]> }[] = [];
  for (const r of rows) {
    const isKnown = known.has(r.chargePointId.toLowerCase());
    const boot = r.boot ? { messageId: r.boot.messageId, receivedAt: r.boot.receivedAt.toISOString() } : null;
    const base = { chargePointId: r.chargePointId, firstSeenAt: r.firstSeenAt.toISOString(), lastSeenAt: r.lastSeenAt.toISOString(), attempts: r.attemptCount, boot, socket: null, activation: null };
    if (isKnown) {
      const lastBoot = bootAt.get(r.chargePointId.toLowerCase());
      const credential = r.reason !== null && CREDENTIAL_REASONS.has(r.reason);
      // A credential refusal is cleared by an accepted boot after it; a refusal without a time stays until some boot exists.
      const credentialActive = credential && !(lastBoot && (r.reasonAt ? lastBoot > r.reasonAt : true));
      const waiting = r.promote !== null && !(lastBoot && lastBoot > r.promote.at);
      if (credentialActive) out.push({ ...base, state: "recovery", note: RECOVERY_NOTE[r.reason!]! });
      else if (r.reason && !credential) out.push({ ...base, state: "recovery", note: RECOVERY_NOTE[r.reason] ?? "Known charger. Not available to attach." });
      else if (waiting && r.promote) {
        const activation: Activation = r.promote.delivered ? (nowMs - r.promote.at.getTime() >= ACTIVATION_WAIT_MS ? "incomplete" : "waiting") : r.promote.attempts >= MAX_PROMOTE_ATTEMPTS ? "failed" : "undelivered";
        const row: IncomingCharger = { ...base, state: "recovery", note: activationNote(activation), activation };
        out.push(row);
        if (activation === "undelivered" && nowMs - r.promote.at.getTime() >= PROMOTE_RETRY_MIN_AGE_MS) retryable.push({ row, promote: r.promote });
      }
      // Otherwise registered and resolved: nothing to show.
    } else if (!r.reason) {
      const socket = asked && askedIds.has(r.chargePointId) ? (asked.connected.has(r.chargePointId) ? true : asked.unknown.has(r.chargePointId) ? null : false) : null;
      // An open pending socket keeps a quiet charger listed; a closed or unknown one falls back to the knock window.
      if (socket === true || incomingVisible(r.lastSeenAt.getTime(), nowMs)) out.push({ ...base, state: "incoming", note: null, socket });
    }
    // Unknown with a reason: ambiguous, left out.
  }

  if (promoter && retryable.length > 0) {
    const batch = retryable.slice(0, MAX_RETRIES_PER_READ);
    const outcomes = await promoter.promote(orgId, batch.map((b) => b.row.chargePointId)).catch(() => ({}) as Record<string, string>);
    const results = batch.map((b) => {
      const outcome = outcomes[b.row.chargePointId] ?? "error";
      return { ...b, outcome, delivered: promotionDelivered(outcome) };
    });
    // Recording the attempt is best effort: a failure here only means the same retry happens on the next read.
    await store.transaction(async (tx) => {
      for (const x of results) await tx.recordPromotionOutcome(orgId, x.row.chargePointId, { delivered: x.delivered, outcome: x.outcome });
    }).catch(() => undefined);
    for (const x of results) {
      x.row.activation = x.delivered ? "waiting" : x.promote.attempts + 1 >= MAX_PROMOTE_ATTEMPTS ? "failed" : "undelivered";
      x.row.note = activationNote(x.row.activation);
    }
  }
  return out.slice(0, limit);
}

/**
 * First delivery attempt after a save committed: tell the gateway, then record each outcome. Chargers beyond one call's bound,
 * and any whose attempt failed, stay recorded as undelivered and are re-sent when the list is read. Never throws: the save has
 * already succeeded, and activation is a separate, visible state.
 */
export async function signalAttached(store: Store, promoter: PromotionPort, orgId: string, chargePointIds: string[]): Promise<void> {
  const outcomes = await promoter.promote(orgId, chargePointIds).catch(() => ({}) as Record<string, string>);
  await store
    .transaction(async (tx) => {
      for (const id of chargePointIds) {
        const outcome = outcomes[id];
        if (outcome !== undefined) await tx.recordPromotionOutcome(orgId, id, { delivered: promotionDelivered(outcome), outcome });
      }
    })
    .catch(() => undefined);
}

/**
 * The complete captured BootNotification for one charge point id of THIS CPO. Read-only: it contacts no charger and
 * changes nothing. Authority is checked here and the CPO is the caller's, never a request value.
 */
export async function bootCaptureFor(store: Store, orgId: string, actor: Actor, chargePointId: string): Promise<BootCaptureRow | null> {
  if (!mayAdminister(actor, orgId)) return null;
  return store.transaction((tx) => tx.loadBootCapture(orgId, chargePointId));
}

/** The evidence line written to the audit history when an attached charger was knocking at the time. */
export function discoveryEvidence(d: { firstSeenAt: Date; lastSeenAt: Date; attemptCount: number }): string {
  return `incoming charger accepted by the operator (first seen ${d.firstSeenAt.toISOString()}, last seen ${d.lastSeenAt.toISOString()}, ${d.attemptCount} recorded observations)`;
}
