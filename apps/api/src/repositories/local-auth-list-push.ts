// Local auth list push — Half B of the SendLocalList feature (2026-05-10).
//
// Sends a single IdToken to a charger via OCPP 1.6J SendLocalList in
// Differential mode. Uses the existing OutboundCommand outbox pattern:
//
//   1. Resolve OCPP identity → charging station, fetch the next list
//      version (monotonic from our pushed_auth_list_version column).
//   2. In a transaction: bump pushed_auth_list_version, insert an
//      ocpp.outbound_commands row with controlDomain='send_local_list'.
//   3. Publish { commandId } to OUTBOUND_QUEUE so the dispatcher picks
//      it up and routes via the gateway service binding. The dispatcher
//      action map (lib/dispatch-targets.ts) translates send_local_list
//      → SendLocalList on the wire.
//   4. The gateway DO sends the OCPP Call, the charger replies with
//      one of {Accepted, Failed, NotSupported, VersionMismatch}, and
//      the DO ships a command_result event back via the queue. The
//      OutboundCommand row's `status` lands at 'acked' (with the
//      verdict in `result`) or 'failed'.
//
// Rule 5 risk model (CSMS access-grant + OCPP handler semantics):
//   • OCPP defaults: LocalAuthorizeOffline=true, AllowOfflineTxForUnknownId=
//     false. A bad push lands a wrong entry that authorizes the next
//     CSMS-outage tap with no further check.
//   • If the operator has flipped LocalPreAuthorize=true, the charger
//     skips the online Authorize round-trip entirely and trusts the
//     local list per tap. Same risk, online too.
//   • Revocation lag: removing an idTag from the CSMS roster does not
//     propagate until you push again. Pair revocation with a push.
//
// VersionMismatch recovery: not implemented in Half B. If the charger
// rejects because its own version is ahead of ours (possible if the
// install was previously managed by another CSMS or the Zaptec Portal),
// the OutboundCommand row lands at 'failed' with VersionMismatch in the
// result. Operator triages by reading StateId 751 and re-syncing the
// pushed_auth_list_version column manually. Half C wires the auto-
// recovery loop.

import type { PrismaClient, Prisma } from "../generated/prisma/client";
import type { Queue } from "@cloudflare/workers-types";
import type { OutboundCommandMessage } from "../bindings";

export interface PushIdTokenInput {
  ocppIdentityId: string;
  idTokenId: string;
  /** Optional operator user id for audit. Null when called from the
   *  shadow-mode admin shell that pre-dates per-user attribution. */
  requestedBy?: string | null;
}

export interface PushIdTokenResult {
  commandId: string;
  listVersion: number;
  /** The OCPP idTag value (RFID UID, app token, etc) actually pushed. */
  idTag: string;
}

export class PushIdTokenError extends Error {
  constructor(
    public readonly code:
      | "identity_not_found"
      | "id_token_not_found"
      | "id_token_revoked"
      | "id_token_suspended"
      | "id_token_expired"
      | "scope_mismatch"
      | "no_contract",
    message: string,
  ) {
    super(message);
    this.name = "PushIdTokenError";
  }
}

