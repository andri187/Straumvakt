// Vendor-credential discovery probe — read-only inventory of every
// installation + charger a stored vendor credential can see, diffed
// against our DB. Backs POST /api/admin/vendor-credentials/:id/probe
// and the /onboard/credentials/:id/discover operator page.
//
// Sprint 9 — PROBE-2. Strictly read-only:
//   • zero db.*.create / .update / .delete calls
//   • no audit-record writes (probe is informational; the write
//     actions PROBE-3 and PROBE-4 are responsible for their own audit)
//
// Diff logic:
//   • Join key Zaptec UUID → OcppIdentity.vendor_resource_id
//   • Fallback join key Zaptec DeviceId (serial) → OcppIdentity.identity_string
//     (case-insensitive — identity_string is lower-case canonical)
//   • Status taxonomy:
//       - "not_onboarded"             — no OcppIdentity match on either key
//       - "onboarded_linked"          — our DB has the charger AND the parent
//                                       Installation row's credentialsId equals
//                                       this credential, OR credentialsRef equals
//                                       this credential's username
//       - "onboarded_unlinked"        — our DB has it but the parent Installation
//                                       has no credentialsId/credentialsRef set
//       - "onboarded_other_credential" — our DB has it AND the parent Installation
//                                        links a DIFFERENT credential
//
// Auth: reuses unsealAndAuth from credential-management.ts (one OAuth
// grant per request — Zaptec OAuth rate-limits back-to-back token
// requests from the same client).

import type { PrismaClient } from "../generated/prisma/client";
import type {
  VendorCredentialProbe,
  VendorCredentialProbeCharger,
  VendorCredentialProbeChargerStatus,
  VendorCredentialProbeInstallation,
} from "@straumvakt/shared/domain/vendor-credential-probe";
import {
  getInstallationHierarchy,
  listInstallations,
  type ZaptecHierarchyCharger,
  type ZaptecHierarchyCircuit,
  type ZaptecInstallationSummary,
} from "../lib/zaptec";
import { unsealAndAuth } from "./credential-management";

