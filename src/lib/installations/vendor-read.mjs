// Vendor reads shared by the authenticated product (vendor-onboarding.ts) and the local operator diagnostic
// (tools/zaptec-test/connection-check.mjs). One implementation, so the diagnostic and the product cannot drift.
//
// Worker-safe on purpose: only fetch, AbortSignal and URLSearchParams. No node: imports, no filesystem, no process state,
// no module-level session or token. Every function takes the access token it should use and returns plain data; the
// token is never part of a returned value, so it cannot reach a page, a response or a log through this module.
//
// Read-only. The only POST is the vendor's own sign-in. Hosts are fixed constants: nothing here accepts an upstream URL
// from a caller, redirects are refused, and each request has a hard timeout. There are no retries; a 429 is reported
// with the vendor's Retry-After so that the caller can stop.
//
// Easee content is UNVERIFIED against a live account beyond the 2026-10-31 site-list/site-detail observations recorded in
// docs/reference/integrations/easee.md; output marks itself unverified.

export const USER_AGENT = 'Straumvakt-LocalConnectionCheck/1.0';
export const EASEE_UPSTREAM = 'https://api.easee.com';
const ua = USER_AGENT;

export const firstText = (...values) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
};

// Key NAMES only, never values: schema, not data. When a vendor response does not carry what the
// reference says it should, the names it does carry are the whole diagnosis, and guessing again
// costs another sign-in attempt.
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
export const shapeOf = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const names = Object.keys(value).filter(name => FIELD_NAME.test(name)).sort();
  return names.length ? names.slice(0, 60) : null;
};

export class CheckError extends Error {
  constructor(message, status = 502, retryAfter = null) { super(message); this.status = status; this.retryAfter = retryAfter; }
}

