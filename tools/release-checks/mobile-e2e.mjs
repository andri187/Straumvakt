// Starts the local workerd room + edge fixture (tools/release-checks/mobile-e2e.worker.mjs) on a fixed port and stays up until
// stopped, so the Flutter end-to-end test can drive it with the app's REAL dart:io WebSocket client:
//
//   node tools/release-checks/mobile-e2e.mjs                         (terminal 1; prints READY <url>)
//   cd apps/mobile && STRAUMVAKT_LIVE_E2E_URL=http://127.0.0.1:8791 flutter test test/live/live_e2e_test.dart
//
// No live bindings, no database, no network beyond loopback.

import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const requireMf = createRequire(resolve("gateway/node_modules/wrangler/package.json"));
const { Miniflare, convertV4MiniflareOptions } = requireMf("miniflare");
const { build } = createRequire(resolve("package.json"))("esbuild");

const PORT = Number(process.env.E2E_PORT ?? 8791);
const dir = mkdtempSync(join(tmpdir(), "straumvakt-mobile-e2e-"));
await build({
  entryPoints: [resolve("tools/release-checks/mobile-e2e.worker.mjs")], outfile: join(dir, "bundle.mjs"), bundle: true, format: "esm", platform: "browser",
  external: ["cloudflare:workers"], logLevel: "error", alias: { "@": resolve("src"), "@straumvakt/shared": resolve("packages/shared/src") },
});
const mf = new Miniflare(convertV4MiniflareOptions({
  host: "127.0.0.1", port: PORT,
  workers: [{
    name: "edge", modules: true, script: readFileSync(join(dir, "bundle.mjs"), "utf8"), compatibilityDate: "2026-10-26", compatibilityFlags: ["nodejs_compat"],
    durableObjects: { VERSION_HUB: { className: "VersionHub", useSQLite: true } },
    bindings: { CPO_SHELL_REALTIME_ENABLED: "true", DRIVER_AUTH_SECRET: "local-e2e-driver-secret-0123456789abcdef" },
  }],
}));
await mf.ready;
console.log(`READY http://127.0.0.1:${PORT}`);
const stop = async () => { await mf.dispose(); rmSync(dir, { recursive: true, force: true }); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
