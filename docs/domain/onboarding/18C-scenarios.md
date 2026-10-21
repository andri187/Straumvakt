# Appendix 18C — Given/When/Then scenarios

**156 scenarios.** Every one tagged with what it needs to run:

**[L]** local/offline · **[D]** database required · **[B]** beta environment ·
**[H]** hardware/bench · **[F]** future production

No live test was run. `[D]`/`[B]`/`[H]`/`[F]` are specifications only.

Fixtures: `driver-anna.test`, `driver-bjorn.test`, `staff-carol.test`,
`admin-dagur.test`, `org_alpha` (automatic), `org_beta` (approval_required),
`org_gamma` (closed), codes `ALFA-1111` / `BETA-2222`.

---

## 1. Invite consume abuse (1–18)

1. **[D]** Given anna has a password, When a bearer consumes her invite with a new password, Then 409 `already_claimed` and her hash is byte-identical.
2. **[D]** …Then `usedAt` remains null.
3. **[D]** …Then anna can still complete the flow afterwards.
4. **[D]** Given anna has no password, When a bearer consumes, Then 200 and a credential is created.
5. **[D]** Given a refused consume, When the audit is read, Then the actor is not anna.
6. **[D]** Given a refused consume, Then `actorKind` is `bearer`.
7. **[D]** Given two concurrent consumes of one token, Then exactly one succeeds.
8. **[D]** …Then the loser sees 410 `already_used`.
9. **[D]** Given a consumed token, When replayed, Then 410.
10. **[D]** Given an expired token, Then 410 `expired`.
11. **[D]** Given an unknown token, Then 404 `not_found`.
12. **[D]** Given a token of kind ≠ invite, Then 404 (not a distinct code).
13. **[L]** Given a body with `kennitala`, When strict validation is on, Then 400 `validation`.
14. **[L]** Given a body with `kennitala`, When verification is chosen instead, Then it is compared to the invited user.
15. **[D]** Given a mismatched kennitala, Then the same generic failure as an unknown token.
16. **[D]** Given malformed token metadata, Then 400 (not 500).
17. **[D]** Given a consume that overwrites, When the detection alert is armed, Then it fires.
18. **[L]** Given the fix is deployed, When `upsert` reappears in a diff, Then review flags it.

## 2. Invite compatibility (19–30)

19. **[L]** Given the archived web form posting `{token,password}`, When S2 lands, Then it still works for new invitees.
20. **[L]** Given the mobile app posting `{token,kennitala,password}`, Then it still works for new invitees.
21. **[B]** Given an old app and a new server, Then consume behaves as before for first-time invitees.
22. **[B]** Given a new app and an old server, When `join` 404s, Then the app falls back without crashing.
23. **[B]** Given a hardened consume and an old app, Then onboarding fails — **failing by design**, documenting why stage 6 must follow the gate.
24. **[L]** Given a new client, When it starts, Then it advertises its version.
25. **[L]** Given the server, When asked, Then it lists supported join methods.
26. **[D]** Given both paths live, When a new client joins, Then it prefers `join`.
27. **[D]** Given telemetry, Then legacy calls are counted per client version.
28. **[F]** Given legacy < 1% for 14 days, Then the gate is satisfiable.
29. **[F]** Given any supported version still calling legacy, Then the gate is not satisfied.
30. **[F]** Given the gate unmet, When retirement is attempted, Then it is blocked.

## 3. Authenticated join (31–46)

31. **[D]** Given no session, When `POST /join`, Then 401.
32. **[D]** Given anna's session and a token bound to anna, Then 200 `granted`.
33. **[D]** Given bjorn's session and a token bound to anna, Then 404 identical to unknown-token.
34. **[D]** …Then an audit `redemption_rejected` names bjorn.
35. **[D]** …Then the token remains unconsumed.
36. **[D]** Given `ALFA-1111` + correct passphrase (automatic), Then `granted`.
37. **[D]** Given `BETA-2222` + correct passphrase (approval_required), Then `pending`.
38. **[D]** Given org_gamma (closed), Then `rejected` with `not_available`.
39. **[D]** Given invite_only mode and a code attempt, Then `not_available` — indistinguishable from a wrong passphrase.
40. **[D]** Given a wrong passphrase, Then `not_available`.
41. **[D]** Given a revoked credential, Then `not_available`.
42. **[D]** Given an exhausted credential, Then `not_available`.
43. **[D]** Given the same Idempotency-Key twice, Then one grant and identical responses.
44. **[D]** Given anna already in the group, When she joins again, Then 200 with the existing `grantId` and no duplicate row.
45. **[D]** Given a pending request exists, When she requests again, Then the first is returned with 200, not 409.
46. **[L]** Given a QR with a bad check digit, Then it is rejected client-side with no network call.

## 4. Staff support context (47–62)