// A vendor documents 429 with Retry-After. Reporting the number turns "wait a bit" into a clock,
// and the caller reuses it to refuse attempts that would only deepen the limit.
export function retryAfterSeconds(response) {
  const raw = response.headers?.get?.('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0 && seconds <= 86_400) return Math.ceil(seconds);
  const when = Date.parse(raw);
  return Number.isFinite(when) ? Math.min(86_400, Math.max(0, Math.ceil((when - Date.now()) / 1000))) : null;
}

// OAuth error codes are a fixed, non-secret vocabulary and they are the difference between
// "wrong password", "this account may not use the password grant" and "this account needs MFA".
// Only a bare code that matches this shape is surfaced: never error_description, which can echo
// the submitted username, and never any other part of the body.
const OAUTH_CODE = /^[a-z][a-z0-9_.:-]{2,39}$/;
export async function oauthCode(response) {
  try {
    const body = await response.json();
    const code = body?.error ?? body?.Error;
    return typeof code === 'string' && OAUTH_CODE.test(code) ? code : null;
  } catch { return null; }
}

// `label` is the vendor's display name; Zaptec is the default only because the diagnostic's Zaptec reads predate it.
export function failure(stage, status, { retryAfter = null, code = null, label = 'Zaptec' } = {}) {
  if (status === 429) {
    const wait = retryAfter === null ? 'Wait before trying again.' : `Wait ${retryAfter} second${retryAfter === 1 ? '' : 's'} before trying again.`;
    return new CheckError(`${label} is rate limiting requests. ${wait}`, 429, retryAfter);
  }
  if (status === 401 || status === 400 && stage === 'Sign-in') {
    return new CheckError(`${label} did not accept this sign-in${code ? ` (${code})` : ''}. Check the account credentials.`, 401);
  }
  if (status === 403) return new CheckError('This account does not have permission for the requested installation read.', 403);
  return new CheckError(`${stage} failed (${label} HTTP ${status}). No charger settings were changed.`);
}

// ---------------------------------------------------------------------------------------------
// Easee. Easee's "Site" sits where Zaptec's "Installation" does.
const LABEL = 'Easee';

const easeeCredentials = input => {
  // userName accepts an email or +<country>-<phone>, so this is not validated as an email.
  if (typeof input?.username !== 'string' || typeof input?.password !== 'string' ||
      !input.username.trim() || !input.password || input.username.length > 320 || input.password.length > 1024) {
    throw new CheckError('Enter the account user name and password.', 400);
  }
  return { userName: input.username.trim(), password: input.password };
};

// A site's charger count is not documented for the list response, so it is derived only from what
// the row actually carries and stays unknown otherwise. Never guessed, never defaulted to zero.
function easeeChargerCount(row) {
  const stated = row.chargerCount ?? row.ChargerCount;
  if (Number.isSafeInteger(stated) && stated >= 0) return stated;
  const circuits = row.circuits ?? row.Circuits;
  if (!Array.isArray(circuits)) return null;
  let total = 0;
  for (const circuit of circuits) {
    const chargers = circuit?.chargers ?? circuit?.Chargers;
    if (!Array.isArray(chargers)) return null;
    total += chargers.length;
  }
  return total;
}

const authHeaders = accessToken => ({ Authorization: `Bearer ${accessToken}`, 'user-agent': ua, accept: 'application/json' });

// One bounded read of the sites this token can see. No global charger-list read: a real account's charger rows name no
// site, so that list cannot supply a per-site count. A site's count comes from its own detail, read only for a site the
// operator selects.
export async function readEaseeInventory(accessToken, fetcher = fetch) {
  if (typeof accessToken !== 'string' || !accessToken) throw new CheckError('Connect to Easee first.', 403);
  const sites = await fetcher(`${EASEE_UPSTREAM}/api/sites`, {
    redirect: 'error', signal: AbortSignal.timeout(15_000), headers: authHeaders(accessToken),
  });
  if (!sites.ok) throw failure('Site read', sites.status, { retryAfter: retryAfterSeconds(sites), label: LABEL });
  const raw = await sites.json();
  const rows = Array.isArray(raw) ? raw : (raw?.Data ?? raw?.data);
  if (!Array.isArray(rows)) throw new CheckError('Easee returned an unexpected site list.');
  const installations = rows.slice(0, 50).map(row => ({
    id: (firstText(row.id, row.siteId, row.Id) ?? '').slice(0, 100),
    // siteKey before the generic fallback: a real Easee site came back with an empty name.
    name: (firstText(row.name, row.siteName, row.Name, row.siteKey, row.SiteKey) ?? 'Unnamed site').slice(0, 200),
    roles: null,
    activeChargerCount: easeeChargerCount(row),
  }));
  return { installations, shape: shapeOf(rows[0]), more: rows.length >= 50 };
}

// `keep` receives the access token so a follow-up read can reuse it. The token is never part of the returned result.
export async function checkEaseeConnection(input, fetcher = fetch, keep = null) {
  const credentials = easeeCredentials(input);
  const auth = await fetcher(`${EASEE_UPSTREAM}/api/accounts/login`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': ua },
    body: JSON.stringify(credentials),
  });
  if (!auth.ok) throw failure('Sign-in', auth.status, { retryAfter: retryAfterSeconds(auth), code: await oauthCode(auth), label: LABEL });
  const token = await auth.json();
  const accessToken = token.accessToken ?? token.AccessToken;
  if (typeof accessToken !== 'string' || !accessToken) throw new CheckError('Easee returned no usable access token.');
  const expiresIn = Number.isFinite(token.expiresIn) && token.expiresIn > 0 ? token.expiresIn : null;
  if (keep) keep({ accessToken, expiresIn });
  // accessClaims decides whether this account is usable at all: Easee's terms bar a User-claim
  // account from monetising, so a CPO integration needs Partner. Surfaced, never acted on here.
  const rawClaims = token.accessClaims ?? token.AccessClaims;
  const claims = Array.isArray(rawClaims)
    ? rawClaims.map(claim => firstText(claim, claim?.name, claim?.type, claim?.value))
        .filter(claim => typeof claim === 'string' && /^[\w .:\/-]{1,64}$/.test(claim)).slice(0, 12)
    : null;
  // Distinguishes "the field was missing" from "the field was there and empty", which are
  // different findings about the account.
  const claimsPresent = rawClaims !== undefined && rawClaims !== null;
  const inventory = await readEaseeInventory(accessToken, fetcher);
  return { authenticated: true, vendor: 'easee', unverified: true, claims, installations: inventory.installations, limit: 50,
    claimsPresent, shape: inventory.shape, tokenShape: shapeOf(token),
    more: inventory.more, expiresIn };
}

