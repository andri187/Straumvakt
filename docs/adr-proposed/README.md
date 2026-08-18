# Proposed ADRs — DRAFTS, NOT ACCEPTED ARCHITECTURE

Everything in this directory is a **draft proposal** produced by the remediation
architecture session on 2026-08-09. Nothing here has been agreed.

Guard rails, deliberately redundant:

- the directory is `adr-proposed/`, **not** `adr/`
- every filename is prefixed `PROPOSED-`
- every file's `**Status:**` line reads `Proposed`
- every file names a **human decision owner**
- no number in this directory is reserved in the accepted `docs/adr/` sequence

When one is accepted it should be renumbered into `docs/adr/` with a real
sequence number, its status changed, and the draft deleted — not copied.

| Draft | Decision | Owner | Register |
|---|---|---|---|
| [P-A](PROPOSED-A-staging-vs-production-deploy-pointer.md) | staging as production deploy pointer | Andri | D-1 |
| [P-B](PROPOSED-B-worker-migration-and-cpms-collision.md) | Worker rename / CPMS collision | Andri | D-2 |
| [P-C](PROPOSED-C-git-integration-and-custom-domain-source-of-truth.md) | Git integration + custom-domain source of truth | Andri | D-3 |
| [P-D](PROPOSED-D-neon-branch-protection-and-default.md) | Neon branch protection / default | Andri | D-4 |
| [P-E](PROPOSED-E-ci-migration-status-credential.md) | CI migration-status credential | Andri | D-5 |
| [P-F](PROPOSED-F-driver-telemetry-availability-semantics.md) | driver telemetry availability semantics | backend | D-6 adj. |
| [P-G](PROPOSED-G-billing-records-versus-invoices.md) | billing records vs invoice documents | product | D-6 |
| [P-H](PROPOSED-H-vehicle-profile-and-autocharge-boundary.md) | vehicle profile / Autocharge boundary | product | D-7 |
| [P-I](PROPOSED-I-charger-service-settings-ownership.md) | charger service settings ownership | product + security | D-8 |
| [P-J](PROPOSED-J-multiple-active-sessions-policy.md) | multiple active sessions | product | D-10 |
| [P-K](PROPOSED-K-contractor-role-model.md) | contractor role/access model | product + security | D-9 |
| [P-L](PROPOSED-L-event-and-issue-ownership-at-scale.md) | event/issue ownership at 4–5k connectors | architecture | new |
