# Six-role permission matrix

Phase 8. Grounded in the **actual verbs in `apps/api/src/lib/auth/permissions.ts`**
and in which of them are **actually enforced at routes**, not in an idealised
model.

## 1. Correction to this packet's own earlier recommendation

Doc 05 §3 recommended adding a **new** `platform.support.enter` verb, on the
reasoning that reusing an existing one would retroactively make every super-user
a support agent.

**That recommendation was based on an incomplete read and is withdrawn.**

`SOURCE-FACT` `permissions.ts` already defines **`platform.support.action`**, and
`platform_admin` already holds **`platform.impersonate`**. So a purpose-built
support verb exists.

**Revised recommendation: wire up the existing `platform.support.action`.** It is
`SOURCE-FACT` **defined but never enforced at any route** — zero
`requirePermission("platform.support.action")` call sites — so adopting it
grants nothing retroactively beyond whoever already holds it in a bundle. That
is strictly better than inventing a second verb for the same concept.

## 2. Enforcement is real — a second correction

While building this matrix I nearly concluded the permission model was
decorative, because the write verbs appeared only in test files.

**That was wrong.** `SOURCE-FACT` **35 of 37 admin route files import and use
`requirePermission`**, with 22 distinct verbs enforced across the routes:

```
billing.read 28 · platform.tenant.read 24 · platform.tenant.write 17
billing.write 15 · site.write 9 · site.read 8 · member.read 8 · charger.read 8
charger.write 5 · charger.config 4 · site.delete 3 · org.write 3
contract.read 3 · property.write 2 · property.read 2 · platform.tenant.delete 2
org.read 2 · member.write 2 · member.invite 2 · property.delete 1
charger.remote_start 1 · charger.remote_stop 1
```

The authorization model is **live and broadly applied**. Recording the wrong
inference as well as the right one, because "permissions are decorative" would
have been a damaging thing to hand to Codex.

## 3. Defined but never enforced — the real gap

`SOURCE-FACT` 18 verbs exist in bundles with **zero route call sites**:

| Verb | Why it is unenforced | Consequence |
|---|---|---|
| `tariff.write`, `contract.write`, `platform.tariff_catalogue.*` | **the write routes do not exist** (doc 14 §5) | permission model is ahead of implementation |
| `audit.read`, `platform.audit.read` | no audit projection endpoint yet | the org-visible audit promise has no gate to attach to |
| `platform.support.action` | support context not built | available for §1's recommendation |
| `platform.impersonate` | nothing impersonates | **contradicts accepted direction 2** |
| `member.remove` | removal goes through a different route | check whether removal is gated at all |
| `billing.export` | no export endpoint | — |
| `platform.finance.*`, `platform.grant.*`, `platform.feature_flag.*`, `platform.migration.run` | features not built | — |

**`platform.impersonate` deserves a decision.** The accepted product direction
is "staff use explicit support context, **never** silent impersonation", yet
`platform_admin` holds an impersonation verb. It is currently harmless — nothing
enforces it — but it is a loaded gun in the bundle, and the honest options are
to remove it or to redefine it as the support-context verb. **`UNKNOWN`** —
product decision.

`member.remove` is the one worth checking soonest: if removal happens through a
route gated by a *different* verb, the intended separation between "can invite"
and "can remove" may not hold.

## 4. The matrix

Legend: **Y** allowed · **N** denied · **C** conditional (note) ·
**—** no backend exists, so the question is moot.

Roles: **SO** Straumvakt owner/admin (`super_user`) · **SS** Straumvakt support
operator (`platform_admin`) · **OA** organisation owner/admin (`ADMIN`/`OWNER`)
· **OM** organisation manager/support (`MANAGER`) · **RD** registered
unaffiliated driver · **GD** guest/local-only driver.