export async function readEaseeSiteAccess(accessToken, siteId, fetcher = fetch) {
  if (typeof accessToken !== 'string' || !accessToken) throw new CheckError('Check the account again before reading driver access.', 403);
  if (typeof siteId !== 'string' || !/^[0-9A-Za-z_-]{1,64}$/.test(siteId)) throw new CheckError('Choose one of the listed sites.', 400);
  const detail = await fetcher(`${EASEE_UPSTREAM}/api/sites/${encodeURIComponent(siteId)}`, {
    redirect: 'error', signal: AbortSignal.timeout(15_000), headers: authHeaders(accessToken),
  });
  if (!detail.ok) throw failure('Driver access read', detail.status, { retryAfter: retryAfterSeconds(detail), label: LABEL });
  const row = await detail.json();
  // Our reference documents the site-detail endpoint but NO site-users endpoint, so no such URL is
  // invented here. The grant list is taken from the detail response only if it actually carries
  // one, under any of the names the community library and Easee's own responses have used. When it
  // carries none, `listed` is false and the page says the grants could not be established.
  const rows = [row?.users, row?.siteUsers, row?.userRoles, row?.accessUsers, row?.members].find(Array.isArray) ?? null;
  // The site detail does carry circuits, unlike the site list, so this is where a real charger
  // count comes from. A circuit without a charger array leaves the count unknown, never zero.
  const circuits = Array.isArray(row?.circuits) ? row.circuits : null;
  let chargerCount = circuits ? 0 : null;
  if (circuits) for (const circuit of circuits) {
    const chargers = circuit?.chargers ?? circuit?.Chargers;
    if (!Array.isArray(chargers)) { chargerCount = null; break; }
    chargerCount += chargers.length;
  }
  // Easee's access story on a site is userRole / levelOfAccess / accessMode, not a user list.
  const role = firstText(row?.userRole, row?.levelOfAccess);
  const accessMode = firstText(row?.accessMode);
  // Capability areas only, no values: what this response would let an adapter do next.
  const carries = [];
  if (circuits) carries.push('circuits');
  if (Array.isArray(row?.equalizers) && row.equalizers.length) carries.push('equalizers');
  if (row?.ratedCurrent != null || row?.maxAllocatedCurrent != null) carries.push('capacity limits');
  if (row?.costPerKWh != null || row?.costModel != null) carries.push('tariff and VAT');
  if (row?.siteType != null || row?.siteCategory != null) carries.push('site type');
  const drivers = (rows ?? []).slice(0, 200).map(user => {
    const tokens = user?.rfids ?? user?.tokens ?? user?.keys ?? user?.rfidTokens;
    return {
      name: (firstText(user?.name, user?.fullName, user?.userName, user?.user?.name) ?? '').slice(0, 200) || null,
      email: (firstText(user?.email, user?.userEmail, user?.user?.email) ?? '').slice(0, 320) || null,
      // Count only, for the same reason as Zaptec: a tag value authorises a session.
      tokenCount: Array.isArray(tokens) ? tokens.length : null,
    };
  });
  return {
    installationId: siteId, vendor: 'easee', unverified: true, shape: shapeOf(row),
    chargerCount, role, accessMode, carries,
    // Easee exposes authorisation as per-charger observations (config_authorizationRequired, 42),
    // not as a site-level flag, so nothing site-wide is claimed here.
    authenticationType: null, authorizationRequired: null,
    drivers, driverCount: drivers.length, listed: rows !== null, more: rows !== null && rows.length > 200,
  };
}

