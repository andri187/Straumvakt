# Core UI review guide

Date: 2026-08-10

## Start

Run the local preview with:

```powershell
$env:STRAUMVAKT_LOCAL_PRODUCT_PREVIEW='1'
npm run dev
```

Open `/login-demo`. No authentication occurs and no password is accepted.

## Review path

### Straumvakt Admin

1. Open `/app/admin/overview`.
2. Confirm everyday work is split into Operate, Core commercial and Readiness.
3. Confirm Verification evidence is collapsed.
4. Open `/app/admin/core-pricing` and verify 200 kr per connector, 50 kr per active driver and the 450 kr per-connector cap are labelled as local/read-only.
5. Open `/app/admin/billing-trust` and confirm source evidence is not described as deployed runtime proof.

### Organisation / CPO

1. Open `/app/org/chargers` and scan charger state, site and next action.
2. Open `/app/org/drivers` and verify roster visibility is separate from mutation authority.
3. Open `/app/org/rates` and confirm DSO/network, retailer, CPO add-on, plug-time fee and grace remain versioned.
4. Open `/app/org/billing-material` and confirm period lock is disabled.
5. Open `/app/org/monthly-reporting` and confirm export is disabled.
6. Open the collapsed readiness group and confirm Icelandic bank/accounting formats are described as unknown.

### Driver

1. Open `/app/driver/no-access` and confirm the unaffiliated state is understandable.
2. Open `/app/driver/active` and confirm observed power is labelled and never represented as 0 kW.
3. Open `/app/driver/monthly-statement` and confirm energy, plug-time and adjustment lines are understandable.
4. Open `/app/driver/cost-trust` and verify the rate/version boundary.
5. Open `/app/driver/integration-cdr-pending` and confirm cost is unavailable rather than zero.
6. Confirm the workflow copy says a statement is not an invoice, payment request or paid status.

## Viewports

- Desktop: 1440 x 900
- Tablet: 820 x 1180
- Mobile: 390 x 844

At tablet/mobile sizes, verify the sidebar becomes a drawer, the workflow becomes one column then a two-by-two step grid, tables scroll horizontally, actions do not overflow, and the focus outline remains visible.

## Stop conditions

Stop review if any screen:

- implies authentication happened;
- presents fixture money as final/live;
- shows 0 kW as measured power;
- presents a disabled action as successful;
- claims a bank, accounting, invoice or payment integration;
- exposes Service/contractor as a Core persona.
