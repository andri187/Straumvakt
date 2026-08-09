# Production readiness programme

**A gate to be executed later. Nothing here was run.** Stricter than beta because
production adds obligations beta does not carry at all.

## Checks that fail silently — and how to catch them independently

**This is the most important table in the document.** Every row looks healthy
while being wrong, so each needs a verification method that does not depend on
the thing being verified.

| # | Silent failure | Why it looks fine | Independent verification |
|---|---|---|---|
| **SF-1** | Production Worker bound to the **beta database** | every page renders; data is real-looking | Write a uniquely-named test org in beta, then confirm it is **absent** from production. Presence proves shared data |
| **SF-2** | Production Worker service-bound to a **beta** Worker | requests succeed | Read the binding target in the dashboard **and** stop the beta Worker briefly in a maintenance window — production must be unaffected |
| **SF-3** | Beta and production share a **secret value** | nothing breaks | Rotate the beta value; production must keep working. If it breaks, they were shared |
| **SF-4** | Hyperdrive points at the wrong Neon branch | queries succeed against the wrong data | Compare the endpoint host prefix in Hyperdrive against the branch's compute id — **two sources, not one** |
| **SF-5** | Domain attached but serving the **old** Worker | 200 with correct-looking HTML | Compare body SHA-256 against the *beta* Worker's. **Identical = still beta** |
| **SF-6** | Migration recorded but DDL never ran | `migrate status` says "up to date" | Query the actual object (e.g. the enum types), not the history table |
| **SF-7** | Rollback target recorded but **not retrievable** | a version id exists | Actually list retained versions; confirm the id is among them |
| **SF-8** | Alerts configured but routed nowhere | dashboards look complete | **Fire a test alert** and confirm a human receives it |
| **SF-9** | Backup exists but cannot be restored | branch is listed | Restore it to a throwaway branch and check row counts |
| **SF-10** | `workers_dev` left enabled on production | nothing visibly wrong | Fetch the workers.dev hostname — it must **not** serve |

**SF-5 is the one that will actually happen.** After a domain move, the natural
check is "does the site load?" — which passes whether or not the move worked.
Only a body-hash comparison distinguishes them.

---

## P1 · Data separation 🔒

| # | Item | Verification | Fails silently? |
|---|---|---|---|
| P1.1 | Production is a **separate Neon project** | project id differs | no |
| P1.2 | Hyperdrive targets the production branch | SF-4 method | **yes** |
| P1.3 | No beta org, driver, session or token in production | SF-1 method | **yes** |
| P1.4 | Migrations replayed from empty; 47 recorded | SF-6 method | **yes** |
| P1.5 | Backup taken and **restore-tested** | SF-9 method | **yes** |

## P2 · Identity and secrets 🔒

| # | Item | Verification |
|---|---|---|
| P2.1 | Every secret **name** present per the manifest | dashboard list vs manifest |
| P2.2 | **No value shared with beta** | SF-3 method |
| P2.3 | `OCPP_CRED_KEK` differs | SF-3; a shared KEK makes a beta compromise a production charger compromise |
| P2.4 | Stale `DATABASE_URL`/`DIRECT_URL` **not** carried forward | absent from the production Worker |
| P2.5 | Service bindings resolve to production Workers | SF-2 method |

## P3 · Domain and certificate 🔒

| # | Item | Verification |
|---|---|---|
| P3.1 | `straumvakt.org` serves **production** | SF-5 body-hash comparison |
| P3.2 | `www` serves production | SF-5, **separately** — it has its own certificate |
| P3.3 | `api.straumvakt.org` serves production | SF-5 on the JSON 404 body |
| P3.4 | TLS valid on all three | `openssl s_client`, each independently |
| P3.5 | `beta.straumvakt.org` still serves **beta** | must not have been moved by accident |
| P3.6 | `workers_dev` disabled on production Workers | SF-10 |

## P4 · Rollback readiness 🔒

