# Morning review guide: Straumvakt Core UI

Open `http://localhost:3012/login-demo` with the local preview server running.

## Fifteen-minute route

1. Enter **Straumvakt Admin** and open **Core product**. Confirm Iceland-only Core scope and Premium absence.
2. Open **Core pricing**. Check the 200 kr connector, 50 kr driver, and 450 kr connector cap explanation.
3. Open **Standard telemetry**. Confirm it does not promise faster live operations.
4. Open **Core readiness**. Confirm disabled contracts are understandable.
5. Return to the role selector and enter **Organisation / CPO**.
6. Open **Core subscription**. Check the high-driver cap example for 24 connectors and 146 drivers.
7. Open **Energy rates**. Check DSO, retailer, CPO, plug-time fee, grace and effective version.
8. Open **Billing material**. Check owner-separated lines and correction note.
9. Open **Delivery log**. Confirm bank/export format remains Unknown.
10. Open **Drivers and access groups**. Confirm active/inactive and safe invite gating.
11. Enter **Driver** and open **Monthly statement**.
12. Open **Cost breakdown** and confirm each cost has an owner.
13. Open **Report-ready state** and check estimate/report/invoice/payment distinctions.

## Decisions to write down

- Is the proposed active connector definition directionally correct?
- Is the proposed active driver definition directionally correct?
- Is the cap explained clearly enough for a high-driver MDU?
- Should plug-time grace start at plug-in, charge end, or another event?
- Is `billing material` the right pre-legal term?
- Which Icelandic export/bank format should be researched first?
- Does the Driver need statement material at Core launch or immediately after?

## Hard stops

Do not approve a live action from visual polish alone. Rate sources, count snapshots, CDR integrity, period lock, document type, delivery, export, manual driver creation, and invite-by-link each need a separate approved contract and test plan.