// ---------------------------------------------------------------------------------------------
// Import package for ONE selected Easee site. Read-only (one GET of the site detail) and built by
// explicit field extraction, so nothing outside this allowlist can leave this module: no raw
// response, no contact details (contactInfo), tariff or VAT, installer/partner ids, support data,
// driver list, token or password. Names of the fields that were present are kept (never values) so
// that missing data stays visible as missing. The package is versioned and is validated again,
// as untrusted input, by src/lib/installations/vendor-import.ts before anything is saved.
//
// Field names below follow docs/reference/integrations/easee.md (Site / Circuit / Charger) and the
// live site-detail field list recorded on 2026-10-31. The per-phase limit names are NOT confirmed
// against a live response: when absent they stay null and the package says so in notCaptured.
const toAmps = value => (Number.isInteger(value) && value >= 0 && value <= 5000 ? value : null);
const asRef = value => { const text = firstText(value); return text && /^[0-9A-Za-z_.:-]{1,100}$/.test(text) ? text : null; };
const asSerial = value => { const text = firstText(value); return text && /^[0-9A-Za-z._-]{3,80}$/.test(text) ? text : null; };
const phaseTriple = (row, stem) => {
  const values = ['P1', 'P2', 'P3'].map(phase => toAmps(row?.[stem + phase]));
  return values.some(value => value !== null) ? values : null;
};
const PACKAGE_NOT_CAPTURED = [
  'site users and driver access',
  'per-charger configuration (authorisation, offline behaviour, phase mode)',
  'what each equalizer measures',
  'live state and measurements',
  'charger OCPP identities',
];

export function buildEaseeSitePackage(row, capturedAt = new Date()) {
  const siteRef = asRef(row?.id ?? row?.siteId);
  if (!siteRef) throw new CheckError('Easee returned a site without a usable reference.');
  const notCaptured = [...PACKAGE_NOT_CAPTURED];
  const fields = new Set(shapeOf(row) ?? []);
  const circuitsRaw = Array.isArray(row.circuits) ? row.circuits : null;
  if (!circuitsRaw) notCaptured.push('circuits (the site detail carried none)');
  const circuits = [], equipment = new Map();
  let limitsSeen = false, truncated = false;
  for (const circuit of (circuitsRaw ?? []).slice(0, 200)) {
    const circuitRef = asRef(circuit?.id ?? circuit?.circuitId);
    if (!circuitRef) { truncated = true; continue; }
    for (const name of shapeOf(circuit) ?? []) fields.add('circuits.' + name);
    const limits = {
      maxCircuitCurrent: phaseTriple(circuit, 'maxCircuitCurrent'),
      offlineMaxCircuitCurrent: phaseTriple(circuit, 'offlineMaxCircuitCurrent'),
      dynamicCircuitCurrent: phaseTriple(circuit, 'dynamicCircuitCurrent'),
    };
    if (Object.values(limits).some(Boolean)) limitsSeen = true;
    const chargerRefs = [];
    const chargers = circuit.chargers ?? circuit.Chargers;
    for (const charger of (Array.isArray(chargers) ? chargers : []).slice(0, 100)) {
      const chargerRef = asRef(charger?.id ?? charger?.chargerId);
      if (!chargerRef) { truncated = true; continue; }
      for (const name of shapeOf(charger) ?? []) fields.add('chargers.' + name);
      chargerRefs.push(chargerRef);
      if (equipment.size < 500 && !equipment.has(chargerRef)) {
        equipment.set(chargerRef, {
          ref: chargerRef,
          name: (firstText(charger?.name) ?? '').slice(0, 120) || null,
          circuitRef,
          productCode: (firstText(charger?.productCode) ?? '').slice(0, 40) || null,
          // As reported. For Easee this is the master BACK-PLATE id, which is not asserted to equal any charger id.
          masterRef: asRef(charger?.backPlate?.masterBackPlateId ?? charger?.masterBackPlateId),
          // Only an explicit serial field. The vendor charger id is NOT promoted to a serial here; where a vendor call needs a
          // serial and none was reported, the commissioning step says so instead of assuming one.
          serialNumber: asSerial(charger?.serialNumber ?? charger?.serial),
        });
      } else if (!equipment.has(chargerRef)) truncated = true;
    }
    circuits.push({
      ref: circuitRef,
      parentRef: asRef(circuit?.parentCircuitId),
      name: (firstText(circuit?.panelName, circuit?.name) ?? '').slice(0, 120) || null,
      ratedCurrentAmps: toAmps(circuit?.ratedCurrent),
      use3Phase: typeof circuit?.use3Phase === 'boolean' ? circuit.use3Phase : null,
      limits,
      chargerRefs,
    });
  }
  if (circuitsRaw && !limitsSeen) notCaptured.push('per-phase circuit limits (not present in the site detail)');
  if (truncated || (circuitsRaw?.length ?? 0) > 200) notCaptured.push('some circuits or chargers (import limit or unusable reference)');
  const address = row.address && typeof row.address === 'object' ? row.address : null;
  const line = [firstText(address?.street, address?.streetName, address?.line), firstText(address?.buildingNumber)].filter(Boolean).join(' ');
  const place = address ? {
    line: line.slice(0, 200) || null,
    city: (firstText(address.city, address.area) ?? '').slice(0, 100) || null,
    postalCode: (firstText(address.zip, address.zipCode, address.postalCode) ?? '').slice(0, 20) || null,
    country: (firstText(address.country, address.countryCode) ?? '').slice(0, 60) || null,
  } : null;
  const equalizers = (Array.isArray(row.equalizers) ? row.equalizers : []).slice(0, 50)
    .map(item => ({ ref: asRef(item?.id ?? item?.equalizerId), name: (firstText(item?.name) ?? '').slice(0, 120) || null }))
    .filter(item => item.ref);
  return {
    kind: 'straumvakt-vendor-site', version: 1, vendor: 'easee', capturedAt: capturedAt.toISOString(),
    site: {
      ref: siteRef,
      name: (firstText(row.name, row.siteName) ?? '').slice(0, 200) || null,
      siteKey: (firstText(row.siteKey) ?? '').slice(0, 100) || null,
      siteType: (firstText(row.siteType) ?? '').slice(0, 40) || null,
      siteCategory: (firstText(row.siteCategory) ?? '').slice(0, 40) || null,
      accessMode: (firstText(row.accessMode) ?? '').slice(0, 40) || null,
      address: place && Object.values(place).some(Boolean) ? place : null,
      // Vendor-reported ceilings. Retained as reported; never taken as the physical breaker rating by this module.
      ratedCurrentAmps: toAmps(row.ratedCurrent),
      maxAllocatedCurrentAmps: toAmps(row.maxAllocatedCurrent),
      useDynamicMaster: typeof row.useDynamicMaster === 'boolean' ? row.useDynamicMaster : null,
    },
    circuits, equipment: [...equipment.values()], equalizers,
    fieldsObserved: [...fields].filter(name => /^[A-Za-z][A-Za-z0-9_.]{0,59}$/.test(name)).sort().slice(0, 120),
    notCaptured,
  };
}

