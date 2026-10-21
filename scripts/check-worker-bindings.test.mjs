// Tests for the Worker binding checker.
//
// The checker's whole value is that it reads configs correctly, so the
// parser gets as much attention as the rules. The case that matters most
// is a `//` inside a string: apps/api/wrangler.jsonc contains
// "postgresql://placeholder@..." and a naive comment-stripper truncates
// that line and everything after it on the same line — silently turning
// a valid config into a different, smaller one. A checker that corrupts
// its input is worse than no checker, because it reports confidently.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  parseJsonc,
  deployTargets,
  checkConfig,
} from "./check-worker-bindings.mjs";

const GATEWAY_CONTRACT = {
  file: "fixture/gateway.jsonc",
  label: "gateway",
  skeletonTopLevel: false,
  requirements: [
    {
      id: "queue-producer",
      kind: "queue_producer",
      binding: "OCPP_EVENTS_QUEUE",
      requiredIn: "every",
      why: "fallback to synchronous service binding",
    },
  ],
};

describe("parseJsonc", () => {
  it("does not treat // inside a string as a comment", () => {
    const src = `{
      "localConnectionString": "postgresql://user:pw@localhost:5432/db",
      "keep": true
    }`;
    const parsed = parseJsonc(src);
    expect(parsed.localConnectionString).toBe(
      "postgresql://user:pw@localhost:5432/db",
    );
    // The field AFTER the string on a later line must survive.
    expect(parsed.keep).toBe(true);
  });

  it("strips line comments, block comments and trailing commas", () => {
    const src = `{
      // a line comment
      "a": 1, /* inline block */
      /* multi
         line */
      "b": [1, 2,],
    }`;
    expect(parseJsonc(src)).toEqual({ a: 1, b: [1, 2] });
  });

  it("keeps an escaped quote inside a string intact", () => {
    expect(parseJsonc(`{"s":"he said \\"hi\\" // not a comment"}`).s).toBe(
      'he said "hi" // not a comment',
    );
  });

  it("parses the real repo configs without throwing", () => {
    for (const f of ["gateway/wrangler.jsonc", "apps/api/wrangler.jsonc"]) {
      const cfg = parseJsonc(readFileSync(f, "utf8"));
      expect(typeof cfg.name).toBe("string");
    }
  });
});

describe("deployTargets", () => {
  it("counts top-level and every env as separate deployable targets", () => {
    const t = deployTargets({ name: "w", env: { staging: {}, production: {} } });
    expect(t.map((x) => x.name)).toEqual([
      "(top-level)",
      "env.staging",
      "env.production",
    ]);
    expect(t.filter((x) => x.isTopLevel)).toHaveLength(1);
  });

  it("treats a config with no env block as one target", () => {
    expect(deployTargets({ name: "w" })).toHaveLength(1);
  });
});

describe("required bindings", () => {
  it("fails a top-level block that omits the queue producer", () => {
    const cfg = {
      name: "gw",
      env: {
        staging: {
          queues: { producers: [{ binding: "OCPP_EVENTS_QUEUE", queue: "q" }] },
        },
      },
    };
    const { failures } = checkConfig(GATEWAY_CONTRACT, cfg);
    expect(failures).toHaveLength(1);
    expect(failures[0].target).toBe("(top-level)");
    expect(failures[0].binding).toBe("OCPP_EVENTS_QUEUE");
  });

  it("passes when every target declares it", () => {
    const producers = [{ binding: "OCPP_EVENTS_QUEUE", queue: "q" }];
    const cfg = {
      name: "gw",
      queues: { producers },
      env: { staging: { queues: { producers } } },
    };
    expect(checkConfig(GATEWAY_CONTRACT, cfg).failures).toHaveLength(0);
  });

  it("skeletonTopLevel exempts the top-level block, and only it", () => {
    const cfg = { name: "gw", env: { staging: {} } };
    const { failures } = checkConfig(
      { ...GATEWAY_CONTRACT, skeletonTopLevel: true },
      cfg,
    );
    // top-level skipped, env.staging still required to comply
    expect(failures).toHaveLength(1);
    expect(failures[0].target).toBe("env.staging");
  });

  it("matches a queue consumer by queue name, not binding", () => {
    const contract = {
      file: "f",
      requirements: [
        {
          id: "c",
          kind: "queue_consumer",
          match: /ocpp-events/,
          requiredIn: "every",
          why: "w",
        },
      ],
    };
    const good = {
      name: "a",
      queues: { consumers: [{ queue: "straumvakt-ocpp-events-staging" }] },
    };
    const bad = {
      name: "a",
      queues: { consumers: [{ queue: "straumvakt-outbound-staging" }] },
    };
    expect(checkConfig(contract, good).failures).toHaveLength(0);
    expect(checkConfig(contract, bad).failures).toHaveLength(1);
  });

  it("treats an empty crons array as absent", () => {
    const contract = {
      file: "f",
      requirements: [{ id: "cr", kind: "cron", requiredIn: "every", why: "w" }],
    };
    expect(
      checkConfig(contract, { name: "a", triggers: { crons: [] } }).failures,
    ).toHaveLength(1);
    expect(
      checkConfig(contract, { name: "a", triggers: { crons: ["* * * * *"] } })
        .failures,
    ).toHaveLength(0);
  });
});

