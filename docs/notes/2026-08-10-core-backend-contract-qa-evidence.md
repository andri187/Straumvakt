# Core backend-contract UI QA evidence

Evidence root: `C:\Users\Andri\Documents\New project\evidence\core-ui-backend-contract-qa-2026-08-10`

## Automated verification

| Check | Result |
|---|---|
| Core-focused Vitest | 722 passed / 7 files |
| Full repository Vitest | 1,510 passed, 1 skipped, 1 inherited parse-blocked suite |
| TypeScript | Passed |
| Next.js production build | Passed |
| New-route HTTP checks | 18 of 18 returned 200 |
| Visual route groups | 30 formal screenshots |
| Page overflow | 0 of 30 |
| Duplicate IDs | 0 across 9 accessibility groups |
| Meaningful text clipping | 0 across 9 accessibility groups |
| API-call guard | Passed |
| False-claim guard | Passed |

The inherited full-suite failure is `scripts/check-workspace-typecheck.test.mjs: SyntaxError: Invalid or unexpected token`. It predates this UI scope. The suite was not edited here.

## Screenshot matrix

Desktop, 1280 x 720: all 18 new backend-contract routes were captured once. This covers four Admin gates, four CPO gates and ten Driver statement states.

Tablet, 768 x 1024:

1. Admin billing trust.
2. Admin routine-message cost gate.
3. CPO pricing readiness.
4. Driver meter verification hold.
5. Driver CDR authority pending.
6. Driver delivery failed.

Mobile, true 390 x 844:

1. Admin connector frame cap.
2. Admin cross-tenant boundary.
3. CPO manual driver authority.
4. CPO export readiness.
5. Driver meter verification hold.
6. Driver corrected CDR.

`visual-audit.json` contains route, heading, viewport, document width, overflow, current navigation label, disabled-button count, warning count and table count for every formal screenshot.

## Accessibility and copy fit

`accessibility-copy-fit-audit.json` covers six mobile and three desktop route structures. It records tabbable count/labels, headings, table headers, duplicate IDs, page overflow and text clipping. The only raw clipping signal was the intentional one-pixel visually-hidden filter label; meaningful clipping is zero.

Visible focus was strengthened for links, buttons, inputs and the table scroll region. The filter now gains a focus-within boundary. Reduced-motion and forced-colors rules remain present.

## Honest limitation

The browser-control surface accepted zoom keystrokes but exposed no changed page scale, so native 200% zoom was not proven. `mobile-driver-meter-held-zoom-probe.png` is retained as an inconclusive probe and is not counted in the 30 formal screenshots. The morning review guide therefore keeps 200% browser zoom and device text scaling as explicit manual checks.

## Visual conclusions

- Meter start, meter stop, expected delta and held billed energy remain legible together.
- CDR-shaped and CDR-authoritative are visibly different states.
- Corrected material preserves original, adjustment and corrected total.
- Manual driver, export, download and retry controls are genuinely disabled.
- Heartbeat filtering and frame caps are described as backend readiness, never UI switches.
- No screen claims bank support, payment completion, issued invoice, production permission or backend enforcement.
