// Zaptec onboarding wizard — discover + import.
//
// Discover: exchanges credentials for a short-lived access token,
// lists installations, fetches each hierarchy in parallel, returns a
// nested tree the wizard renders. No DB writes.
//
// Import: provisions one installation (and its chargers) into the
// Straumvakt schema in a single transaction. See repositories/zaptec-
// import.ts for the multi-table tx + OCPP password generation.

import { Hono } from "hono";
import { ZaptecImportInput } from "@straumvakt/shared/inputs/zaptec-import";
import { z } from "zod";
import { requireAdmin, type AuthVars } from "../../lib/auth-middleware";
import { makePrisma } from "../../lib/prisma";
import {
  getChargerDetail,
  getInstallationHierarchy,
  getZaptecAccessToken,
  listChargers,
  listInstallations,
  rawZaptecGet,
  type ZaptecError,
  type ZaptecHierarchyCircuit,
  type ZaptecHierarchyCharger,
} from "../../lib/zaptec";
import { importZaptecInstallation } from "../../repositories/zaptec-import";
import { unsealVendorCredentialPassword } from "../../repositories/vendor-credentials";
import {
  setZaptecAuthRequired,
  type BulkScope,
} from "../../repositories/zaptec-bulk-config";
import { sha256Hex } from "../../lib/sha256";
import type { Env } from "../../bindings";

const DiscoverBody = z.object({
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(200),
});

function zaptecErrorResponse(err: ZaptecError) {
  switch (err.kind) {
    case "unreachable":
      return { code: 502 as const, body: { error: "zaptec_unreachable" as const } };
    case "invalid_credentials":
      return { code: 401 as const, body: { error: "invalid_credentials" as const } };
    case "no_token":
      return { code: 502 as const, body: { error: "zaptec_oauth_no_token" as const } };
    case "oauth":
      return { code: 502 as const, body: { error: "zaptec_oauth_error" as const, status: err.status } };
    case "list":
      return { code: 502 as const, body: { error: "zaptec_list_error" as const, status: err.status } };
  }
}

export const adminZaptec = new Hono<{ Bindings: Env; Variables: AuthVars }>();

adminZaptec.use("*", requireAdmin);

adminZaptec.post("/discover", async (c) => {
  const raw = (await c.req.json().catch(() => null)) as unknown;
  const parsed = DiscoverBody.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "validation", issues: parsed.error.issues }, 400);
  }
  const { username, password } = parsed.data;

  const tokenResult = await getZaptecAccessToken(username, password);
  if (!tokenResult.ok) {
    const r = zaptecErrorResponse(tokenResult.error);
    return c.json(r.body, r.code);
  }
  const accessToken = tokenResult.value;

  const instResult = await listInstallations(accessToken);
  if (!instResult.ok) {
    const r = zaptecErrorResponse(instResult.error);
    return c.json(r.body, r.code);
  }
  const rawInstallations = instResult.value.filter(
    (i): i is { Id: string; Name: string } & typeof i =>
      typeof i.Id === "string" && typeof i.Name === "string",
  );

  // Hierarchy fetch + bulk online list — both run in parallel. Failures
  // don't bring down the whole response. The bulk /api/chargers list
  // returns IsOnline per charger in one call (across all installations
  // visible to this credential), so we merge it onto each charger
  // by Zaptec UUID.
  const [hierarchies, onlineList] = await Promise.all([
    Promise.all(
      rawInstallations.map(async (i) => {
        const r = await getInstallationHierarchy(accessToken, i.Id);
        return { id: i.Id, hierarchy: r.ok ? r.value : null };
      }),
    ),
    listChargers(accessToken),
  ]);
  const hierarchyById = new Map(hierarchies.map((h) => [h.id, h.hierarchy]));
  const isOnlineById = new Map<string, boolean>();
  if (onlineList.ok) {
    for (const ch of onlineList.value) {
      if (ch.Id && typeof ch.IsOnline === "boolean") {
        isOnlineById.set(ch.Id, ch.IsOnline);
      }
    }
  }

  const installations = rawInstallations.map((i) => {
    const h = hierarchyById.get(i.Id);
    const circuits = (h?.Circuits ?? [])
      .filter((cc): cc is ZaptecHierarchyCircuit & { Id: string } => typeof cc.Id === "string")
      .map((cc) => ({
        id: cc.Id,
        name: cc.Name ?? "(unnamed circuit)",
        maxCurrent: cc.MaxCurrent ?? null,
        isActive: cc.IsActive ?? true,
        chargers: (cc.Chargers ?? [])
          .filter((ch): ch is ZaptecHierarchyCharger & { Id: string } => typeof ch.Id === "string")
          .map((ch) => ({
            id: ch.Id,
            name: ch.Name ?? "(unnamed charger)",
            serialNo: ch.SerialNo ?? null,
            deviceId: ch.DeviceId ?? null,
            mid: ch.MID ?? null,
            active: ch.Active ?? null,
            isOnline: isOnlineById.get(ch.Id) ?? null,
          })),
      }));

    const chargerCount =
      i.ActiveChargerCount ?? circuits.reduce((sum, cc) => sum + cc.chargers.length, 0);

    return {
      id: i.Id,
      name: i.Name,
      address:
        [i.Address, i.City, i.ZipCode].filter((s): s is string => !!s).join(", ") || null,
      activeChargerCount: chargerCount,
      maxCurrent: i.MaxCurrent ?? null,
      timezone: i.TimeZoneIanaName ?? null,
      circuits,
    };
  });

  return c.json({ installations });
});

