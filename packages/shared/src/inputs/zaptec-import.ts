import { z } from "zod";

// POST /api/admin/zaptec/import — provision a Zaptec installation
// (and its chargers) into Straumvakt in one transaction. Operator
// picks the org; property + site names come from operator input
// (Zaptec doesn't have great defaults). Username/password are
// re-validated server-side; the OAuth refresh token is then minted
// fresh so the import endpoint isn't dependent on the discover step's
// short-lived access token.

export const ZaptecImportInput = z.object({
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(200),
  zaptecInstallationId: z.string().uuid(),
  orgId: z.string().uuid(),
  propertyDisplayName: z.string().min(1).max(120),
  siteDisplayName: z.string().min(1).max(120),
  // Installation-level OCPP Basic-Auth password — the value the
  // Zaptec portal uses to authenticate every charger in this
  // installation. Operator pastes it here from the Zaptec UI; we
  // SHA-256 it once and store the same hash on every OcppIdentity
  // row created by the import. Per-charger passwords would require
  // Zaptec API write automation we don't have yet.
  ocppPassword: z.string().min(1).max(200),
});
export type ZaptecImportInput = z.infer<typeof ZaptecImportInput>;