export async function probeVendorCredentialChargers(
  db: PrismaClient,
  kek: string | undefined,
  credentialId: string,
): Promise<VendorCredentialProbe> {
  if (!kek) throw new Error("kek_unavailable");
  const auth = await unsealAndAuth(db, kek, credentialId);

  // Pull the credential row for the response envelope. unsealAndAuth
  // already proved the row exists, so this is metadata only.
  const credRowRaw = await db.vendorCredential.findUnique({
    where: { id: credentialId },
    select: {
      id: true,
      username: true,
      status: true,
      vendor: { select: { slug: true } },
    },
  });
  if (!credRowRaw) throw new Error("credential_not_found");
  // Local const with a non-null type so closures (classify) can reference
  // it without re-narrowing inside the body.
  const credRow: {
    id: string;
    username: string;
    status: string;
    vendor: { slug: string };
  } = credRowRaw;

  // 1) Fetch Zaptec installation list + each installation's hierarchy
  //    in parallel. One OAuth grant; one fetch fan-out.
  const installationsResult = await listInstallations(auth.accessToken);
  if (!installationsResult.ok) throw new Error("zaptec_list_installations_failed");

  const zaptecInstallations = installationsResult.value.filter(
    (i): i is ZaptecInstallationSummary & { Id: string } =>
      typeof i.Id === "string",
  );

  const hierarchies = await Promise.all(
    zaptecInstallations.map(async (inst) => {
      const r = await getInstallationHierarchy(auth.accessToken, inst.Id);
      return { id: inst.Id, hierarchy: r.ok ? r.value : null };
    }),
  );
  const hierarchyById = new Map(hierarchies.map((h) => [h.id, h.hierarchy]));

  // Flatten every charger Zaptec returned so we can do one DB sweep.
  type ZapCharger = {
    zaptecId: string;
    deviceId: string | null;
    serialNo: string | null;
    name: string;
    installationId: string;
    installationName: string;
  };
  const zapChargers: ZapCharger[] = [];
  for (const inst of zaptecInstallations) {
    const h = hierarchyById.get(inst.Id);
    const instName = inst.Name ?? "(unnamed installation)";
    for (const circuit of (h?.Circuits ?? []) as ZaptecHierarchyCircuit[]) {
      for (const ch of (circuit.Chargers ?? []) as ZaptecHierarchyCharger[]) {
        if (typeof ch.Id !== "string") continue;
        zapChargers.push({
          zaptecId: ch.Id,
          deviceId: ch.DeviceId ?? null,
          serialNo: ch.SerialNo ?? null,
          name: ch.Name ?? "(unnamed)",
          installationId: inst.Id,
          installationName: instName,
        });
      }
    }
  }

  // 2) Pull every Zaptec OcppIdentity row that could match — UNSCOPED
  //    by org, because PROBE-2 needs to surface the
  //    "onboarded_other_credential" case across tenants too. We never
  //    expose the cross-tenant charger row fields; we only set
  //    ourOrgId/ourOrgName so the operator can see "this is somewhere
  //    else already" and route accordingly.
  const allZapIds = Array.from(new Set(zapChargers.map((c) => c.zaptecId)));
  const allSerialsLower = Array.from(
    new Set(
      zapChargers
        .map((c) => c.deviceId ?? c.serialNo)
        .filter((s): s is string => typeof s === "string" && s.length > 0)
        .map((s) => s.toLowerCase()),
    ),
  );

  type IdentityRow = {
    vendorResourceId: string | null;
    identityString: string;
    chargingStationId: string;
    orgId: string;
    organization: { displayName: string };
    chargingStation: {
      installationId: string | null;
      installation: {
        credentialsId: string | null;
        credentialsRef: string | null;
      } | null;
    } | null;
  };

  // Prisma's literal-narrowing for QueryMode requires the value to be a
  // const-typed "insensitive" rather than the wider `string`. We compose
  // the where as `unknown` then cast to PrismaClient's expected shape
  // via the call site cast below. The `OR` legs are individually
  // typed so the runtime payload matches Prisma's contract.
  type OrLeg =
    | { vendorResourceId: { in: string[] } }
    | { identityString: { in: string[]; mode: "insensitive" } };
  const orLegs: OrLeg[] = [];
  if (allZapIds.length > 0) {
    orLegs.push({ vendorResourceId: { in: allZapIds } });
  }
  if (allSerialsLower.length > 0) {
    orLegs.push({
      identityString: { in: allSerialsLower, mode: "insensitive" as const },
    });
  }

  const identityRows: IdentityRow[] =
    orLegs.length === 0
      ? []
      : ((await db.ocppIdentity.findMany({
          where: {
            vendor: "Zaptec",
            OR: orLegs,
          },
          select: {
            vendorResourceId: true,
            identityString: true,
            chargingStationId: true,
            orgId: true,
            organization: { select: { displayName: true } },
            chargingStation: {
              select: {
                installationId: true,
                installation: {
                  select: {
                    credentialsId: true,
                    credentialsRef: true,
                  },
                },
              },
            },
          },
        })) as unknown as IdentityRow[]);

  // Index by both join keys so the per-charger classifier can hit either.
  const byZapId = new Map<string, IdentityRow>();
  const bySerialLower = new Map<string, IdentityRow>();
  for (const row of identityRows) {
    if (row.vendorResourceId) byZapId.set(row.vendorResourceId, row);
    if (row.identityString) bySerialLower.set(row.identityString.toLowerCase(), row);
  }

  // 3) Per-charger classifier — applies the four-state taxonomy.
  function classify(zc: ZapCharger): {
    status: VendorCredentialProbeChargerStatus;
    ourChargingStationId: string | null;
    ourOrgId: string | null;
    ourOrgName: string | null;
  } {
    let row = byZapId.get(zc.zaptecId) ?? null;
    if (!row) {
      const key = (zc.deviceId ?? zc.serialNo ?? "").toLowerCase();
      if (key) row = bySerialLower.get(key) ?? null;
    }
    if (!row) {
      return {
        status: "not_onboarded",
        ourChargingStationId: null,
        ourOrgId: null,
        ourOrgName: null,
      };
    }
    const inst = row.chargingStation?.installation ?? null;
    const linkedHere =
      inst != null &&
      (inst.credentialsId === credentialId ||
        (inst.credentialsRef !== null && inst.credentialsRef === credRow.username));
    const linkedElsewhere =
      inst != null &&
      !linkedHere &&
      (inst.credentialsId !== null ||
        (inst.credentialsRef !== null && inst.credentialsRef.length > 0));
    let status: VendorCredentialProbeChargerStatus;
    if (linkedHere) status = "onboarded_linked";
    else if (linkedElsewhere) status = "onboarded_other_credential";
    else status = "onboarded_unlinked";
    return {
      status,
      ourChargingStationId: row.chargingStationId,
      ourOrgId: row.orgId,
      ourOrgName: row.organization.displayName,
    };
  }

  // 4) Build the response tree.
  const installations: VendorCredentialProbeInstallation[] = zaptecInstallations.map(
    (inst) => {
      const chargersForInst = zapChargers.filter((c) => c.installationId === inst.Id);
      const chargers: VendorCredentialProbeCharger[] = chargersForInst.map((zc) => {
        const v = classify(zc);
        return {
          zaptecChargerId: zc.zaptecId,
          serialNumber: zc.deviceId ?? zc.serialNo ?? null,
          displayName: zc.name,
          installationName: zc.installationName,
          status: v.status,
          ourChargingStationId: v.ourChargingStationId,
          ourOrgId: v.ourOrgId,
          ourOrgName: v.ourOrgName,
        };
      });
      const onboardedCount = chargers.filter((c) => c.status !== "not_onboarded").length;
      return {
        zaptecInstallationId: inst.Id,
        name: inst.Name ?? "(unnamed installation)",
        address: buildAddress(inst),
        chargers,
        onboardedCount,
        totalCount: chargers.length,
      };
    },
  );

  // Sort: most-onboarded installations first, so operator sees
  // what's already in flight before greenfield ones.
  installations.sort((a, b) => {
    if (b.onboardedCount !== a.onboardedCount) {
      return b.onboardedCount - a.onboardedCount;
    }
    return a.name.localeCompare(b.name);
  });

  // 5) Roll-up summary.
  let totalChargers = 0;
  let onboardedTotal = 0;
  let notOnboardedTotal = 0;
  let needsAttachTotal = 0;
  for (const inst of installations) {
    for (const ch of inst.chargers) {
      totalChargers++;
      if (ch.status === "not_onboarded") notOnboardedTotal++;
      else onboardedTotal++;
      if (ch.status === "onboarded_unlinked") needsAttachTotal++;
    }
  }

  return {
    credential: {
      id: credRow.id,
      vendor: credRow.vendor.slug,
      username: credRow.username,
      status: credRow.status,
    },
    installations,
    summary: {
      totalInstallations: installations.length,
      totalChargers,
      onboardedTotal,
      notOnboardedTotal,
      needsAttachTotal,
    },
  };
}

function buildAddress(inst: ZaptecInstallationSummary): string | null {
  const parts: string[] = [];
  if (inst.Address && inst.Address.length > 0) parts.push(inst.Address);
  const cityZip = [inst.ZipCode, inst.City]
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .join(" ");
  if (cityZip.length > 0) parts.push(cityZip);
  return parts.length > 0 ? parts.join(", ") : null;
}