/**
 * POST /api/admin/zaptec/inspect
 *
 * Diagnostic endpoint — uses a stored VendorCredential to query
 * Zaptec for a single installation's per-charger OCPP config. We
 * SHA-256 the OcppInitialChargePointPassword before returning so
 * the operator can compare it to our auth_secret_hash without
 * echoing the password. All other config fields (URL, auth flags)
 * are returned verbatim — they're not secrets.
 *
 * Used to verify that Zaptec's portal-side state matches our DB-
 * side expectations after the wizard runs.
 */
const InspectBody = z.object({
  credentialId: z.string().uuid(),
  zaptecInstallationId: z.string().uuid(),
});

adminZaptec.post("/inspect", async (c) => {
  const raw = (await c.req.json().catch(() => null)) as unknown;
  const parsed = InspectBody.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "validation", issues: parsed.error.issues }, 400);
  }

  const db = makePrisma(c.env);
  const creds = await unsealVendorCredentialPassword(
    db,
    parsed.data.credentialId,
    c.env.OCPP_CRED_KEK,
  ).catch((err) => ({ error: err instanceof Error ? err.message : String(err) }));
  if ("error" in creds) {
    return c.json({ error: creds.error }, 400);
  }

  const tokenResult = await getZaptecAccessToken(creds.username, creds.password);
  if (!tokenResult.ok) {
    const r = zaptecErrorResponse(tokenResult.error);
    return c.json(r.body, r.code);
  }
  const accessToken = tokenResult.value;

  const hierarchy = await getInstallationHierarchy(accessToken, parsed.data.zaptecInstallationId);
  if (!hierarchy.ok) {
    const r = zaptecErrorResponse(hierarchy.error);
    return c.json(r.body, r.code);
  }

  const chargerIds = (hierarchy.value?.Circuits ?? [])
    .flatMap((cc) => cc.Chargers ?? [])
    .map((ch) => ch.Id)
    .filter((id): id is string => typeof id === "string");

  // Fetch per-charger detail in parallel. Hash the OCPP password before
  // it leaves this Worker — never echoed in plaintext.
  const details = await Promise.all(
    chargerIds.map(async (id) => {
      const r = await getChargerDetail(accessToken, id);
      if (!r.ok || !r.value) return { chargerId: id, error: r.ok ? "no_value" : r.error.kind };
      const d = r.value;
      const password = typeof d.OcppInitialChargePointPassword === "string"
        ? d.OcppInitialChargePointPassword
        : null;
      const passwordSha256 = password ? await sha256Hex(password) : null;
      return {
        chargerId: id,
        deviceId: typeof d.DeviceId === "string" ? d.DeviceId : null,
        name: typeof d.Name === "string" ? d.Name : null,
        serialNo: typeof d.SerialNo === "string" ? d.SerialNo : null,
        propertyOcppUrl: typeof d.PropertyOcppUrl === "string" ? d.PropertyOcppUrl : null,
        propertyAuthenticationDisabled:
          typeof d.PropertyAuthenticationDisabled === "boolean"
            ? d.PropertyAuthenticationDisabled
            : null,
        isAuthorizationRequired:
          typeof d.IsAuthorizationRequired === "boolean" ? d.IsAuthorizationRequired : null,
        active: typeof d.Active === "boolean" ? d.Active : null,
        ocppPasswordPresent: password !== null && password.length > 0,
        ocppPasswordSha256: passwordSha256,
      };
    }),
  );

  return c.json({ chargers: details });
});

