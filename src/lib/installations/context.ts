// The CPO this deployment's shared login works for.
//
// The only login in the CPO shell is the shared platform account, and it belongs to no organisation. Which CPO the
// workspace is for is therefore an explicit, server-side association made OUTSIDE the installation form: the
// non-secret setting CPO_SHELL_ORG_ID names one existing CPO organisation. Nothing here guesses an organisation,
// picks the first one, or reads the association from the browser. Unset means "not associated yet", and the form
// says so instead of asking the operator to choose or create a CPO.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readContextOrgId(env: Record<string, string | undefined> = process.env): string | null {
  const v = env.CPO_SHELL_ORG_ID?.trim();
  return v && UUID.test(v) ? v.toLowerCase() : null;
}