export async function readEaseeSitePackage(accessToken, siteId, fetcher = fetch) {
  if (typeof accessToken !== 'string' || !accessToken) throw new CheckError('Check the account again before reading a site.', 403);
  if (typeof siteId !== 'string' || !/^[0-9A-Za-z_-]{1,64}$/.test(siteId)) throw new CheckError('Choose one of the listed sites.', 400);
  const detail = await fetcher(`${EASEE_UPSTREAM}/api/sites/${encodeURIComponent(siteId)}`, {
    redirect: 'error', signal: AbortSignal.timeout(15_000), headers: authHeaders(accessToken),
  });
  if (!detail.ok) throw failure('Site read', detail.status, { retryAfter: retryAfterSeconds(detail), label: LABEL });
  const built = buildEaseeSitePackage(await detail.json());
  // The response must be the site that was asked for: a different one is never offered for import.
  if (built.site.ref !== siteId) throw new CheckError('Easee returned a different site than the one requested.', 502);
  return { installationId: siteId, vendor: 'easee', package: built, circuitCount: built.circuits.length, equipmentCount: built.equipment.length };
}

// ---------------------------------------------------------------------------------------------
// Zaptec. Moved here from the local diagnostic (tools/zaptec-test/connection-check.mjs), which now imports these.
// Same rules as above: fixed host, no retries, token never returned. Field names follow docs/reference/integrations/zaptec.md
// (core API, 2026-04 snapshot) and the 2026-10-31 public-documentation review; nothing here is a new live observation.
export const ZAPTEC_UPSTREAM = 'https://api.zaptec.com';
const ZAPTEC = 'Zaptec';
const zaptecHeaders = accessToken => ({ Authorization: `Bearer ${accessToken}`, 'user-agent': ua, accept: 'application/json' });
const ZAPTEC_ID = /^[0-9a-fA-F-]{10,100}$/;