47. **[D]** Given carol has only a platform grant and no context, When she reads org_alpha, Then 403 `support_context_required`.
48. **[D]** Given carol opens a context for org_alpha, Then she may read it.
49. **[D]** …Then the audit carries `onBehalfOfOrgId` and `supportContextId`.
50. **[D]** Given carol's context for org_alpha, When she acts on org_beta, Then 403.
51. **[D]** Given an expired context, Then 403 even mid-session.
52. **[D]** Given carol is **also a member** of org_alpha, Then she acts with **no context required**.
53. **[D]** Given no reason supplied, When opening a context, Then 400.
54. **[D]** Given a context opened, Then the organisation is notified.
55. **[D]** Given a context opened, Then the org can see it in its own audit view.
56. **[D]** Given exit is called, Then the context closes and further actions 403.
57. **[D]** Given break-glass, Then the TTL is shorter and the flag is recorded.
58. **[D]** Given a break-glass context, Then it appears in the review queue.
59. **[D]** Given carol lacks `platform.support.action`, When she opens a context, Then 403.
60. **[L]** Given the banner contract, Then it names the org, the staff email, the reason and the expiry.
61. **[L]** Given expiry passes, Then the UI stops offering mutations rather than letting the server reject them one by one.
62. **[D]** Given a context, When a commercial step is submitted, Then 403 `step_not_permitted`.

## 5. Platform admin vs tenant member (63–70)

63. **[D]** Given a super_user with no membership, Then tenant actions require a context.
64. **[D]** Given an org admin, Then no context is ever required.
65. **[L]** Given the permission matrix test, When a verb becomes unenforced, Then CI fails.
66. **[L]** Given a new tenant verb, When it is never used at a route, Then the inventory test flags it.
67. **[D]** Given a contractor mapping, Then it never composes into platform verbs.
68. **[L]** Given `platform.impersonate` is deleted, Then the bundle test is updated in the same commit.
69. **[D]** Given any request, Then the actor is never taken from request input.
70. **[D]** Given a support action, Then actor, subject and credential are three distinct fields.

## 6. Impersonate removal (71–74)

71. **[L]** Given the catalogue, Then `platform.impersonate` is absent.
72. **[L]** Given any route, Then no call site references it.
73. **[L]** Given the exhaustive bundle test, Then it passes after removal.
74. **[D]** Given a token minted before removal, Then nothing grants impersonation.

## 7. Technical token authorization (75–90)

75. **[D]** Given `tokenClass=installation_technical`, When authorized, Then `userId` is null.
76. **[D]** …Then `attribution` is `installation`.
77. **[D]** Given a driver token, Then `attribution` is `driver` and the subject is set.
78. **[D]** Given two concurrent sessions on one technical token, Then neither names a user.
79. **[D]** Given no idTag and free vend, Then `attribution` is `unknown`.
80. **[D]** …Then signed meter values are still retained.
81. **[D]** Given an unbound physical card, Then `attribution` is `installation`.
82. **[D]** Given a card bound to bjorn, Then `attribution` is `driver`.
83. **[D]** Given the CHECK constraint, When an installation attribution carries a subject, Then the insert fails.
84. **[D]** Given tap evidence after an unknown session, Then `unknown → driver` is allowed and the basis recorded.
85. **[D]** Given an attempt to silently downgrade, Then it is rejected.
86. **[D]** Given a correction event, Then the original value is preserved.
87. **[H]** Given free vend, Then whether the charger demands a non-empty idTag is recorded (H1).
88. **[H]** Given one technical token on two EVSEs, Then concurrency behaviour is recorded (H2).
89. **[H]** Given RemoteStart with a marker idTag, Then whether it echoes is recorded (H3).
90. **[H]** Given `enforceAuthorize` true on 1.6 vs 2.0.1, Then differences are recorded (H4).

## 8. Attribution dispute (91–98)

91. **[D]** Given a disputed session, When corrected, Then no CDR is overwritten.
92. **[D]** …Then a correction record is emitted.
93. **[D]** Given a correction, Then the billing subject follows.
94. **[D]** Given a correction, Then the audit actor is the operator, not the driver.
95. **[D]** Given an unknown-attribution session, Then it may be billed to the installation.
96. **[D]** …Then no person is named anywhere in the invoice.
97. **[D]** Given re-resolution, Then it is audited.
98. **[D]** Given a dispute, Then the evidence bundle contains meter data and the authorization decision.

## 9. Organisation onboarding (99–112)

