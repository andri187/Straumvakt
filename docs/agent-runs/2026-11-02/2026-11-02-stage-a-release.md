# Stage A release — 2026-11-02 19:34 UTC

Andri approved pushing the changes and deploying the prepared gateway and shell in order. Canonical checkout: `E:\Claude\Straumvakt`; remote: `https://github.com/andri187/Straumvakt`; branch: `codex/core-checkpoint-2026-10-31`. Commit `a0a49308b28c332bbb212aa47d915b23a14eb161` was pushed as a new remote feature branch. Unrelated older untracked files remain local; no deployment derives from them.

| Target | Local package SHA-256 independently checked before deploy | Live version read back from Cloudflare |
|---|---|---|
| `straumvakt-ocpp-s1` gateway | `2851b456ab399cff740b8e0860943137a5e69cc5670ccd06c4099d05e17abc5e` | `d1d4fc7f-3f85-4cc4-8175-eb23e299a65b` |
| `straumvakt-cpo-shell` for www and apex | `76a91e89c049b3c393894a9e8fbb58cf7efcb8a2ca08f1578c61916cd15e4ec5` | `0503225a-4130-43a5-920b-015c5d13a5f4` |

Wrangler 4.152.0 dry-runs regenerated both matching package hashes. The gateway deployed first with `gateway/wrangler.first-charger.jsonc`, followed by the shell with `wrangler.cpo-shell.jsonc`. Both commands exited 0 and reported the expected custom domains. Cloudflare deployment readback showed each new version at 100%. The shell settings readback showed `CPO_SHELL_PASSWORD`, `CPO_SHELL_SESSION_SECRET`, and `DATABASE_URL` still present as secret bindings, `GATEWAY` present, recovery set to `false`, and neither the realtime flag nor `VERSION_HUB` present. Read-only public HTTP requests to `https://www.straumvakt.org/` and `https://straumvakt.org/` reached `/signin` with HTTP 200.

No Neon migration, `VersionHub` creation, realtime/recovery enablement, driver secret change, or real-charger setting change occurred. The three verification gaps in the [implementation handoff](../2026-11-01/2026-11-01-remaining-core-completion-handoff.md) remain: editor unsaved-edit retention in a rendered page, an Android emulator run, and server-rendered page exercise against a database in the browser. No authenticated production journey or real charger action was used as a release smoke test.
