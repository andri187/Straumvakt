# The flat-fee path, as scenarios.
#
# NOT executable, and deliberately so. There is no Cucumber runner in this
# repository and adding one would be a build change nobody asked for. What
# these are is the ACCEPTANCE LANGUAGE for the flat fee: the sentences an
# operator, an accountant and a host would each recognise, written down before
# a UI exists to argue about them in.
#
# Every scenario below maps to a test that already exists, or to a named gap.
# The mapping is in docs/specs/flat-fee-billing-coverage.md — a scenario with
# no test is a finding, not a decoration.
#
# The locked commercial model, for reference:
#   200 kr per active connector per month
#    50 kr per active driver per month
#   capped at 450 kr per connector per month  (binds when drivers > 5 x connectors)

Feature: The monthly flat fee

  Background:
    Given the org "Hýsill A" has a service agreement with the core flat-fee factor
    And the connector rate is 200 kr per connector-month
    And the driver rate is 50 kr per driver-month
    And the cap is 450 kr per connector-month

  # ── The month boundary ──────────────────────────────────────────────────

  Scenario: A session at 23:59 on the last day belongs to that month
    Given a session started at 2026-03-31T23:59:00Z
    When March is priced
    Then the session counts toward March
    And it does not count toward April

  Scenario: A session at 00:00 on the first day belongs to the new month
    Given a session started at 2026-04-01T00:00:00Z
    When March is priced
    Then the session does not count toward March
    # The period is [Mar 1, Apr 1). No instant belongs to both months and none
    # to neither, which is the same half-open rule the placement interval uses.

  Scenario: A session that starts in March and ends in April counts once, in March
    Given a session started at 2026-03-31T22:00:00Z and stopped at 2026-04-01T02:00:00Z
    When March and April are both priced
    Then the session counts toward March only
    # Attribution is by START. A session counted in both months would be
    # double-billed; counted in neither, lost.

  # ── An org with nothing ─────────────────────────────────────────────────

  Scenario: An org with no connectors HOLDS — it is not invoiced for zero
    Given the org has no connector activity rows for March
    When March is priced
    Then the period holds with "no_activity_source"
    And no invoice is produced
    # Ledger note 22. "No connectors" and "the aggregation has not run" are the
    # same empty table, and only one of them is a fact about the estate.

  Scenario: An org with connectors but no drivers is invoiced for connectors alone
    Given the org has 10 active connectors and 0 active drivers
    When March is priced
    Then the invoice has one line for 2.000,00 kr
    And it has no driver line
    # A MEASURED zero driver count is legal and produces no line. An
    # UNAVAILABLE one holds the period. The two must not be confused.

  Scenario: An org whose activity has not been sealed HOLDS regardless of the count
    Given the activity aggregation has not run for March
    When March is priced
    Then the period holds
    # Even a plausible count is unavailable if nothing vouches for it.

  # ── Joining and leaving mid-period ──────────────────────────────────────

  Scenario: An org onboarded on the 15th is billed for March
    Given the org's first placement opens on 2026-03-15
    When March is priced
    Then the org appears on March's invoice
    # Decision 5 counts OVERLAP. A run on April 1st that asked "where is this
    # device now" would find it and bill correctly by luck; one that asked "was
    # it here on March 1st" would bill nobody.

  Scenario: An org offboarded on the 20th is still billed for March
    Given the org's placement closes on 2026-03-20
    When March is priced in April
    Then the org appears on March's invoice
    # The case luck does not cover: a current-row read finds the device
    # nowhere and invoices nobody for 20 days of hardware.

  Scenario: A DEVICE MOVED mid-period produces one row per host
    Given a device placed at "Hýsill A" until 2026-03-12
    And placed at "Hýsill B" from 2026-03-12
    When March is priced
    Then "Hýsill A" is billed for a connector it held for 11 days
    And "Hýsill B" is billed for a connector it held for 20 days
    And the two placements do not overlap

  Scenario: The default policy bills each host a WHOLE connector-month
    Given a device moved mid-March between two hosts
    When March is priced under "whole_month_per_host"
    Then each host is billed 200,00 kr
    And one physical connector has produced 400,00 kr
    # Today's behaviour, unchanged. This scenario exists to make the number
    # visible rather than to endorse it.

  Scenario: Under proration the shares sum to exactly one connector-month
    Given a device moved mid-March between two hosts
    When March is priced under "prorate_by_overlap_days"
    Then "Hýsill A" is billed 70,96 kr
    And "Hýsill B" is billed 129,04 kr
    And the two shares sum to exactly 200,00 kr
    # Allocated cumulatively. Dividing each share independently loses an eyrir.

  Scenario: A device that moves TWICE produces three rows summing to the month
    Given a device held by three hosts for 9, 10 and 12 days of March
    When March is priced
    Then three rows are produced
    And the days sum to 31

  Scenario: A device placed and removed inside ONE DAY is still billed
    Given a device placed at 09:00 and removed at 17:00 on 2026-03-15
    When March is priced
    Then the host is billed
    # Zero WHOLE days of overlap is not zero placements. A rule that dropped it
    # would invite a fleet of one-day installations that are never billed.

  # ── The cap ─────────────────────────────────────────────────────────────

  Scenario: The cap does not bind at five drivers per connector
    Given the org has 10 active connectors and 50 active drivers
    When March is priced
    Then the total is 4.500,00 kr
    And the cap is recorded as not binding
    # 10 x 200 + 50 x 50 = 4.500, and 10 x 450 = 4.500. The exact edge.

  Scenario: The cap binds at more than five drivers per connector
    Given the org has 10 active connectors and 51 active drivers
    When March is priced
    Then the total is 4.500,00 kr
    And the cap is recorded as APPLIED
    # The relief line is what makes the two identical totals distinguishable
    # on the document. Without it an accountant cannot tell them apart.

  Scenario: The cap is expressed per connector-month and proration would move it
    Given the org has a device that moved mid-month
    When March is priced under "prorate_by_overlap_days"
    Then the cap applies to the prorated total, not to each host's share
    # NOT IMPLEMENTED. Named here because it is the consequence that gets
    # missed when the proration switch is flipped six weeks later.

  # ── Charger.Active, and the estate that is not what the database says ───

  Scenario: A DEACTIVATED charger still in the vendor portal is NOT billed
    Given the device's latest Charger.Active before the period end is false
    When March is priced
    Then the device produces no billable connector
    And the reason recorded is "deactivated_by_vendor"
    # Ten of Dalvegur's thirty rows. Unfiltered, the invoice reads 30 where 20
    # exist: 6.000 kr against 4.000 kr of real estate, one site, every month.

  Scenario: A charger REACTIVATED before the period end is billed
    Given the device was deactivated on 2026-03-12 and reactivated on 2026-03-25
    When March is priced
    Then the device is billable
    # The latest observation strictly before the period end wins.

  Scenario: A charger never polled HOLDS the period — it is not "inactive"
    Given the device has no vendor-config observation
    When March is priced
    Then the period holds with "vendor_config_unavailable"
    # The false-is-not-unavailable trap. Treating a missing observation as
    # inactive is a silent discount that nobody reviews.

  Scenario: An observation made only AFTER the period says nothing about it
    Given the device's only observation is dated 2026-04-15
    When March is priced
    Then the period holds with "no_observation_before_period_end"
    # Learning in April that a charger is active is not evidence about March,
    # and dating it backwards would be inventing evidence.

  Scenario: A placement whose device has NO CONNECTORS holds the period
    Given a placement exists for a device with no connector rows
    When March is priced
    Then the period holds with "placement_without_connectors"
    # A first onboarding with no BootNotification writes no connector rather
    # than inventing one. Skipping such a placement would produce an invoice
    # that looks complete and is short by one charger.

  Scenario: A charger in the vendor portal with NO ROW HERE cannot be seen
    Given five chargers exist in the Zaptec portal with no row in our database
    When March is priced
    Then they are absent from the invoice
    And no predicate can detect them
    # An IMPORT gap, and it under-bills. It needs a reconciliation, not a
    # WHERE clause: a row that does not exist cannot be filtered in.

  # ── Evidence, assertions and the tiers ──────────────────────────────────

  Scenario: A connector seen only by a StatusNotification is billable
    Given a connector with no sessions and one StatusNotification in March
    When March is priced
    Then it counts as an active connector
    # The ordinary shape of a month. A session-only derivation under-bills by
    # 27 of 30 connectors.

  Scenario: An ASSERTED connector on a vendor-native installation is billable
    Given a Zaptec-authentication installation whose sessions carry no connector id
    And an operator has asserted the connector for March with a reason
    When March is priced
    Then it counts as an active connector
    # Without the assertion tier the period holds and a host is not billed for
    # hardware that is installed and theirs.

  Scenario: A connector asserted twice is counted once
    Given the same connector is asserted twice for March
    When March is priced
    Then it counts once
    # The unique index is the mechanism; a duplicate assertion is a no-op.

  Scenario: An assertion for another org's connector is refused
    Given an operator scoped to "Hýsill A" asserts a connector belonging to "Hýsill B"
    Then the assertion is refused with "org_not_in_scope"

  # ── Disputes, holds and re-runs ─────────────────────────────────────────

  Scenario: A disputed line is answered from the SEALED session, not by re-deriving
    Given a driver disputes a session priced in March
    When the session is examined in September
    Then the tariff it was priced at is read from the session's own snapshot
    And the placement it ran on is read from the session's own placement id
    # Re-running today's resolver over yesterday's session is the
    # re-derivation FOCUS rule 4 forbids, and it is silent: the number simply
    # comes out different.

  Scenario: A period that HOLDS produces no document number
    Given the period holds on an unavailable count
    When issuing is attempted
    Then no ordinal is consumed
    And the sequence is unchanged
    # A number spent on a document that was never issued is a gap, and the
    # statute wants an unbroken series.

  Scenario: A re-run after a correction reuses the SAME document number
    Given a statement was issued for March under idempotency key K
    When the same key is presented again
    Then the same document number is returned
    And the counter is not reached a second time

  Scenario: A re-run with a DIFFERENT key for the same statement is refused
    Given a statement for March already carries a number
    When a different idempotency key is presented for the same statement
    Then it is refused with "statement_already_numbered"
    # Two keys for one invoice is one invoice and one caller bug. Spending a
    # second ordinal would put two numbers on one statement.

  Scenario: A correction is a CREDIT NOTE with its own number, never an edit
    Given March's invoice was wrong
    When a correction is issued
    Then a credit note takes the next ordinal from a stated series
    And March's original invoice is unchanged

  Scenario: A VOIDED number is not a gap
    Given SV-2026-000002 was issued and then voided
    When the series is audited
    Then no gap is reported between 000001 and 000003
    # Void is a status, not a delete. There is deliberately no release: a
    # released number leaves a hole the documents around it have closed over.

  Scenario: Two orgs issuing in the same instant each get 000001
    Given two orgs issue their first March invoice simultaneously
    Then both documents are numbered SV-2026-000001
    And the two sequences are independent
    # The series is per-org, because each host's numbering is its own unbroken
    # run under Icelandic law.

  Scenario: A host with no kennitala cannot be invoiced
    Given the recipient has no registered id
    When the document is built
    Then it is refused
    # An Icelandic sales invoice names the payer. A document without one is
    # not a document.