| Action | SO | SS | OA | OM | RD | GD | Verb (enforced?) |
|---|---|---|---|---|---|---|---|
| **Organisation** |
| Create organisation | Y | C¹ | N | N | N | N | `platform.tenant.write` ✅ |
| Read own organisation | Y | C¹ | Y | Y | N | N | `org.read` ✅ |
| Update organisation | Y | C¹ | Y | N | N | N | `org.write` ✅ |
| Delete/archive organisation | Y | N | N | N | N | N | `platform.tenant.delete` ✅ |
| **Onboarding workflow** |
| View / advance / skip step | — | — | — | — | — | — | **not built** (doc 14 §1) |
| Complete `commercial` step | N² | **N** | Y | N | N | N | proposed |
| **Charger** |
| Read chargers | Y | C¹ | Y | Y | C³ | N | `charger.read` ✅ |
| Create/update charger | Y | C¹ | Y | N | N | N | `charger.write` ✅ |
| Configure / OCPP password | Y | C¹ | Y | N | N | N | `charger.config` ✅ |
| Remote start/stop | Y | C¹ | Y | Y | N | N | `charger.remote_*` ✅ |
| **Visibility** | — | — | — | — | — | — | **rejected** (doc 15 §2) |
| **Driver / membership** |
| Read members | Y | C¹ | Y | Y | N | N | `member.read` ✅ |
| Invite member | Y | C¹ | Y | Y | N | N | `member.invite` ✅ |
| Remove member | Y | C¹ | Y | N | N | N | `member.remove` ⚠️ **unenforced** |
| Add driver-group membership | Y | C¹ | Y | Y | N | N | via `member.write` ✅ |
| Approve/reject access request | Y | C¹ | Y | Y | N | N | route exists, **no caller** |
| Request access | N | N | N | N | **Y** | N | driver session |
| Join by code + passphrase | N | N | N | N | **Y** | N | proposed |
| **Cost factors / agreements** |
| Read agreements/tariffs | Y | C¹ | Y | Y | N | N | `billing.read`/`contract.read` ✅ |
| Create/edit agreement | — | — | — | — | — | — | **no write surface** (doc 14 §5) |
| Activate agreement | — | **N**⁴ | — | — | — | — | proposed: OA only |
| Assign cost factor | — | — | — | — | — | — | **no write surface** |
| **Support context** |
| Enter support context | N⁵ | Y | N | N | N | N | `platform.support.action` ⚠️ unenforced |
| Impersonate | **N** | **N** | N | N | N | N | `platform.impersonate` ⚠️ **should not exist** |
| **Session / billing / audit** |
| Read own sessions | Y | C¹ | Y | Y | **Y** | N | driver session ✅ |
| Read org sessions | Y | C¹ | Y | Y | N | N | `billing.read` ✅ |
| Correct attribution / dispute | Y | C¹ | N | N | N | N | **not built** |
| Read audit | Y | Y | **Y**⁶ | N | N | N | `audit.read` ⚠️ unenforced |

¹ **C — only inside an explicit support context**, with `actorUserId` and
`onBehalfOfOrgId` recorded, subject to expiry. Today no such gate exists, so
`platform.tenant.*` grants this **unconditionally and unaudited**. That is the
single largest authorization gap in the table.

² A Straumvakt owner *may* technically hold it, but must not use it —
see doc 05 §4. Enforce as N.

³ A registered driver reads chargers **only** through group membership
(`driver.ts:238-260`), never the admin route.

⁴ Staff must not activate commercial terms on an organisation's behalf.

⁵ Support context is `platform_admin`'s job. A `super_user` should enter one
explicitly rather than acting bare — otherwise the highest-privilege account is
the least audited.

⁶ Organisation-visible audit is a **promise in doc 05 §3 rule 6** with no
endpoint yet.

## 5. Data scope per role

| Role | Scope |
|---|---|
| SO | all tenants — the only unrestricted role |
| SS | **one** organisation, for the lifetime of one support context |
| OA / OM | own organisation only, via the `orgId` predicate every repository takes |
| RD | own identity, own sessions, chargers reachable through membership |
| GD | nothing server-side — guest is local-only by definition |

## 6. What Codex may rely on

- **Enforced today:** org, property, site, charger, member reads and writes.
  Safe to build interactive UI against.
- **Gated but hollow:** `audit.read`, `tariff.write`, `contract.write` — the
  verb exists, the endpoint does not. **Do not build UI against these.**
- **Ungated:** everything a support operator does inside a tenant. Until
  `platform.support.action` is wired, staff acting on a tenant is
  indistinguishable in the audit log from the tenant acting on itself.
