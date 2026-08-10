# Secret and key preservation — pointer only

This directory deliberately contains **no secrets and no inventory of secrets**.

Key and secret material is recorded, by path and SHA-256 only, in an off-repo
manifest alongside the verified byte backup:

    C:\Users\Andri\Documents\Straumvakt-preservation-backups\
        20260810-011726-e-claude-preserve\              (verified byte backup)
        20260810-015710-canonical-consolidation\
            secrets-preservation-manifest.csv           (paths + hashes, no values)

Nothing under here is a substitute for storing the Android upload key
(`straumvakt-upload.jks` + `key.properties`) somewhere off this machine.
That key is unrecoverable if lost and it is currently on one disk plus one
local backup, both on this computer.