/**
 * POST /api/admin/zaptec/probe-users
 *
 * One-shot diagnostic: hits the Zaptec endpoints related to users
 * with access to an installation, and returns the raw responses so
 * we can see what the API actually exposes. Used during the design
 * of the agent-import flow (ADR 0014 follow-up).
 *
 * Probes (best-effort — Zaptec's portal exposes "Users" tab on each
 * installation but the API surface for this is partially documented
 * and varies by installation type):
 *   • /api/installation/{id}                  → may include UserGroups[]
 *   • /api/userGroups                         → list groups visible to credential
 *   • /api/userGroups/{groupId}               → group detail with members
 *   • /api/userGroupMemberships               → flat user×group rows
 *   • /api/users                              → users (rare, may 403)
 *   • /api/installation/{id}/users            → speculative direct path
 *   • /api/chargeHistory/users                → wild guess
 *
 * Returns the raw status + body for each probe so we can pick the
 * right shape. No side effects, admin-gated.
 */
const ProbeUsersBody = z.object({
  credentialId: z.string().uuid(),
  zaptecInstallationId: z.string().uuid(),
});

adminZaptec.post("/probe-users", async (c) => {
  const raw = (await c.req.json().catch(() => null)) as unknown;
  const parsed = ProbeUsersBody.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "validation", issues: parsed.error.issues }, 400);
  }

  const db = makePrisma(c.env);
  const creds = await unsealVendorCredentialPassword(
    db,
    parsed.data.credentialId,
    c.env.OCPP_CRED_KEK,
  ).catch((err) => ({ error: err instanceof Error ? err.message : String(err) }));
  if ("error" in creds) {
    return c.json({ error: creds.error }, 400);
  }

  const tokenResult = await getZaptecAccessToken(creds.username, creds.password);
  if (!tokenResult.ok) {
    const r = zaptecErrorResponse(tokenResult.error);
    return c.json(r.body, r.code);
  }
  const accessToken = tokenResult.value;
  const installationId = parsed.data.zaptecInstallationId;

  const probes: { path: string; status: number; body: unknown }[] = [];
  const tryGet = async (path: string) => {
    const r = await rawZaptecGet(accessToken, path);
    probes.push({ path, status: r.status, body: r.body });
    return r;
  };

  // 1) Installation detail — see if it includes UserGroups[].
  const inst = await tryGet(`/api/installation/${installationId}`);

  // 2) userGroups list, scoped by credential.
  await tryGet(`/api/userGroups`);

  // 3) Speculative direct paths.
  await tryGet(`/api/installation/${installationId}/users`);
  await tryGet(`/api/installation/${installationId}/userGroups`);

  // 4) If installation detail surfaced UserGroup IDs, drill into each.
  const userGroupIds: string[] = [];
  if (
    inst.status === 200 &&
    inst.body &&
    typeof inst.body === "object"
  ) {
    const b = inst.body as Record<string, unknown>;
    const candidates = [b.UserGroups, b.userGroups, b.UserGroupIds];
    for (const c of candidates) {
      if (Array.isArray(c)) {
        for (const item of c) {
          if (typeof item === "string") userGroupIds.push(item);
          else if (item && typeof item === "object") {
            const o = item as Record<string, unknown>;
            const id = o.Id ?? o.id;
            if (typeof id === "string") userGroupIds.push(id);
          }
        }
      }
    }
  }
  for (const gid of userGroupIds.slice(0, 10)) {
    await tryGet(`/api/userGroups/${gid}`);
  }

  // 5) Flat memberships endpoint, if it exists.
  await tryGet(`/api/userGroupMemberships`);

  return c.json({
    installationId,
    discoveredUserGroupIds: userGroupIds,
    probes,
  });
});