| # | Item |
|---|---|
| P4.1 | Version id captured for every production Worker **before** cutover |
| P4.2 | Those ids confirmed **retrievable** (SF-7) |
| P4.3 | Beta Workers left deployed and warm |
| P4.4 | Domain re-attach procedure written and read by the person on call |
| P4.5 | Restore time measured (from the beta rehearsal, K5) — **this is the RTO** |
| P4.6 | Rollback requires **no approval** to execute |

## P5 · Observability and paging

| # | Item | Verification |
|---|---|---|
| P5.1 | Dashboards exist per environment and are labelled | visual |
| P5.2 | Production alerts **page**; beta alerts do not | SF-8 — fire a test alert |
| P5.3 | On-call rota names a person for the launch window | written |
| P5.4 | SLO dashboards live before traffic, not after | — |
| P5.5 | Queue depth, DLQ, ingest lag, projection lag all visible | — |

## P6 · Legal and retention 🔒

| # | Item |
|---|---|
| P6.1 | Privacy policy and terms reachable **from the product** |
| P6.2 | Retention decided for sessions, meter evidence, audit logs |
| P6.3 | GDPR access / export / erasure path exists and has been walked once |
| P6.4 | R2 evidence retention configured |
| P6.5 | Personal data absent from logs — sampled review |
| P6.6 | **Customer data export** on offboarding is possible |
| P6.7 | Audit-log integrity: append-only or tamper-evident |

**P6.6 is easy to defer and expensive to retrofit.** A customer who cannot leave
with their data is a commercial problem discovered at the worst moment.

## P7 · Support and communication

| # | Item |
|---|---|
| P7.1 | A named person is reachable when a customer cannot charge |
| P7.2 | Support can answer "why did my charge fail" without a DBA |
| P7.3 | Status page or channel exists |
| P7.4 | Launch communication drafted **before** launch |
| P7.5 | Change freeze agreed for the launch window |

## P8 · Release integrity

| # | Item | Verification |
|---|---|---|
| P8.1 | Released commit == beta-tested commit | three identity checks |
| P8.2 | Fast-forward proven (`0 N`) | `rev-list --left-right --count` |
| P8.3 | Release manifest emitted and stored | artefact exists |
| P8.4 | Annotated tag created | `git tag -v` |
| P8.5 | Excluded commits absent | `merge-base --is-ancestor` × 3 |
| P8.6 | App-store release compatible with the production API | L1–L4 from beta, re-run |

## P9 · Disaster recovery exercise 🔒

Run **once, before launch**, on throwaway resources:

| # | Scenario | Success |
|---|---|---|
| P9.1 | Production Worker rolled back to a prior version | serving restored, timed |
| P9.2 | Domain detached and re-attached | serving restored, TLS valid, timed |
| P9.3 | Database restored from backup to a throwaway branch | row counts match, timed |
| P9.4 | Queue consumer stopped and restarted with a backlog | drains, no loss |

**Record the time for each.** Those four numbers are the recovery objectives; any
stated RTO not derived from them is fiction.

## P10 · Load-test evidence

| # | Item |
|---|---|
| P10.1 | Load tests run on an **isolated** estate, never beta or production |
| P10.2 | Results recorded with seed, commit and branch id |
| P10.3 | **Capacity stated as measured or not stated at all** |
| P10.4 | Contamination check: no synthetic row in beta or production |

---

## Production stop conditions

Abort and roll back if: the released commit differs from the beta-tested commit;
any SF-1…SF-10 check reveals its silent failure; either brand hostname fails or
its TLS is invalid; the API stops returning `401` unauthenticated; a charger
transaction is lost during cutover; `_prisma_migrations` disagrees with disk; any
beta identity is found in production; or **any check cannot be verified
independently** — an unverifiable pass is not a pass.

## Incident ownership

| Stage | Owner | Escalation |
|---|---|---|
| Pre-cutover verification | release owner | Andri |
| Cutover window | release owner, hands on keyboard | Andri |
| First 24 h | on-call | Andri |
| Field / charger | operations | site host |
| Data incident | **Andri directly** | legal |
| **Rollback decision** | **on-call, no approval** | inform after |
