// Installation OCPP password repo unit tests.
//
// Covers:
//   1. rotate: returns plaintext, hashes it, stamps on every identity
//      in the installation, writes audit row.
//   2. rotate: identities outside this installation are not touched.
//   3. rotate: missing installation → null.
//   4. set: hashes operator-supplied plaintext + stamps + audit.
//   5. set: rejects too-short plaintext.
//   6. summary: identityCount + lastRotatedAt derived from audit.

import { describe, expect, it, vi } from "vitest";
import {
  rotateInstallationOcppPassword,
  setInstallationOcppPassword,
  getInstallationOcppSummary,
} from "./installation-ocpp";
import type { PrismaClient } from "../generated/prisma/client";

interface IdentityRow {
  id: string;
  installationId: string; // resolved via chargingStation
  authSecretHash: string;
}

interface AuditRow {
  orgId: string;
  action: string;
  targetId: string;
  targetType: string;
  occurredAt: Date;
  metadata: Record<string, unknown>;
}

function makeFake(installations: { id: string; orgId: string }[]) {
  const identities: IdentityRow[] = [];
  const audits: AuditRow[] = [];

  function tx() {
    return {
      ocppIdentity: {
        updateMany: vi.fn(async ({ where, data }: any) => {
          const installationId = where.chargingStation.installationId;
          let count = 0;
          for (const row of identities) {
            if (row.installationId === installationId) {
              row.authSecretHash = data.authSecretHash;
              count++;
            }
          }
          return { count };
        }),
      },
      auditAction: {
        create: vi.fn(async ({ data }: any) => {
          audits.push({
            orgId: data.orgId,
            action: data.action,
            targetId: data.targetId,
            targetType: data.targetType,
            occurredAt: new Date(),
            metadata: data.metadata ?? {},
          });
          return data;
        }),
      },
    };
  }

  const db = {
    installation: {
      findUnique: vi.fn(async ({ where }: any) => {
        return installations.find((i) => i.id === where.id) ?? null;
      }),
    },
    ocppIdentity: {
      count: vi.fn(async ({ where }: any) => {
        const installationId = where.chargingStation.installationId;
        return identities.filter((i) => i.installationId === installationId).length;
      }),
      // findMany used by old summary impl — kept for safety
      findMany: vi.fn(async ({ where }: any) => {
        const installationId = where.chargingStation.installationId;
        return identities.filter((i) => i.installationId === installationId);
      }),
    },
    auditAction: {
      findFirst: vi.fn(async ({ where }: any) => {
        const matches = audits.filter(
          (a) =>
            a.targetType === where.targetType &&
            a.targetId === where.targetId &&
            where.action.in.includes(a.action),
        );
        if (matches.length === 0) return null;
        // orderBy occurredAt desc
        matches.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
        return matches[0];
      }),
    },
    $transaction: vi.fn(async (fn: any) => fn(tx())),
  };

  return { db: db as unknown as PrismaClient, identities, audits };
}

describe("installation-ocpp", () => {
  it("rotate: returns plaintext and stamps the hash on every identity in the installation", async () => {
    const f = makeFake([
      { id: "inst-1", orgId: "org-1" },
      { id: "inst-2", orgId: "org-1" },
    ]);
    f.identities.push(
      { id: "id-a", installationId: "inst-1", authSecretHash: "old" },
      { id: "id-b", installationId: "inst-1", authSecretHash: "old" },
      { id: "id-c", installationId: "inst-2", authSecretHash: "should-not-change" },
    );

    const result = await rotateInstallationOcppPassword(f.db, "inst-1", null);

    expect(result).not.toBeNull();
    expect(result!.installationId).toBe("inst-1");
    expect(result!.identityCount).toBe(2);
    expect(result!.plaintext).toMatch(/^[0-9a-f]{64}$/);

    // Both inst-1 identities updated to the same fresh hash.
    expect(f.identities[0].authSecretHash).toBe(f.identities[1].authSecretHash);
    expect(f.identities[0].authSecretHash).not.toBe("old");

    // inst-2 untouched.
    expect(f.identities[2].authSecretHash).toBe("should-not-change");

    // Audit row written.
    expect(f.audits).toHaveLength(1);
    expect(f.audits[0].action).toBe("installation.ocpp_password.rotate");
    expect(f.audits[0].targetId).toBe("inst-1");
    expect(f.audits[0].metadata).toEqual({ identityCount: 2 });
  });

  it("rotate: missing installation returns null without writing anything", async () => {
    const f = makeFake([{ id: "inst-1", orgId: "org-1" }]);
    const result = await rotateInstallationOcppPassword(f.db, "inst-MISSING", null);
    expect(result).toBeNull();
    expect(f.audits).toHaveLength(0);
  });

  it("set: hashes operator plaintext + stamps + audits", async () => {
    const f = makeFake([{ id: "inst-1", orgId: "org-1" }]);
    f.identities.push(
      { id: "id-a", installationId: "inst-1", authSecretHash: "old-1" },
      { id: "id-b", installationId: "inst-1", authSecretHash: "old-2" },
    );

    const result = await setInstallationOcppPassword(
      f.db,
      "inst-1",
      "operator-typed-secret-12345",
      null,
    );

    expect(result).not.toBeNull();
    expect(result!.identityCount).toBe(2);
    // Both identities now share the same hash.
    expect(f.identities[0].authSecretHash).toBe(f.identities[1].authSecretHash);
    // The hash is NOT the plaintext.
    expect(f.identities[0].authSecretHash).not.toBe("operator-typed-secret-12345");
    // Hash is hex of length 64 (SHA-256).
    expect(f.identities[0].authSecretHash).toMatch(/^[0-9a-f]{64}$/);

    expect(f.audits).toHaveLength(1);
    expect(f.audits[0].action).toBe("installation.ocpp_password.set");
  });

  it("set: rejects too-short plaintext", async () => {
    const f = makeFake([{ id: "inst-1", orgId: "org-1" }]);
    await expect(
      setInstallationOcppPassword(f.db, "inst-1", "short", null),
    ).rejects.toThrow("password_length_invalid");
    expect(f.audits).toHaveLength(0);
  });

  it("set: rejects too-long plaintext", async () => {
    const f = makeFake([{ id: "inst-1", orgId: "org-1" }]);
    const tooLong = "x".repeat(129);
    await expect(
      setInstallationOcppPassword(f.db, "inst-1", tooLong, null),
    ).rejects.toThrow("password_length_invalid");
  });

  it("summary: returns identityCount + lastRotatedAt from audit log", async () => {
    const f = makeFake([{ id: "inst-1", orgId: "org-1" }]);
    f.identities.push(
      { id: "id-a", installationId: "inst-1", authSecretHash: "h" },
      { id: "id-b", installationId: "inst-1", authSecretHash: "h" },
    );

    const before = await getInstallationOcppSummary(f.db, "inst-1");
    expect(before).toEqual({
      installationId: "inst-1",
      identityCount: 2,
      lastRotatedAt: null,
    });

    await rotateInstallationOcppPassword(f.db, "inst-1", null);

    const after = await getInstallationOcppSummary(f.db, "inst-1");
    expect(after?.identityCount).toBe(2);
    expect(after?.lastRotatedAt).toBeInstanceOf(Date);
  });

  it("summary: missing installation → null", async () => {
    const f = makeFake([]);
    expect(await getInstallationOcppSummary(f.db, "inst-MISSING")).toBeNull();
  });
});
