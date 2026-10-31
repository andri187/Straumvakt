// Types for vendor-read.mjs. The module is plain JavaScript so that the local diagnostic (Node, no build step) and the
// Worker share one implementation; these declarations are what the TypeScript side sees.
//
// Package contents are `unknown` on purpose: the caller must validate them (vendor-import.ts parseVendorPackage) before use.

export type Fetcher = typeof fetch;

export const USER_AGENT: string;
export const EASEE_UPSTREAM: string;

export function firstText(...values: unknown[]): string | null;
export function shapeOf(value: unknown): string[] | null;

export class CheckError extends Error {
  status: number;
  retryAfter: number | null;
  constructor(message: string, status?: number, retryAfter?: number | null);
}

export function retryAfterSeconds(response: Response): number | null;
export function oauthCode(response: Response): Promise<string | null>;
export function failure(
  stage: string,
  status: number,
  options?: { retryAfter?: number | null; code?: string | null; label?: string },
): CheckError;

/** One row of a vendor's account inventory. `id` may be empty when the vendor row named no usable id. */
export type InventoryRow = { id: string; name: string; roles: number | null; activeChargerCount: number | null };
export type Inventory = { installations: InventoryRow[]; shape: string[] | null; more: boolean };
export type KeptToken = { accessToken: string; expiresIn: number | null };

export type EaseeConnection = Inventory & {
  authenticated: true;
  vendor: "easee";
  unverified: true;
  claims: string[] | null;
  claimsPresent: boolean;
  limit: number;
  tokenShape: string[] | null;
  expiresIn: number | null;
};

export function readEaseeInventory(accessToken: string, fetcher?: Fetcher): Promise<Inventory>;
export function checkEaseeConnection(
  input: { username?: unknown; password?: unknown },
  fetcher?: Fetcher,
  keep?: ((token: KeptToken) => void) | null,
): Promise<EaseeConnection>;
export function readEaseeSiteAccess(accessToken: string, siteId: string, fetcher?: Fetcher): Promise<Record<string, unknown>>;
export function buildEaseeSitePackage(row: unknown, capturedAt?: Date): Record<string, unknown>;
export function readEaseeSitePackage(
  accessToken: string,
  siteId: string,
  fetcher?: Fetcher,
): Promise<{ installationId: string; vendor: "easee"; package: unknown; circuitCount: number; equipmentCount: number }>;

export const ZAPTEC_UPSTREAM: string;
export type ZaptecConnection = Inventory & {
  authenticated: true;
  limit: number;
  expiresIn: number | null;
};
export function readZaptecInventory(accessToken: string, fetcher?: Fetcher): Promise<Inventory>;
export function checkZaptecConnection(
  input: { username?: unknown; password?: unknown },
  fetcher?: Fetcher,
  keep?: ((token: KeptToken) => void) | null,
): Promise<ZaptecConnection>;
export function readZaptecInstallationAccess(accessToken: string, installationId: string, fetcher?: Fetcher): Promise<Record<string, unknown>>;
export function buildZaptecSitePackage(detail: unknown, hierarchy: unknown, capturedAt?: Date): Record<string, unknown>;
export function readZaptecSitePackage(
  accessToken: string,
  installationId: string,
  fetcher?: Fetcher,
): Promise<{ installationId: string; vendor: "zaptec"; package: unknown; circuitCount: number; equipmentCount: number }>;
