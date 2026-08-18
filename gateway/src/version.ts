/**
 * Deployment identity — the version id.
 *
 * ── WHY THIS IS THE SINGLE BLOCKING RELEASE FACT ────────────────────────
 *
 * Recorded since 2026-08-11 and unchanged: no Worker records a version id, so
 * there is no rollback target, which makes every deploy a one-way door. You
 * cannot roll back to "the previous one" if nothing wrote down which one was
 * running.
 *
 * ── WHERE THE VALUE COMES FROM ──────────────────────────────────────────
 *
 * Cloudflare's `version_metadata` binding. It is populated by the platform at
 * deploy time — NOT by the build, NOT by a git hash injected at bundle time,
 * and NOT by anything a developer can set. That is exactly why it is the
 * right source: a hand-set value can be stale or wrong, and a stale version id
 * is worse than none because it is believed.
 *
 * `gateway/wrangler.jsonc` has carried the binding commented out with a note
 * that uncommenting it "changes what a deploy produces, and that needs Andri's
 * approval". That remains true and this file does not uncomment it. What this
 * file does is make the runtime half real, so that the moment the binding is
 * enabled there is something reading it — rather than discovering after the
 * deploy that the plumbing was never built.
 *
 * ── WHY NOT `/health` ───────────────────────────────────────────────────
 *
 * `/health` returns the exact bytes `ok`, and the alert policy specifies a
 * synthetic probe against it. Changing that body to JSON would silently break
 * whatever asserts on it. Deployment identity gets its own route.
 */

/** The shape Cloudflare's version_metadata binding provides. */
export interface VersionMetadata {
  id: string;
  tag?: string;
  timestamp?: string;
}

export interface VersionInfo {
  /** True when the binding is present AND carries a usable id. */
  configured: boolean;
  /** The deployed version id, or null. NEVER a placeholder or a guess. */
  versionId: string | null;
  tag: string | null;
  timestamp: string | null;
  /** Why it is not configured, when it is not. For an operator reading a curl. */
  reason: "ok" | "binding-absent" | "binding-malformed";
}

const ABSENT: VersionInfo = {
  configured: false,
  versionId: null,
  tag: null,
  timestamp: null,
  reason: "binding-absent",
};

/**
 * Read deployment identity from the environment.
 *
 * Returns `configured: false` rather than throwing or inventing a value. An
 * environment that cannot identify itself must SAY SO — the failure mode this
 * guards against is a deploy reporting a plausible-looking version that is not
 * the running one.
 */
export function versionInfo(env: unknown): VersionInfo {
  const meta = (env as { CF_VERSION_METADATA?: unknown } | null | undefined)
    ?.CF_VERSION_METADATA;
  if (meta === undefined || meta === null) return ABSENT;
  if (typeof meta !== "object") return { ...ABSENT, reason: "binding-malformed" };

  const m = meta as Partial<VersionMetadata>;
  // An id that is absent, non-string or blank is malformed, not "absent" —
  // the distinction matters because malformed means the binding IS declared
  // and something else is wrong, which is a different investigation.
  if (typeof m.id !== "string" || m.id.trim() === "") {
    return { ...ABSENT, reason: "binding-malformed" };
  }
  return {
    configured: true,
    versionId: m.id,
    tag: typeof m.tag === "string" && m.tag !== "" ? m.tag : null,
    timestamp: typeof m.timestamp === "string" && m.timestamp !== "" ? m.timestamp : null,
    reason: "ok",
  };
}

/**
 * The `/version` response body.
 *
 * Always HTTP 200, deliberately. A 5xx here would trip uptime alerting for a
 * condition that is a release-readiness problem, not an outage — the gate is
 * what fails on an unconfigured version, not the probe.
 */
export function versionResponseBody(env: unknown, service: string): string {
  const v = versionInfo(env);
  return JSON.stringify({
    service,
    versionId: v.versionId,
    tag: v.tag,
    timestamp: v.timestamp,
    configured: v.configured,
    reason: v.reason,
  });
}

/**
 * Is this environment releasable?
 *
 * Used by the post-deploy check in the runbook. Kept here rather than in the
 * gate script so the rule has exactly one definition.
 */
export function isReleasable(v: VersionInfo): boolean {
  return v.configured && typeof v.versionId === "string" && v.versionId.length > 0;
}
