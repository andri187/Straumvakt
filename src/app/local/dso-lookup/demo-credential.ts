// The DSO/map demo credential.
//
// THIS IS NOT AUTHENTICATION. Read this before reusing any of it.
//
// `checkDemoCredential` compares two strings and returns a boolean. That
// boolean flips a React `useState` in the browser. It mints no session, sets
// no cookie, writes no storage, signs no token, and never reaches a server.
// There is nothing here to steal and nothing to replay.
//
// The reason it is safe to ship a hardcoded credential at all is that this
// worktree has no server-side credential path to attach it to: session
// minting lives on the external API worker, and the local screens are gated
// by STRAUMVAKT_LOCAL_PRODUCT_PREVIEW. This function must never be imported
// by anything that issues a session.
//
// HONEST LIMIT ON THE GATE. The environment-flag guard is a RUNTIME check,
// not a build-time exclusion. The route, this file, and the literal string
// "map" are compiled into a production build; the flag only stops the page
// rendering. That is exactly why the credential is designed to grant
// nothing — the defence is that there is no privilege behind the door, not
// that the door is hidden.

/** Demo username. Compared case-insensitively. */
export const DEMO_USERNAME = "DSO";

/** Demo password. Grants access to a local, read-only, fixture-backed screen. */
export const DEMO_PASSWORD = "map";

/**
 * True when the demo credential matches.
 *
 * Not constant-time, and deliberately so: a timing side channel is only
 * meaningful when the secret protects something, and this one protects a
 * screen whose entire contents are already in the JavaScript bundle the
 * caller downloaded. Pretending otherwise by using a constant-time compare
 * would imply a security property this does not have.
 */
export function checkDemoCredential(username: string, password: string): boolean {
  if (typeof username !== "string" || typeof password !== "string") return false;
  return username.trim().toUpperCase() === DEMO_USERNAME && password === DEMO_PASSWORD;
}

/** Shown next to the login field so nobody mistakes this for a real account. */
export const DEMO_CREDENTIAL_WARNING =
  "Local demo credential. It unlocks a fixture-backed screen on this machine only — " +
  "no account, no session, no server call.";
