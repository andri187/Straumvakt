import { describe, expect, it } from "vitest";

import { isReleasable, versionInfo, versionResponseBody } from "./version";

describe("binding absent", () => {
  it("reports not configured rather than inventing a version", () => {
    const v = versionInfo({});
    expect(v.configured).toBe(false);
    expect(v.versionId).toBeNull();
    expect(v.reason).toBe("binding-absent");
  });

  it("handles a null or undefined env without throwing", () => {
    expect(versionInfo(undefined).configured).toBe(false);
    expect(versionInfo(null).configured).toBe(false);
  });

  it("is not releasable", () => {
    expect(isReleasable(versionInfo({}))).toBe(false);
  });
});

describe("binding present and valid", () => {
  const env = {
    CF_VERSION_METADATA: {
      id: "95f6f763-52fa-4f2d-91ea-7fe5092c58b9",
      tag: "v1",
      timestamp: "2026-08-18T00:00:00Z",
    },
  };

  it("reads the id", () => {
    expect(versionInfo(env).versionId).toBe("95f6f763-52fa-4f2d-91ea-7fe5092c58b9");
  });

  it("reads tag and timestamp", () => {
    const v = versionInfo(env);
    expect(v.tag).toBe("v1");
    expect(v.timestamp).toBe("2026-08-18T00:00:00Z");
  });

  it("is releasable", () => {
    expect(isReleasable(versionInfo(env))).toBe(true);
  });

  it("treats an absent tag as null rather than empty string", () => {
    const v = versionInfo({ CF_VERSION_METADATA: { id: "abc" } });
    expect(v.tag).toBeNull();
    expect(v.timestamp).toBeNull();
    expect(v.configured).toBe(true);
  });
});

describe("binding present but malformed", () => {
  // Distinguished from absent on purpose: malformed means the binding IS
  // declared and something else is wrong, which is a different investigation.
  it("a blank id is malformed, not configured", () => {
    const v = versionInfo({ CF_VERSION_METADATA: { id: "   " } });
    expect(v.configured).toBe(false);
    expect(v.reason).toBe("binding-malformed");
  });

  it("a missing id is malformed", () => {
    const v = versionInfo({ CF_VERSION_METADATA: { tag: "v1" } });
    expect(v.reason).toBe("binding-malformed");
  });

  it("a non-object binding is malformed", () => {
    expect(versionInfo({ CF_VERSION_METADATA: "abc" }).reason).toBe("binding-malformed");
  });

  it("a non-string id is malformed", () => {
    expect(versionInfo({ CF_VERSION_METADATA: { id: 123 } }).reason).toBe("binding-malformed");
  });

  it("malformed is never releasable", () => {
    expect(isReleasable(versionInfo({ CF_VERSION_METADATA: { id: "" } }))).toBe(false);
  });
});

describe("the /version response body", () => {
  it("is valid JSON naming the service", () => {
    const body = JSON.parse(versionResponseBody({}, "straumvakt-ocpp"));
    expect(body.service).toBe("straumvakt-ocpp");
  });

  it("reports null rather than a placeholder when unconfigured", () => {
    const body = JSON.parse(versionResponseBody({}, "straumvakt-ocpp"));
    expect(body.versionId).toBeNull();
    expect(body.configured).toBe(false);
    // The specific failure this guards: a body that says "unknown" or "dev"
    // reads like a version and would be believed.
    expect(body.versionId).not.toBe("unknown");
    expect(body.versionId).not.toBe("dev");
  });

  it("carries the id when configured", () => {
    const body = JSON.parse(
      versionResponseBody({ CF_VERSION_METADATA: { id: "abc123" } }, "straumvakt-ocpp"),
    );
    expect(body.versionId).toBe("abc123");
    expect(body.configured).toBe(true);
  });

  it("leaks no secret-shaped field", () => {
    const body = versionResponseBody(
      { CF_VERSION_METADATA: { id: "abc" }, OCPP_INGEST_SECRET: "should-not-appear" },
      "straumvakt-ocpp",
    );
    expect(body).not.toContain("should-not-appear");
    expect(body.toLowerCase()).not.toContain("secret");
  });
});

// ── fool-test ───────────────────────────────────────────────────────────

describe("FOOL — fall back to a placeholder version instead of null", () => {
  // The tempting "helpful" default. It makes /version always look answerable
  // and makes an un-rollback-able deploy indistinguishable from a good one.
  const versionFooled = (env: Record<string, unknown>) =>
    (env.CF_VERSION_METADATA as { id?: string } | undefined)?.id ?? "unknown";

  it("the fooled reader reports a version for an environment that has none", () => {
    expect(versionFooled({})).toBe("unknown");
    expect(versionFooled({})).toBeTruthy();
  });

  it("the real reader reports null and configured:false", () => {
    expect(versionInfo({}).versionId).toBeNull();
    expect(isReleasable(versionInfo({}))).toBe(false);
  });

  it("so a releasability check built on the fooled reader would pass", () => {
    expect(Boolean(versionFooled({}))).toBe(true);
    expect(isReleasable(versionInfo({}))).toBe(false);
  });
});
