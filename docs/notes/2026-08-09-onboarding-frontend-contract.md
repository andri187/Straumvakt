# Onboarding frontend contract

**Status:** UI contract proposal. No backend contract in this document is
implemented by the frontend branch.

## Product states

| Persona/state                   | Source-backed today                                            | Proposed contract needed                       | Never infer                                                  |
| ------------------------------- | -------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------ |
| Guest driver                    | No token in secure storage                                     | Registration entry and local guest shell       | That Straumvakt knows the person                             |
| Registered, unaffiliated driver | `/api/driver/me` plus an empty `/api/driver/chargers` response | Explicit affiliation/access summary            | Organisation, installation or billing relationship           |
| Invited driver                  | `/api/public/invites/consume`                                  | A unified authenticated invite path            | That an invite is an installation access credential          |
| Access-code driver              | None                                                           | Code/passphrase lookup and access request      | Organisation identity before the credential is accepted      |
| Organisation administrator      | `/api/admin/me`, org-scoped reads                              | Onboarding workflow and access-policy mutation | Cross-tenant state                                           |
| Straumvakt staff                | `/api/admin/me` plus platform reads                            | Workflow command/audit projection              | Permission to act merely because the UI entered support mode |
| Active driver                   | Current-session array                                          | Explicit selection persistence                 | Person identity from a shared technical idTag                |

The current `/api/public/invites/consume` route is not the target contract for
new installation access UI. Source review found that its organisation invite
is bearer-based, its existing-user path can replace a password, and the
mobile-supplied `kennitala` is not part of the accepted request schema. Client
migration and server hardening therefore need an explicitly sequenced rollout;
the frontend must not present the current route as identity-bound.

## Proposed onboarding summary

The UI needs one aggregate rather than deriving completion from unrelated
screens. Names below are proposals, not current API fields.

```ts
type OnboardingSummary = {
  workflowId: string;
  organisationId: string;
  state: "draft" | "in_progress" | "blocked" | "ready" | "active" | "cancelled";
  nextActor: "organisation" | "straumvakt" | null;
  version: number;
  steps: OnboardingStep[];
};

type OnboardingStep = {
  key:
    | "organisation"
    | "administrator"
    | "commercial"
    | "infrastructure"
    | "chargers"
    | "driver_access"
    | "validation";
  state:
    | "not_started"
    | "ready"
    | "in_progress"
    | "blocked"
    | "complete"
    | "skipped";
  owner: "organisation" | "straumvakt";
  updatedAt: string | null;
};
```

## Proposed access contract

An installation code and passphrase grant installation or driver-group access,
never organisation administration. The response must not disclose tenant data
until the credential has been accepted.

```ts
type JoinInstallationResult =
  | { state: "granted"; grantId: string }
  | { state: "pending"; requestId: string }
  | { state: "rejected"; reasonCode: string };

type AccessPolicy =
  | "automatic"
  | "approval_required"
  | "invite_only"
  | "closed";
```

Required behavior: hash passphrases, rate-limit attempts, rotate/revoke codes,
deduplicate requests, audit grants and avoid code-enumeration responses.

## Support context

Support mode is presentation of an already-authorized platform action, not
impersonation. A future command must carry both identities:

```ts
type SupportContext = {
  actorUserId: string;
  actorEmail: string;
  organisationId: string;
  organisationName: string;
  enteredAt: string;
  reason: string;
};
```

The web shell must keep the context visible and provide an explicit exit. Every
mutation still needs its own server-side permission check and audit event.

## Shared technical authorization

Copy rule: a shared installation token may explain how a charger accepted a
transaction, but it must never be displayed as the driver. Session selection
uses the session/transaction identity; charger, connector and transaction stay
distinct from user attribution.

## Current frontend boundary

This branch may render source-backed progress from current read endpoints. It
must not persist access policy, submit code/passphrase, or claim a singular
workflow exists until the contracts above are implemented and authorized.