export async function readZaptecInventory(accessToken, fetcher = fetch) {
  if (typeof accessToken !== 'string' || !accessToken) throw new CheckError('Connect to Zaptec first.', 403);
  // Exactly one bounded inventory read. It establishes account visibility, not CPO ownership.
  const inventory = await fetcher(`${ZAPTEC_UPSTREAM}/api/installation?PageSize=50&PageIndex=0`, {
    redirect: 'error', signal: AbortSignal.timeout(15_000), headers: zaptecHeaders(accessToken),
  });
  if (!inventory.ok) throw failure('Installation read', inventory.status, { retryAfter: retryAfterSeconds(inventory) });
  const raw = await inventory.json();
  const rows = raw.Data ?? raw.data;
  if (!Array.isArray(rows)) throw new CheckError('Zaptec returned an unexpected installation list.');
  const installations = rows.slice(0, 50).map(row => ({
    id: String(row.Id ?? row.id ?? '').slice(0, 100),
    name: (firstText(row.Name, row.name) ?? 'Unnamed installation').slice(0, 200),
    roles: Number.isInteger(row.CurrentUserRoles ?? row.currentUserRoles) ? (row.CurrentUserRoles ?? row.currentUserRoles) : null,
    activeChargerCount: Number.isSafeInteger(row.ActiveChargerCount ?? row.activeChargerCount) && (row.ActiveChargerCount ?? row.activeChargerCount) >= 0 ? (row.ActiveChargerCount ?? row.activeChargerCount) : null,
  }));
  return { installations, shape: shapeOf(rows[0]), more: Number(raw.Pages ?? raw.pages) > 1 || rows.length >= 50 };
}

export async function checkZaptecConnection(input, fetcher = fetch, keep = null) {
  if (typeof input?.username !== 'string' || typeof input?.password !== 'string' ||
      !input.username.trim() || !input.password || input.username.length > 320 || input.password.length > 1024) {
    throw new CheckError('Enter the test account email and password.', 400);
  }
  const auth = await fetcher(`${ZAPTEC_UPSTREAM}/oauth/token`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': ua },
    body: new URLSearchParams({ grant_type: 'password', username: input.username.trim(), password: input.password, scope: 'openid' }),
  });
  if (!auth.ok) throw failure('Sign-in', auth.status, { retryAfter: retryAfterSeconds(auth), code: await oauthCode(auth) });
  const token = await auth.json();
  if (typeof token.access_token !== 'string' || !token.access_token) throw new CheckError('Zaptec returned no usable access token.');
  const expiresIn = Number.isFinite(token.expires_in) && token.expires_in > 0 ? token.expires_in : null;
  if (keep) keep({ accessToken: token.access_token, expiresIn: Number.isFinite(token.expires_in) ? token.expires_in : null });
  const inventory = await readZaptecInventory(token.access_token, fetcher);
  return { authenticated: true, installations: inventory.installations, limit: 50, shape: inventory.shape, more: inventory.more, expiresIn };
}