/**
 * POST /api/admin/zaptec/bulk-auth
 *
 * Cascade-toggle Zaptec's `AuthenticationRequired` flag (StateId 120)
 * across a tree scope. Operator clicks an "Auth on/off" button on
 * a row in the /sites tree → this endpoint resolves the scope to
 * every Zaptec-vendor charger underneath, unseals the org's stored
 * Zaptec credential, and POSTs /api/chargers/{id}/update in
 * parallel.
 *
 * scope.kind enum:
 *   "site"         — every charger on every installation under the site
 *   "installation" — every charger under the installation
 *   "circuit"      — every charger on the circuit
 *   "charger"      — a single charger
 *
 * Returns per-row outcomes so the UI can flash "Updated 30 / Failed 2".
 */
const BulkAuthScope = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("site"), siteId: z.string().uuid() }),
  z.object({ kind: z.literal("installation"), installationId: z.string().uuid() }),
  z.object({ kind: z.literal("circuit"), circuitId: z.string().uuid() }),
  z.object({ kind: z.literal("charger"), chargingStationId: z.string().uuid() }),
]);
const BulkAuthBody = z.object({
  scope: BulkAuthScope,
  enabled: z.boolean(),
});

adminZaptec.post("/bulk-auth", async (c) => {
  const raw = (await c.req.json().catch(() => null)) as unknown;
  const parsed = BulkAuthBody.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "validation", issues: parsed.error.issues }, 400);
  }
  const db = makePrisma(c.env);
  try {
    const result = await setZaptecAuthRequired(
      db,
      c.env.OCPP_CRED_KEK,
      parsed.data.scope as BulkScope,
      parsed.data.enabled,
    );
    return c.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "kek_unavailable") return c.json({ error: msg }, 500);
    if (msg === "zaptec_credential_missing") return c.json({ error: msg }, 400);
    if (msg === "zaptec_auth_failed") return c.json({ error: msg }, 502);
    console.error("[zaptec.bulk-auth] unhandled", { msg, scope: parsed.data.scope });
    return c.json({ error: "internal", message: msg }, 500);
  }
});

adminZaptec.post("/import", async (c) => {
  const raw = (await c.req.json().catch(() => null)) as unknown;
  const parsed = ZaptecImportInput.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "validation", issues: parsed.error.issues }, 400);
  }
  const db = makePrisma(c.env);
  try {
    const result = await importZaptecInstallation(db, parsed.data);
    return c.json(
      {
        ok: true,
        ...result,
        note: "Each ocppPassword is shown once. Set it as the OCPP Basic-Auth password on the corresponding charger; only the SHA-256 hash is stored on our side.",
      },
      201,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Surface known errors with appropriate status codes.
    if (msg.startsWith("zaptec_")) {
      return c.json({ error: msg }, 502);
    }
    if (msg === "invalid_credentials") return c.json({ error: msg }, 401);
    if (msg === "vendor_zaptec_missing" || msg === "org_not_found") {
      return c.json({ error: msg }, 400);
    }
    // Postgres unique-violation on serial_number. Most likely cause:
    // the operator re-imported a Zaptec installation without deleting
    // the previous Property + chargers first. The first matching
    // serial throws here, which collapses the whole tx — clean state.
    if (msg.includes("charging_stations_serial_number_key")) {
      return c.json(
        {
          error: "duplicate_serial",
          message:
            "One or more chargers in this Zaptec installation are already imported under a different Property. Delete the existing Property first, or deselect the duplicates in the wizard.",
        },
        409,
      );
    }
    if (msg === "installation_not_accessible") return c.json({ error: msg }, 404);
    // Anything else: log full stack + structured error fields so wrangler tail
    // surfaces the real cause instead of the generic onError 'internal'.
    console.error("[zaptec.import] unhandled", {
      message: msg,
      name: err instanceof Error ? err.name : "non-error",
      stack: err instanceof Error ? err.stack : undefined,
      input: {
        zaptecInstallationId: parsed.data.zaptecInstallationId,
        orgId: parsed.data.orgId,
      },
    });
    return c.json({ error: "import_failed", message: msg }, 500);
  }
});