export async function pushIdTokenToCharger(
  db: PrismaClient,
  queue: Queue<OutboundCommandMessage>,
  input: PushIdTokenInput,
): Promise<PushIdTokenResult> {
  const identity = await db.ocppIdentity.findUnique({
    where: { id: input.ocppIdentityId },
    select: {
      id: true,
      orgId: true,
      chargingStationId: true,
      chargingStation: {
        select: {
          siteAssetId: true,
          installationId: true,
          pushedAuthListVersion: true,
        },
      },
    },
  });
  if (!identity || !identity.chargingStation) {
    throw new PushIdTokenError(
      "identity_not_found",
      `OCPP identity ${input.ocppIdentityId} has no chargingStation attachment`,
    );
  }

  const token = await db.idToken.findUnique({
    where: { id: input.idTokenId },
    select: {
      id: true,
      userId: true,
      value: true,
      status: true,
      expiresAt: true,
      scopeInstallationId: true,
    },
  });
  if (!token) {
    throw new PushIdTokenError(
      "id_token_not_found",
      `IdToken ${input.idTokenId} not found`,
    );
  }
  // Status guards. Pushing any non-active token would put it in the
  // charger's local list, where it authorizes during offline windows
  // (LocalAuthorizeOffline=true on Zaptec defaults) — bypassing the
  // online status check that lives in ocpp-authorize.ts.
  if (token.status === "revoked") {
    throw new PushIdTokenError(
      "id_token_revoked",
      "Refusing to push a revoked IdToken — would re-authorize at the charger.",
    );
  }
  if (token.status === "suspended") {
    throw new PushIdTokenError(
      "id_token_suspended",
      "IdToken is suspended.",
    );
  }
  if (token.status === "expired") {
    throw new PushIdTokenError(
      "id_token_expired",
      "IdToken status is expired.",
    );
  }
  if (token.expiresAt && token.expiresAt.getTime() <= Date.now()) {
    throw new PushIdTokenError(
      "id_token_expired",
      "IdToken's expiresAt is in the past.",
    );
  }
  // Scope guard. If the IdToken is scoped to a specific installation,
  // it must match the charger's installation. Mirrors the runtime check
  // in resolveAuthorize so the UI can't push a token to a charger where
  // the runtime would Reject it anyway.
  if (
    token.scopeInstallationId &&
    token.scopeInstallationId !== identity.chargingStation.installationId
  ) {
    throw new PushIdTokenError(
      "scope_mismatch",
      "IdToken is scoped to a different installation than this charger.",
    );
  }
  // Contract gate (ADR 0019). The same check ocpp-authorize.ts runs
  // online: the user must hold an active DriverGroupMembership under
  // an active installation-type Agreement at the charger's installation.
  // Without this, pushing a no-contract token would let it authorize
  // during the next CSMS-outage tap — bypassing the contract layer
  // that gates online auth.
  if (identity.chargingStation.installationId) {
    const now = new Date();
    const membership = await db.driverGroupMembership.findFirst({
      where: {
        userId: token.userId,
        driverGroup: {
          agreement: {
            agreementType: "installation",
            installationId: identity.chargingStation.installationId,
            status: "active",
            effectiveFrom: { lte: now },
            OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }],
          },
        },
      },
      select: { id: true },
    });
    if (!membership) {
      throw new PushIdTokenError(
        "no_contract",
        "User has no active contract at this installation. Pushing would authorize them during offline windows.",
      );
    }
  }

  // OCPP idTagInfo for an "add this entry" Differential push. We pass
  // expiryDate when known so the charger can age it out without our
  // prompting; status=Accepted means the entry authorizes; parentIdTag
  // is omitted (we don't model parent tags yet).
  const idTagInfo: Record<string, unknown> = { status: "Accepted" };
  if (token.expiresAt) {
    idTagInfo.expiryDate = token.expiresAt.toISOString();
  }

  const commandId = crypto.randomUUID();
  const newVersion = identity.chargingStation.pushedAuthListVersion + 1;

  // Transaction: bump version + insert OutboundCommand atomically. The
  // queue.send happens AFTER commit so a publish failure can't leak a
  // version bump (sweeper republishes pending rows).
  await db.$transaction(async (tx) => {
    await tx.chargingStation.update({
      where: { siteAssetId: identity.chargingStation!.siteAssetId },
      data: { pushedAuthListVersion: newVersion },
    });
    await tx.outboundCommand.create({
      data: {
        id: commandId,
        orgId: identity.orgId,
        identityId: identity.id,
        controlDomain: "send_local_list",
        routedTo: "ocpp",
        payload: {
          listVersion: newVersion,
          updateType: "Differential",
          localAuthorizationList: [
            { idTag: token.value, idTagInfo },
          ],
        } as Prisma.InputJsonValue,
        status: "pending",
        attempts: 0,
        notBefore: new Date(),
        correlationId: crypto.randomUUID(),
        requestedBy: input.requestedBy ?? null,
      },
    });
  });

  // Best-effort publish. Sweeper recovers stuck-pending rows.
  try {
    await queue.send({ commandId });
  } catch (err) {
    console.error("[local-auth-list-push] OUTBOUND_QUEUE.send failed", {
      commandId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return {
    commandId,
    listVersion: newVersion,
    idTag: token.value,
  };
}
