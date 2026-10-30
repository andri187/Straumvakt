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