// One bounded read of the driver grants on a SINGLE chosen installation (DetailLevel=1 adds installationUsers). Not an
// access-control list on its own: authenticationType / isRequiredAuthentication decide whether it governs anything.
export async function readZaptecInstallationAccess(accessToken, installationId, fetcher = fetch) {
  if (typeof accessToken !== 'string' || !accessToken) throw new CheckError('Check the account again before reading driver access.', 403);
  if (typeof installationId !== 'string' || !ZAPTEC_ID.test(installationId)) throw new CheckError('Choose one of the listed installations.', 400);
  const detail = await fetcher(`${ZAPTEC_UPSTREAM}/api/installation/${encodeURIComponent(installationId)}?DetailLevel=1`, {
    redirect: 'error', signal: AbortSignal.timeout(15_000), headers: zaptecHeaders(accessToken),
  });
  if (!detail.ok) throw failure('Driver access read', detail.status, { retryAfter: retryAfterSeconds(detail) });
  const row = await detail.json();
  const listed = row.InstallationUsers ?? row.installationUsers;
  const rows = Array.isArray(listed) ? listed : null;
  const drivers = (rows ?? []).slice(0, 200).map(user => {
    const tokens = user.UserTokens ?? user.userTokens;
    return {
      name: String(user.UserFullName ?? user.userFullName ?? '').slice(0, 200) || null,
      email: String(user.UserEmail ?? user.userEmail ?? '').slice(0, 320) || null,
      // Count only. An RFID token value authorises a session at the charger, so it is credential material.
      tokenCount: Array.isArray(tokens) ? tokens.length : null,
    };
  });
  const mode = row.AuthenticationType ?? row.authenticationType;
  const required = row.IsRequiredAuthentication ?? row.isRequiredAuthentication;
  return {
    installationId, shape: shapeOf(row),
    // 0 Native · 1 WebHooks · 2 Ocpp · 3 OcppNative (InstallationAuthenticationType).
    authenticationType: Number.isInteger(mode) && mode >= 0 && mode <= 3 ? mode : null,
    authorizationRequired: typeof required === 'boolean' ? required : null,
    drivers, driverCount: drivers.length, listed: rows !== null, more: rows !== null && rows.length > 200,
  };
}

const ZAPTEC_NETWORK = { 1: ['IT', 1], 2: ['IT', 3], 3: ['TN', 1], 4: ['TN', 3] };