describe("warnings", () => {
  const noReqs = { file: "f", requirements: [] };

  it("flags singular field names wrangler ignores", () => {
    const { warnings } = checkConfig(noReqs, {
      name: "a",
      queue: { producers: [] },
      service: [],
    });
    const text = warnings.map((w) => w.detail).join(" ");
    expect(text).toContain('"queue" is not a wrangler field');
    expect(text).toContain('Use "services"');
  });

  it("flags workers_dev alongside routes", () => {
    const { warnings } = checkConfig(noReqs, {
      name: "a",
      workers_dev: true,
      routes: [{ pattern: "x.is/*" }],
    });
    expect(warnings.some((w) => w.detail.includes("workers.dev"))).toBe(true);
  });

  it("flags singular route", () => {
    const { warnings } = checkConfig(noReqs, { name: "a", route: "x.is/*" });
    expect(warnings.some((w) => w.detail.includes('"route" is singular'))).toBe(
      true,
    );
  });

  it("flags a top-level block declaring less than an env block", () => {
    const { warnings } = checkConfig(noReqs, {
      name: "a",
      env: { staging: { hyperdrive: [{ binding: "DB" }], queues: {} } },
    });
    const skel = warnings.find((w) => w.detail.includes("A deploy without --env"));
    expect(skel).toBeTruthy();
    expect(skel.detail).toContain("hyperdrive");
    expect(skel.detail).toContain("queues");
  });

  it("does not warn when top-level and env declare the same shape", () => {
    const { warnings } = checkConfig(noReqs, {
      name: "a",
      hyperdrive: [{ binding: "DB" }],
      env: { staging: { hyperdrive: [{ binding: "DB" }] } },
    });
    expect(warnings.filter((w) => w.detail.includes("A deploy without --env"))).toHaveLength(0);
  });

  it("ignores identity fields when comparing top-level to env", () => {
    // name/main/compatibility_* differ between targets by design.
    const { warnings } = checkConfig(noReqs, {
      name: "a",
      main: "src/index.ts",
      compatibility_date: "2026-01-01",
      env: { staging: { name: "a-staging", compatibility_flags: ["x"] } },
    });
    expect(warnings).toHaveLength(0);
  });
});

// Characterisation test. It asserts the CURRENT known-bad state of the
// committed configs so the fix is a deliberate, visible act: whoever
// resolves the config has to change this expectation on purpose, and the
// diff says what changed. It is not an endorsement of the state.
describe("committed repo configs (characterisation — expected to change)", () => {
  it("both top-level blocks are still missing required bindings", () => {
    const gw = parseJsonc(readFileSync("gateway/wrangler.jsonc", "utf8"));
    const api = parseJsonc(readFileSync("apps/api/wrangler.jsonc", "utf8"));

    expect(gw.queues).toBeUndefined();
    expect(gw.env.staging.queues.producers[0].binding).toBe("OCPP_EVENTS_QUEUE");

    expect(api.hyperdrive).toBeUndefined();
    expect(api.queues).toBeUndefined();
    expect(api.triggers).toBeUndefined();
    expect(api.env.staging.hyperdrive[0].binding).toBe("HYPERDRIVE_DB");
    expect(api.env.production).toBeUndefined();
  });
});
