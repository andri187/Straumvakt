// Route policy for the CPO shell deployment.
//
// A pure function so the whole reachable surface is unit-testable. Anything
// not listed here does not exist on this deployment: the legacy staff, org,
// demo, preview and admin-API routes stay in the source tree for local
// development but are answered with 404 and never reach a page or handler.

import { SHELL_COOKIE_NAME } from "@/lib/cpo-shell-session";

export const SHELL_HOME = "/cpo";
export const SHELL_SIGN_IN = "/signin";
export const SHELL_LOGIN_API = "/api/shell/login";
export const SHELL_LOGOUT_API = "/api/shell/logout";
// Installation management (S1). Exact paths only; each handler re-verifies the
// signed session itself, so this gate is defence in depth, not the only check.
export const SHELL_INSTALLATIONS_API = "/api/cpo/installations";
export const SHELL_DIRECTORY_API = "/api/cpo/directory";
// Snapshot + incremental changes for the installation/charger views (GET only; the handler re-verifies the session).
export const SHELL_SYNC_API = "/api/cpo/sync";
// Charger remove/retire/return (POST only; session + same-origin + organisation authority are re-checked in the handler).
export const SHELL_LIFECYCLE_API = "/api/cpo/lifecycle";
export const SHELL_DATA_APIS: readonly string[] = [SHELL_INSTALLATIONS_API, SHELL_DIRECTORY_API, SHELL_SYNC_API, SHELL_LIFECYCLE_API];

// Exact public files. The homepage artwork is served as AVIF with a WebP
// fallback; the original PNG is deliberately not part of the deployment.
// workers/cpo-shell-edge.mjs and scripts/prepare-cpo-shell-assets.mjs must
// carry the same list (checked by scripts/cpo-shell-edge.test.mjs).
export const SHELL_PUBLIC_ASSETS: readonly string[] = [
  "/icon.svg",
  "/landing/straumvakt-logo-icon.png",
  "/landing/straumvakt-car.avif",
  "/landing/straumvakt-car.webp",
  "/oem-models/easee-charge-72bf555c.webp",
  "/oem-models/zaptec-pro-1f7fbd29.webp",
  "/oem-models/alfen-eve-double-pro-line-586466c3.webp",
  "/oem-models/alfen-eve-single-pro-line-a4f78743.webp",
  "/oem-models/autel-maxicharger-ac-wallbox-f1774b29.webp",
  "/oem-models/charge-amps-aura-a9f3a303.webp",
  "/oem-models/charge-amps-dawn-9bbacca4.webp",
  "/oem-models/charge-amps-halo-bc0afd5e.webp",
  "/oem-models/charge-amps-luna-a0b003a9.webp",
  "/oem-models/nexblue-edge-9f25d218.webp",
  "/oem-models/zaptec-go-45a04b3f.webp",
];

const PUBLIC_ASSETS = new Set(SHELL_PUBLIC_ASSETS);

export type ShellRouteDecision =
  | { action: "next"; noStore: boolean }
  | { action: "redirect"; location: string }
  | { action: "unauthorized" }
  | { action: "notFound" };

export function decideShellRoute(input: {
  pathname: string;
  hasSession: boolean;
}): ShellRouteDecision {
  const { pathname, hasSession } = input;

  if (pathname.startsWith("/_next/") || PUBLIC_ASSETS.has(pathname)) {
    return { action: "next", noStore: false };
  }

  if (pathname === "/") {
    return {
      action: "redirect",
      location: hasSession ? SHELL_HOME : SHELL_SIGN_IN,
    };
  }

  if (pathname === SHELL_SIGN_IN) {
    return hasSession
      ? { action: "redirect", location: SHELL_HOME }
      : { action: "next", noStore: true };
  }

  // The handlers enforce method, origin and credentials themselves.
  if (pathname === SHELL_LOGIN_API || pathname === SHELL_LOGOUT_API) {
    return { action: "next", noStore: true };
  }

  if (SHELL_DATA_APIS.includes(pathname)) {
    // The sync handler sets its OWN cache headers on every response (snapshot:
    // `private, no-cache` + ETag so a browser may keep and revalidate it; delta:
    // `no-store`). A blanket no-store here would defeat conditional requests, so
    // it is left to the handler for that one path.
    return hasSession
      ? { action: "next", noStore: pathname !== SHELL_SYNC_API }
      : { action: "unauthorized" };
  }

  if (pathname === SHELL_HOME || pathname.startsWith(`${SHELL_HOME}/`)) {
    return hasSession
      ? { action: "next", noStore: true }
      : { action: "redirect", location: SHELL_SIGN_IN };
  }

  return { action: "notFound" };
}

/** Extracts the shell cookie from a raw Cookie header (server components). */
export function readShellCookie(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === SHELL_COOKIE_NAME) {
      return part.slice(index + 1).trim();
    }
  }
  return undefined;
}