99. **[D]** Given no workflow, When one is started, Then it is `draft`.
100. **[D]** Given an open workflow, When another is started, Then the partial unique index rejects it.
101. **[D]** Given the same Idempotency-Key, Then the existing workflow is returned.
102. **[D]** Given a stale `If-Match`, Then 409 `version_conflict` with the current aggregate.
103. **[D]** Given a required step, When skipped, Then 422 `step_not_skippable`.
104. **[D]** Given an optional step skipped without a reason, Then 400.
105. **[D]** Given all required steps complete, Then the workflow may reach `ready`.
106. **[D]** Given `ready`, When activated, Then `active`.
107. **[D]** Given a non-active workflow, When an invite is redeemed, Then it is refused.
108. **[D]** Given `active`, When suspended, Then memberships are **not** revoked.
109. **[D]** Given `cancelled`, When reopened, Then the version increments and a reopen event is written.
110. **[D]** Given a staff actor, Then `nextActor` and audit reflect staff.
111. **[L]** Given the summary shape, Then it matches Codex's `OnboardingSummary`.
112. **[L]** Given no workflow exists, Then the UI says "This isn't tracked yet" rather than deriving progress.

## 10. Charger onboarding (113–120)

113. **[D]** Given an installation, When a charger is created, Then it is tenant-scoped.
114. **[D]** Given a vendor attach replayed, Then it is idempotent.
115. **[D]** Given an OCPP password rotation, Then it is audited with the actor.
116. **[D]** Given any response, Then the OCPP password never appears in the body.
117. **[D]** Given a charger delete, Then history is preserved (soft delete).
118. **[B]** Given remote start, Then the command is recorded and correlated.
119. **[D]** Given `maintenance` status, Then the charger is not listed to drivers.
120. **[L]** Given station/EVSE/connector, Then session identity uses them, never the idTag.

## 11. Installation access credentials (121–128)

121. **[D]** Given creation, Then the passphrase is returned exactly once.
122. **[D]** Given a second read, Then the passphrase is not retrievable.
123. **[D]** Given rotation, Then both credentials work during the grace window.
124. **[D]** Given revocation, Then existing grants survive.
125. **[D]** Given revocation, Then new joins fail with `not_available`.
126. **[D]** Given emergency revoke-all, Then one event per credential is written.
127. **[L]** Given the rate limiter binding is absent, Then join **refuses** (fail closed).
128. **[D]** Given many attempts on one code from many IPs, Then the per-code limit trips.

## 12. Membership grant/revoke (129–136)

129. **[D]** Given approval, Then exactly one `DriverGroupMembership` is created.
130. **[D]** Given two concurrent approvals, Then one grant and one `409`.
131. **[D]** Given revocation, Then a live charging session is **not** stopped.
132. **[D]** …Then the next authorization is refused.
133. **[D]** Given a rejection, Then a reason code is recorded.
134. **[D]** Given a withdrawal by the requester, Then the request closes.
135. **[D]** Given a policy change mid-request, Then it is evaluated at decision time.
136. **[D]** Given org_gamma closes, Then pending requests are **not** auto-rejected.

## 13. Cost factors and agreements (137–148)

137. **[D]** Given a draft agreement, When edited, Then it succeeds.
138. **[D]** Given an active agreement, When edited, Then it is refused.
139. **[D]** Given two active agreements overlapping in effective range, Then the exclusion constraint rejects the second.
140. **[D]** Given no effective date, Then creation is refused.
141. **[D]** Given staff, When activating, Then 403 — org admin only.
142. **[D]** Given an org admin, When activating, Then it succeeds and is audited with a pricing snapshot.
143. **[D]** Given retirement, Then `effectiveUntil` is set and nothing is deleted.
144. **[D]** Given preview, Then it uses the existing resolver and matches actual resolution.
145. **[D]** Given a clause scoped to a charger, Then it resolves for that charger only.
146. **[D]** Given a per-driver scope attempt, Then it is rejected for beta.
147. **[D]** Given a closed session, When pricing changes, Then the session is **not** rewritten.
148. **[D]** Given an explicit re-resolve, Then a correction is produced.

## 14. Disabled UI states and audit (149–156)

149. **[L]** Given no cost-factor endpoint, Then the UI hides the control entirely.
150. **[L]** Given no onboarding endpoint, Then the UI shows "This isn't tracked yet".
151. **[L]** Given visibility, Then the UI says "Managed through driver groups".
152. **[L]** Given S2 unshipped, Then invite redemption is unavailable for real users.
153. **[L]** Given `NEXT_PUBLIC_DEMO_MODE` set against a beta config, Then the build fails.
154. **[L]** Given a UI test for an absent endpoint, Then it asserts the disabled state rather than stubbing the endpoint.
155. **[D]** Given any state change, Then exactly one audit event is written.
156. **[L]** Given any log line, Then it contains no hash, DSN, token or personal identifier.

---

**Totals:** [L] 38 · [D] 100 · [B] 5 · [H] 4 · [F] 4 · [B/F overlap counted once]
= **156**.

The 38 `[L]` scenarios are runnable today with no database, cloud or hardware,
and are the natural first CI batch.
