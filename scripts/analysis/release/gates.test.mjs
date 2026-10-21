// Fool-tests for the two release gates added 2026-08-18.
//
// Each removes exactly one guard, reimplements the check without it, and
// asserts the resulting behaviour VIOLATES the property the gate claims to
// protect — then asserts the real implementation does not.
//
// A gate whose removal breaks nothing is decoration. These are here because
// both gates were written in response to defects that survived for months
// precisely because nothing checked them.

import { describe, expect, it } from "vitest";

import { bindingsOf, checkRows, stripJsonc } from "../bindings/check-bindings.mjs";
import { evaluate, PLACEHOLDER_VERSIONS } from "./check-version-id.mjs";

const SNAP = {
  workers: [
    { name: "real-worker", exists: true },
    { name: "hlada-api", exists: false },
  ],
  queues: [{ name: "q-staging", exists: true }],
  r2Buckets: [{ name: "bucket-staging", exists: true }],
  pendingCreation: [],
};

// ── fool-test 1 ─────────────────────────────────────────────────────────

describe("FOOL 1 — check bindings by presence instead of existence", () => {
  // The defect this gate exists for: gateway/wrangler.jsonc bound MAIN_APP to
  // `hlada-api`, a Worker that has never existed. Any check that asks "is a
  // service binding declared?" passes on it — which is exactly what every
  // prior gate asked.
  const realConfig = { services: [{ binding: "MAIN_APP", service: "hlada-api" }] };

  const checkFooled = (cfg) => ({
    ok: Array.isArray(cfg.services) && cfg.services.every((s) => Boolean(s.service)),
  });

  it("the fooled check passes the exact config that shipped the defect", () => {
    expect(checkFooled(realConfig).ok).toBe(true);
  });

  it("the real gate fails it", () => {
    const { errors } = checkRows(bindingsOf(realConfig, "f.jsonc"), SNAP);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("hlada-api");
    expect(errors[0]).toContain("does not exist");
  });
});

// ── fool-test 2 ─────────────────────────────────────────────────────────

describe("FOOL 2 — let pendingCreation be a bare name with no reason", () => {
  // The escape hatch is what keeps a known, deliberate gap from failing the
  // build forever. Without the reason+owner requirement it becomes a mute
  // button: anyone can silence the gate by adding a string to a list.
  const cfg = { services: [{ binding: "MAIN_APP", service: "hlada-api" }] };

  const snapFooled = { ...SNAP, pendingCreation: [{ kind: "worker", name: "hlada-api" }] };
  const snapReal = {
    ...SNAP,
    pendingCreation: [
      { kind: "worker", name: "hlada-api", reason: "blocked on the production decision", owner: "Andri" },
    ],
  };

  it("a bare pendingCreation entry is rejected — silencing requires accountability", () => {
    const { errors } = checkRows(bindingsOf(cfg, "f.jsonc"), snapFooled);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("no reason and/or owner");
  });

  it("an entry with a reason and an owner is accepted, and recorded as a note", () => {
    const { errors, notes } = checkRows(bindingsOf(cfg, "f.jsonc"), snapReal);
    expect(errors).toHaveLength(0);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("PENDING-CREATION");
  });
});

// ── fool-test 3 ─────────────────────────────────────────────────────────

describe("FOOL 3 — treat a commented-out binding as live", () => {
  // stripJsonc is what makes "commented out is not declared" true. Without it
  // a regex-based reader sees the binding inside the comment and reports a
  // defect that does not exist — the false-alarm direction of the same class
  // of bug that made OB18 falsely pass.
  const src = `{
    "name": "x",
    // "services": [{ "binding": "MAIN_APP", "service": "hlada-api" }],
    "env": {}
  }`;

  it("a naive regex reader sees a binding in the comment", () => {
    expect(/"service"\s*:\s*"hlada-api"/.test(src)).toBe(true);
  });

  it("the real gate sees no binding at all", () => {
    const rows = bindingsOf(JSON.parse(stripJsonc(src)), "f.jsonc");
    expect(rows).toHaveLength(0);
  });
});

// ── fool-test 4 ─────────────────────────────────────────────────────────

describe("FOOL 4 — accept any truthy versionId", () => {
  // The plausible-placeholder problem. A deploy reporting "unknown" is
  // indistinguishable from a good one under a truthiness check, and a stale
  // or invented version id is worse than none because it is believed.
  const truthy = (body) => Boolean(body.versionId);

  it("the fooled check passes a placeholder version", () => {
    for (const p of ["unknown", "dev", "latest", "n/a"]) {
      expect(truthy({ configured: true, versionId: p })).toBe(true);
    }
  });

  it("the real gate rejects every placeholder it knows", () => {
    for (const p of PLACEHOLDER_VERSIONS) {
      expect(evaluate({ configured: true, versionId: p }).ok).toBe(false);
    }
  });

  it("and still accepts a real Cloudflare version id", () => {
    expect(evaluate({ configured: true, versionId: "aaf5f724-752a-410a-b280-30f779bf3376" }).ok).toBe(
      true,
    );
  });
});

// ── fool-test 5 ─────────────────────────────────────────────────────────

describe("FOOL 5 — trust `configured` without checking the id", () => {
  const trustConfigured = (body) => body.configured === true;

  it("the fooled check passes a configured environment with an empty id", () => {
    expect(trustConfigured({ configured: true, versionId: "" })).toBe(true);
  });

  it("the real gate does not", () => {
    expect(evaluate({ configured: true, versionId: "" }).ok).toBe(false);
  });

  it("the exact body the live gateway would return today fails", () => {
    // /version does not exist on the deployed 2026-08-03 code; once it does,
    // this is what it returns until version_metadata is uncommented.
    const body = {
      service: "straumvakt-ocpp",
      versionId: null,
      configured: false,
      reason: "binding-absent",
    };
    expect(evaluate(body).ok).toBe(false);
    expect(evaluate(body).reason).toContain("configured=false");
  });
});

// ── fool-test 6 ─────────────────────────────────────────────────────────

describe("FOOL 6 — check only the top-level block and skip named environments", () => {
  // The live system is entirely in named `env` blocks. A gate that only reads
  // the top level would have passed every config in this repo while checking
  // nothing that actually runs.
  const cfg = {
    services: [{ binding: "MAIN_APP", service: "real-worker" }],
    env: { staging: { r2_buckets: [{ binding: "B", bucket_name: "bucket-that-does-not-exist" }] } },
  };

  const topLevelOnly = (c) => bindingsOf({ ...c, env: {} }, "f.jsonc");

  it("the fooled reader finds nothing wrong", () => {
    const { errors } = checkRows(topLevelOnly(cfg), SNAP);
    expect(errors).toHaveLength(0);
  });

  it("the real gate checks named environments too", () => {
    const { errors } = checkRows(bindingsOf(cfg, "f.jsonc"), SNAP);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("staging");
  });
});
