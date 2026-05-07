// Sprint 9.5 — read + write Zaptec-side configuration for a charging
// station. Reuses the cross-org credential lookup pattern from
// charger-technical-read.ts (8.13.3) and exposes the RAW Zaptec
// responses (observations from /state, properties from detail).
// Write path uses PUT /api/chargers/{id} since POST /update silently
// no-ops for Property* fields per the documented quirk in zaptec.ts.

import type { PrismaClient } from "../generated/prisma/client";
import {
  getChargerDetail,
  getChargerState,
  getZaptecAccessToken,
  putChargerProperties,
  type ZaptecStateEntry,
} from "../lib/zaptec";
import { openPassword } from "../lib/credential-crypto";

export interface ZaptecConfigSnapshot {
  observations: ZaptecStateEntry[];
  properties: Record<string, unknown>;
  fetchedAt: string;
  vendorReachable: boolean;
}

interface AccessContext {
  accessToken: string;
  vendorResourceId: string;
}

async function authForStation(
  db: PrismaClient,
  kek: string,
  chargingStationId: string,
): Promise<AccessContext | null> {
  const station = await db.chargingStation.findUnique({
    where: { siteAssetId: chargingStationId },
    select: {
      orgId: true,
      ocppIdentities: {
        where: { vendor: "Zaptec" },
        select: { vendorResourceId: true },
        take: 1,
      },
    },
  });
  const vendorResourceId =
    station?.ocppIdentities[0]?.vendorResourceId ?? null;
  if (!vendorResourceId) return null;

  const credentials = await db.vendorCredential.findMany({
    where: { status: "active", vendor: { slug: "zaptec" } },
    select: {
      ownerOrgId: true,
      username: true,
      passwordCipher: true,
      passwordIv: true,
    },
    orderBy: { lastUsedAt: "desc" },
  });
  if (credentials.length === 0) return null;
  credentials.sort((a, b) => {
    const aOwn = a.ownerOrgId === station?.orgId ? 0 : 1;
    const bOwn = b.ownerOrgId === station?.orgId ? 0 : 1;
    return aOwn - bOwn;
  });

  for (const cred of credentials) {
    if (!cred.passwordCipher || !cred.passwordIv) continue;
    try {
      const password = await openPassword(kek, {
        cipher: cred.passwordCipher,
        iv: cred.passwordIv,
      });
      const tokenResult = await getZaptecAccessToken(cred.username, password);
      if (tokenResult.ok) {
        return { accessToken: tokenResult.value, vendorResourceId };
      }
    } catch {
      // try next credential
    }
  }
  return null;
}

export async function getChargerZaptecConfig(
  db: PrismaClient,
  kek: string,
  chargingStationId: string,
): Promise<ZaptecConfigSnapshot> {
  const ctx = await authForStation(db, kek, chargingStationId);
  if (!ctx) {
    return {
      observations: [],
      properties: {},
      fetchedAt: new Date().toISOString(),
      vendorReachable: false,
    };
  }
  const [stateRes, detailRes] = await Promise.all([
    getChargerState(ctx.accessToken, ctx.vendorResourceId),
    getChargerDetail(ctx.accessToken, ctx.vendorResourceId),
  ]);
  const observations = stateRes.ok ? stateRes.value : [];
  const properties =
    detailRes.ok && detailRes.value ? detailRes.value : {};
  return {
    observations,
    properties,
    fetchedAt: new Date().toISOString(),
    vendorReachable: stateRes.ok || detailRes.ok,
  };
}

export interface WriteZaptecPropertyResult {
  ok: boolean;
  status: number | null;
  error?: string;
}

export async function writeChargerZaptecProperty(
  db: PrismaClient,
  kek: string,
  chargingStationId: string,
  body: Record<string, string | number | boolean>,
): Promise<WriteZaptecPropertyResult> {
  const ctx = await authForStation(db, kek, chargingStationId);
  if (!ctx) {
    return { ok: false, status: null, error: "no_credential_or_station" };
  }
  const res = await putChargerProperties(
    ctx.accessToken,
    ctx.vendorResourceId,
    body,
  );
  if (!res.ok) {
    const status =
      res.error.kind === "list"
        ? res.error.status
        : null;
    return { ok: false, status, error: res.error.kind };
  }
  return { ok: true, status: 200 };
}
