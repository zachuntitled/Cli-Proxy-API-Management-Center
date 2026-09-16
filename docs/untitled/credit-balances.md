# Pro Lite and Codex / Work credit balances

The Untitled overview distinguishes Pro Lite from Pro and Business in account titles and filters. It recognizes the provider's `prolite`, `pro-lite`, and `pro_lite` values through the existing Codex plan-tier mapping.

Each account card reads usage credits from that credential's existing usage response. These are Codex / Work credits, not an API billing balance, and this display does not change routing, spending controls, or automatic reload.

- A finite numeric balance (including a decimal string) is displayed with locale-aware formatting. Zero and negative balances remain explicit.
- `unlimited: true` displays Unlimited.
- `has_credits: true` without a usable balance displays Available, with an explanation that the provider did not report a balance.
- Missing, invalid, or failed responses display Unavailable; they do not become zero or reuse another account's balance.

The user confirmed that the previously described $1,000 API credit promotion is the Untitled Creative Business workspace's 25,000 Codex / Work credits. The Business usage endpoint currently reports availability without a numeric balance. The dashboard does not hard-code a screenshot balance or infer an expiration date.

## Validation

Parser, API-response, filtering, and server-rendered component tests cover Pro Lite aliases, numeric/zero/negative/fractional balances, unavailable and unlimited states, invalid data, and request failure. The existing account/config refresh and stale-session guards remain unchanged.

The sibling backend checkout is absent. This change preserves all endpoint and request contracts; response fields were verified through the installed router's authenticated per-account usage endpoint and the existing cached backend source.

## Post-deploy validation

On the authenticated overview, verify Pro, Pro Lite, and Business remain active; Pro Lite has its own filter; each card shows the provider's credit state; the Business card explains why its number is unavailable. Check desktop and phone layouts and browser errors after one refresh. If account loading, filtering, or layout regresses, restore the previous static panel backup. Routing and credentials do not need modification or a service restart.

Observed local preview: all three live accounts loaded; Pro displayed 2,500, Pro Lite displayed 0, and Business displayed Available with the missing-balance explanation. Pro Lite and Business filters selected the correct cards. Desktop and 390-pixel phone layouts were inspected with no horizontal overflow or browser warnings/errors. The complete verification run passed 684 tests across 90 files, lint, TypeScript, and the single-file production build.

The production panel on Ubuntu was also verified with all three live accounts, the Pro Lite filter, and no console errors. Installed single-file SHA-256: `7db3ce06f8375a7c6e0e5b7323f526258956a44362527e89c82929ab2dbb00b8`. Previous panel backup: `/var/lib/cliproxyapi/static/management.before-credits-3f1f67a.html`.
