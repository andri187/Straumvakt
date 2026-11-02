# Secret and key preservation — pointer only

This directory deliberately contains **no secrets and no inventory of secrets**.

Key and secret material is recorded, by path and SHA-256 only, in a local-only
manifest alongside the byte backup. Andri requested moving the Documents
preservation material into the canonical workspace on 2026-10-30. Its new
location is ignored by Git and must never be staged or published:

    E:\Claude\Straumvakt\archive\local-documents-2026-10-30\preservation-backups\
        20260810-011726-e-claude-preserve\              (verified byte backup)
        20260810-015710-canonical-consolidation\
            secrets-preservation-manifest.csv           (historical paths + hashes, no values)

The archive's `verified-files.csv` maps old paths to new paths; older manifests
inside the preserved backup are unchanged historical evidence. Its
`MOVE-COMPLETED.txt` records completion of the verified move.

Nothing under here is a substitute for storing the Android upload key
(`straumvakt-upload.jks` + `key.properties`) somewhere off this machine.
That key is unrecoverable if lost and it is currently on one disk plus one
local backup, both on this computer.
