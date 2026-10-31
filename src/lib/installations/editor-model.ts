// Pure rules behind the installation editor, kept out of the React component so
// they are tested directly. Dependency-free: the editor is a client component and
// must not pull the server validation schema (zod) into the browser bundle.
//
// Nothing here is a charging or load-control rule. The allowance wording is
// presentation: the conservative treatment of a missing rating (no allowance)
// lives in ./model effectiveAllowanceAmps and is unchanged.

/** Mirrors MIN_PASSWORD_LENGTH in ./model; a test keeps the two equal. */
export const EDITOR_MIN_PASSWORD = 12;

/** "" = unknown (null). "0" = a deliberately entered zero. Anything else must be a whole number. */
export function parseAmps(s: string): { value: number | null; bad: boolean } {
  const t = s.trim();
  if (t === "") return { value: null, bad: false };
  if (!/^\d{1,4}$/.test(t)) return { value: null, bad: true };
  return { value: Number(t), bad: false };
}

/**
 * What a circuit may draw, as shown. A rating left empty anywhere on the path is "not specified" — never a measured
 * or enforced "0 A". A zero the operator typed is shown as the zero it is.
 */
export function allowanceText(chain: readonly (number | null)[]): string {
  for (const r of chain) if (r === null) return "Capacity not specified";
  return `${Math.min(...(chain as number[]))} A`;
}

export type PasswordAction = { action: "keep" } | { action: "none" } | { action: "set"; value: string };

/**
 * The one password field, as the save request needs it.
 * - New installation: empty is a deliberate "no password" (never left unset); text sets it.
 * - Existing installation: empty KEEPS what is stored; text replaces it; removal happens only through the explicit
 *   remove action, so an ordinary edit cannot switch protection off.
 */
export function passwordAction(f: { isNew: boolean; value: string; removing: boolean }): PasswordAction {
  if (f.value !== "") return { action: "set", value: f.value };
  if (f.isNew) return { action: "none" };
  return f.removing ? { action: "none" } : { action: "keep" };
}

/**
 * Checked when creating or saving. `pending` is a resumed draft that had a password typed when it was saved: that value
 * is never stored, so it is asked for again rather than silently turned into "no password".
 */
export function passwordProblem(f: { value: string; pending: boolean }): string | null {
  if (f.value === "") return f.pending ? "You had chosen a password before saving this draft. Enter it again, or continue without one." : null;
  return f.value.length < EDITOR_MIN_PASSWORD ? `At least ${EDITOR_MIN_PASSWORD} characters` : null;
}

/** What is stored for a draft: only that a password had been typed (or still has to be), never the value. */
export function passwordPendingForDraft(f: { value: string; pending: boolean }): boolean {
  return f.value !== "" || f.pending;
}

/**
 * Unsaved work: the form differs from the last saved state, or a password has been typed. A typed password is never
 * kept by any save of the draft, so it always counts as unsaved.
 */
export function isDirty(f: { baseline: string; current: string; passwordTyped: boolean }): boolean {
  return f.current !== f.baseline || f.passwordTyped;
}

/** Same-site, same-tab, unmodified link clicks are the ones the leave guard can and should stop. */
export function isGuardedClick(e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean }, link: { target: string; download: boolean; href: string }, here: { origin: string; pathname: string; search: string }): boolean {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  if ((link.target && link.target !== "_self") || link.download) return false;
  let url: URL;
  try {
    url = new URL(link.href, here.origin);
  } catch {
    return false;
  }
  if (url.origin !== here.origin) return false; // the browser's own unload prompt covers leaving the site
  return !(url.pathname === here.pathname && url.search === here.search);
}

// ── Main protective device type ───────────────────────────────────────────
// Stored as free text (so existing values survive). The form offers broad categories only; they are not an exhaustive
// hardware list and not advice on choosing protection. Only an exact match becomes a category; anything else shows as
// "Other" with the stored text kept word for word.

export type DeviceKind = "" | "breaker" | "fuse" | "other";
export const DEVICE_TYPE_TEXT = { breaker: "Circuit breaker", fuse: "Fuse", other: "Other" } as const;

export function deviceTypeChoice(stored: string): { kind: DeviceKind; custom: string } {
  if (stored === "") return { kind: "", custom: "" };
  if (stored === DEVICE_TYPE_TEXT.breaker) return { kind: "breaker", custom: "" };
  if (stored === DEVICE_TYPE_TEXT.fuse) return { kind: "fuse", custom: "" };
  return { kind: "other", custom: stored === DEVICE_TYPE_TEXT.other ? "" : stored };
}

/** The text that is stored. "Other" with no description is the word "Other"; nothing is invented for "not specified". */
export function deviceTypeValue(kind: DeviceKind, custom: string): string {
  if (kind === "") return "";
  if (kind === "other") return custom.trim() || DEVICE_TYPE_TEXT.other;
  return DEVICE_TYPE_TEXT[kind];
}

/**
 * A NEW rating field starts at the literal 0 (a configured zero allowance, never measured or enforced current). If such a
 * field is emptied it goes back to 0 instead of quietly becoming "unknown". Fields that did not start as the default
 * (existing records, resumed drafts) are never touched, so unknown stays unknown there.
 */
export function zeroIfBlank(value: string, startedAsDefault: boolean): string {
  return startedAsDefault && value.trim() === "" ? "0" : value;
}
