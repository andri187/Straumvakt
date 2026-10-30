/**
 * Deterministic connection ownership (Checkpoint A).
 *
 * One physical device has at most one OWNING socket at a time. Each validated
 * upgrade claims a new, strictly increasing GENERATION; every socket is tagged
 * with the generation (and placement) it was accepted under. After that:
 *
 *   • an older socket is `stale`: its frames are not processed, its close/error
 *     does not clear liveness or sweep commands that now belong to the newer
 *     socket, and it is closed by the server;
 *   • a socket accepted under a placement that is no longer the owner's is
 *     `stale` too, so a device that moved CPO cannot keep acting under its
 *     previous placement after the new connection claims it.
 *
 * The state is persisted (DO storage) so a hibernation wake-up or restart
 * reconstructs the same owner. This module is pure: no I/O, no clock.
 */

export type EngineContext = {
  orgId: string;
  installationId: string;
  installationKey: string;
  chargePointId: string;
  identityString: string;
  deviceId: string;
  placementId: string;
  credentialMode: "none" | "password";
  credentialEpoch: string;
};

export type Owner = { generation: number; context: EngineContext };

/** What a socket carries (WebSocket attachment). Small on purpose: it is serialised per socket. */
export type SocketTag = { generation: number; placementId: string };

export const SUPERSEDED_CLOSE_CODE = 4001; // private-use range; "superseded by a newer connection"

export function claim(prev: Owner | null, context: EngineContext): { owner: Owner; tag: SocketTag } {
  const generation = (prev?.generation ?? 0) + 1;
  return { owner: { generation, context }, tag: { generation, placementId: context.placementId } };
}

export type SocketStanding = "current" | "stale" | "unowned";

export function standing(owner: Owner | null, tag: SocketTag | null): SocketStanding {
  if (!owner || !tag) return "unowned";
  return tag.generation === owner.generation && tag.placementId === owner.context.placementId ? "current" : "stale";
}

/**
 * Should a close/error of this socket change device-level state (last-closed
 * time, command sweep)? Only if it is the current owner AND no other current
 * socket remains. A stale socket's death changes nothing.
 */
export function closeAffectsDevice(owner: Owner | null, closing: SocketTag | null, otherCurrentSockets: number): boolean {
  return standing(owner, closing) === "current" && otherCurrentSockets === 0;
}
