# RapidRMS Endpoint Discovery Matrix

This matrix tracks which AROS agent skillsets have verified RapidRMS HTTP API contracts. Back-office page routes are not automatically API routes; every answer tool must be verified before it claims numbers.

## Verified direct API

| Agent | Skill family | RapidRMS source | Status |
| --- | --- | --- | --- |
| Marco | Sales summary, invoice report | `GET /api/InvoiceReport` with full-day datetime bounds | Verified live |
| Ana | Item catalog, recently added/edited item candidates, low stock | `GET /api/Item` | Verified live |
| Ana | Top sold items | Invoice report fallback works; `POST /api/SalesDetail/Get` returned 404 in live probe | Partially verified |
| Victor | Void exceptions | `GET /api/InvoiceReport` `isVoid` flag | Verified live |

## Cataloged, needs endpoint mapping

| Agent | Skill family | Back-office page / candidate | Latest probe result |
| --- | --- | --- | --- |
| Larry | Time stamp report, employee hours, payroll period summary | `/TimeStamp`; candidates `/api/TimeStamp`, `/api/TimeStamp/Get`, `/api/TimeStamp/Employee` | No direct API hit in 900-route read sweep; `/api/User` returned only empty `data` |
| Larry | Time stamp edit/add/void | `/TimeStamp` write controls | Must be approval-gated; no API contract verified |
| Larry | Payroll reminder schedule | AROS scheduled job + notification lane | Needs job contract |
| Marco | Tender reports | `/TenderReport`; candidate `/api/TenderReport` | 404 in report-family read sweep |
| Marco | Hourly sales | `/HourlyReport`; candidate `/api/HourlyReport` | 404 in report-family read sweep |
| Nora add-on | Tax breakdown | `/ReportItemSold/...`, `/Tax`; candidate `/api/ReportItemSold/Tax` | 404 in report-family read sweep |
| Felix add-on | Fuel breakdown | `/FuelReport`, `/FuelDetailsReport`, Verifone fuel reports | 404 in report-family read sweep |
| Priya add-on | Promotion performance | `/Discount/SalesByPromotion`, `/Promotion` | candidate returned 400/404 in live probe |
| Tessa | Gift card activity/liability | `/GiftCardInventory`; candidate `/api/GiftCardInventory` | 404 in report-family read sweep |
| Victor | Payout/drop review | `/DropAmountReport`; candidate `/api/DropAmountReport` | 404 in report-family read sweep |
| Owen add-on | Department/vendor/report comparisons | `/ReportItemSold/...` and analytics views | Direct API routes need mapping; CortexDB skill connector has SQL-style methods |

## Mutation safety rule

Time-clock edits, additions, and voids are payroll-impacting staff/security writes. The production workflow must be:

1. Read current store, employee, and exact time range.
2. Produce a correction draft with before/after values and reason.
3. Require owner/admin confirmation immediately before the write.
4. Execute only on an allowlisted store/connector.
5. Read back the changed time stamp.
6. Audit without credentials or unnecessary employee PII.

## BOS website fallback

If a verified HTTP API route is unavailable, the RapidRMS BOS website can be
evaluated as a read-only fallback source. The login page is
`https://www.rapidrms.com/Account/Branchlogin` and posts to
`/Account/CheckLogin` with the same `UserName` and `Password` values held by a
connected `rapidrms-api` connector.

Operator probe:

```bash
pnpm exec tsx scripts/rapidrms-bos-read-probe.ts
```

Optional environment:

- `RAPIDRMS_BOS_PATH=/TimeStamp`
- `RAPIDRMS_BOS_CONNECTOR_ID=<connector uuid>`
- `RAPIDRMS_BOS_INCLUDE_TENANT=1`

The probe keeps BOS cookies in memory, redacts credential material, and reports
only page structure: login status, redirect location, form actions, input names,
table headers, script URLs, and read-path hints. A BOS scraper must not become a
production answer contract until selectors, date filters, pagination, empty
states, tenant/store labels, and session expiry behavior are pinned by tests.

## Probe script

Run from a deployed environment with normal AROS secrets loaded:

```bash
pnpm exec tsx scripts/rapidrms-report-endpoint-probe.ts
```

Optional environment:

- `RAPIDRMS_PROBE_DATE=YYYY-MM-DD`
- `RAPIDRMS_PROBE_CONNECTOR_ID=<connector uuid>`
- `RAPIDRMS_PROBE_INCLUDE_TENANT=1`

For broader endpoint discovery when a back-office page route does not map to a
direct API route, use the read-only sweep:

```bash
RAPIDRMS_DISCOVERY_FAMILY=timeclock pnpm exec tsx scripts/rapidrms-read-endpoint-discovery.ts
RAPIDRMS_DISCOVERY_FAMILY=reports pnpm exec tsx scripts/rapidrms-read-endpoint-discovery.ts
```

Optional environment:

- `RAPIDRMS_DISCOVERY_DATE=YYYY-MM-DD`
- `RAPIDRMS_DISCOVERY_CONNECTOR_ID=<connector uuid>`
- `RAPIDRMS_DISCOVERY_LIMIT=300`
- `RAPIDRMS_DISCOVERY_INCLUDE_TENANT=1`

The sweep only attempts GET and clearly read-shaped POST routes such as `Get`,
`List`, `Report`, and `Search`. It intentionally excludes mutation verbs
including Add, Save, Update, Edit, Delete, Void, ClockIn, and ClockOut.

Discovery output is not a production contract by itself. Promote a route only
after a focused fixture/test pins the method, path, required parameters,
envelope shape, row keys, date-boundary behavior, empty-state behavior, and any
application-level error flag.