// Same versioned package as Easee's, for ONE selected Zaptec installation: two bounded GETs (installation detail for the
// network type, hierarchy for circuits and chargers). Explicit field extraction, so no contact, tariff, password, OCPP
// URL, user list or token can leave this module. The charger's physical DeviceId is carried as its serial number (the
// documented physical id); the API UUID stays the vendor reference; neither is treated as an OCPP identity.
// `MaxCurrent` is the circuit's configured operational limit, not a physical breaker rating: it is only mapped onto a
// circuit when the operator accepts the vendor's ratings, as for Easee.
export function buildZaptecSitePackage(detail, hierarchy, capturedAt = new Date()) {
  const siteRef = asRef(detail?.Id ?? detail?.id);
  if (!siteRef) throw new CheckError('Zaptec returned an installation without a usable reference.');
  const notCaptured = [
    'installation users and driver access', 'OCPP URL, passwords and default tags (not retained)',
    'per-charger settings and live state', 'charger OCPP identities',
  ];
  const fields = new Set(shapeOf(detail) ?? []);
  const network = ZAPTEC_NETWORK[detail?.NetworkType ?? detail?.networkType] ?? null;
  const circuitsRaw = Array.isArray(hierarchy?.Circuits) ? hierarchy.Circuits : Array.isArray(hierarchy?.circuits) ? hierarchy.circuits : null;
  if (!circuitsRaw) notCaptured.push('circuits (the hierarchy carried none)');
  const circuits = [], equipment = new Map();
  let truncated = false;
  for (const circuit of (circuitsRaw ?? []).slice(0, 200)) {
    const circuitRef = asRef(circuit?.Id ?? circuit?.id);
    if (!circuitRef) { truncated = true; continue; }
    for (const name of shapeOf(circuit) ?? []) fields.add('circuits.' + name);
    const chargerRefs = [];
    const chargers = circuit.Chargers ?? circuit.chargers;
    for (const charger of (Array.isArray(chargers) ? chargers : []).slice(0, 100)) {
      const chargerRef = asRef(charger?.Id ?? charger?.id);
      if (!chargerRef) { truncated = true; continue; }
      for (const name of shapeOf(charger) ?? []) fields.add('chargers.' + name);
      chargerRefs.push(chargerRef);
      if (equipment.size < 500 && !equipment.has(chargerRef)) {
        equipment.set(chargerRef, {
          ref: chargerRef,
          name: (firstText(charger?.Name, charger?.name) ?? '').slice(0, 120) || null,
          circuitRef,
          productCode: (firstText(charger?.DeviceType, charger?.deviceType) ?? '').slice(0, 40) || null,
          masterRef: null,
          // DeviceId is the documented physical id; the deprecated SerialNo/MID fields are deliberately not read.
          serialNumber: asSerial(charger?.DeviceId ?? charger?.deviceId),
        });
      } else if (!equipment.has(chargerRef)) truncated = true;
    }
    circuits.push({
      ref: circuitRef, parentRef: null,
      name: (firstText(circuit?.Name, circuit?.name) ?? '').slice(0, 120) || null,
      ratedCurrentAmps: toAmps(circuit?.MaxCurrent ?? circuit?.maxCurrent),
      use3Phase: network ? network[1] === 3 : null,
      limits: { maxCircuitCurrent: null, offlineMaxCircuitCurrent: null, dynamicCircuitCurrent: null },
      chargerRefs,
    });
  }
  if (truncated || (circuitsRaw?.length ?? 0) > 200) notCaptured.push('some circuits or chargers (import limit or unusable reference)');
  const place = {
    line: (firstText(detail?.Address, detail?.address) ?? '').slice(0, 200) || null,
    city: (firstText(detail?.City, detail?.city) ?? '').slice(0, 100) || null,
    postalCode: (firstText(detail?.ZipCode, detail?.zipCode) ?? '').slice(0, 20) || null,
    country: null,
  };
  return {
    kind: 'straumvakt-vendor-site', version: 1, vendor: 'zaptec', capturedAt: capturedAt.toISOString(),
    site: {
      ref: siteRef,
      name: (firstText(detail?.Name, detail?.name) ?? '').slice(0, 200) || null,
      siteKey: null, siteType: null, siteCategory: null, accessMode: null,
      address: Object.values(place).some(Boolean) ? place : null,
      // Vendor-reported ceilings, retained as reported; never taken as the physical breaker rating by this module.
      ratedCurrentAmps: toAmps(detail?.MaxCurrent ?? detail?.maxCurrent),
      maxAllocatedCurrentAmps: toAmps(detail?.AvailableCurrent ?? detail?.availableCurrent),
      useDynamicMaster: typeof detail?.UseLoadBalancing === 'boolean' ? detail.UseLoadBalancing : null,
      networkType: network ? `${network[0]}_${network[1]}_Phase` : null,
    },
    circuits, equipment: [...equipment.values()], equalizers: [],
    fieldsObserved: [...fields].filter(name => /^[A-Za-z][A-Za-z0-9_.]{0,59}$/.test(name)).sort().slice(0, 120),
    notCaptured,
  };
}

export async function readZaptecSitePackage(accessToken, installationId, fetcher = fetch) {
  if (typeof accessToken !== 'string' || !accessToken) throw new CheckError('Check the account again before reading an installation.', 403);
  if (typeof installationId !== 'string' || !ZAPTEC_ID.test(installationId)) throw new CheckError('Choose one of the listed installations.', 400);
  const get = async (path, stage) => {
    const response = await fetcher(`${ZAPTEC_UPSTREAM}/api/installation/${encodeURIComponent(installationId)}${path}`, {
      redirect: 'error', signal: AbortSignal.timeout(15_000), headers: zaptecHeaders(accessToken),
    });
    if (!response.ok) throw failure(stage, response.status, { retryAfter: retryAfterSeconds(response) });
    return response.json();
  };
  const detail = await get('', 'Installation read');
  const hierarchy = await get('/hierarchy', 'Hierarchy read');
  const built = buildZaptecSitePackage(detail, hierarchy);
  // The response must be the installation that was asked for: a different one is never offered for import.
  if (built.site.ref.toLowerCase() !== installationId.toLowerCase()) throw new CheckError('Zaptec returned a different installation than the one requested.', 502);
  return { installationId, vendor: 'zaptec', package: built, circuitCount: built.circuits.length, equipmentCount: built.equipment.length };
}
