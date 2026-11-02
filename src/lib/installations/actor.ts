// Who is acting, and what they may touch.
//
// The only login that exists in the CPO shell is the shared Straumvakt account.
// It is represented as exactly that: a `shared_login` actor, never a user id
// and never the on-site electrician. The server derives it from the verified
// signed session; no client-supplied actor, organisation or tenant field
// confers authority.

export type Actor = {
  kind: "shared_login";
  /** Honest label stored in change history, e.g. `shared login "Straumvakt"`. */
  label: string;
  /** Platform operator: may administer records of any CPO organisation. */
  platformOperator: true;
};

export function sharedLoginActor(username: string): Actor {
  return { kind: "shared_login", label: `shared login "${username}"`, platformOperator: true };
}

/**
 * Explicit server policy. Today the single shared account administers every
 * organisation as the platform operator; when per-CPO accounts exist this is
 * the one place that narrows to the actor's own organisations.
 */
export function mayAdminister(actor: Actor, _orgId: string): boolean {
  return actor.kind === "shared_login" && actor.platformOperator === true;
}

/**
 * The permission component of every shared cache and cooldown key. Today there is one permission scope (the platform
 * operator); when per-CPO accounts exist this is the ONE place that must return a key that differs between actors whose
 * visible data differs (e.g. the sorted organisation set), so no cache entry, repair or cooldown is ever shared across them.
 */
export function permissionScopeKey(actor: Actor): string {
  return actor.platformOperator === true ? "platform-operator" : "none";
}

/** Cooldowns are per actor within a permission scope. */
export function permissionPartition(actor: Actor): string {
  return `${permissionScopeKey(actor)}|${actor.label}`;
}
