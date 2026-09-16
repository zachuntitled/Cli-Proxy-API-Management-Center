# Untitled Router workflow

This fork customizes the official CLIProxyAPI Management Center for the verified Untitled Creative routing setup. The Go routing service remains upstream v7.3.4. Preserve the single-file build and upstream management functions.

## Run a coding task

The personal Mac has a dedicated `untitled-router` Codex profile and a `codex-router` launcher:

```sh
cd /path/to/untitled-project
codex-router
# Or a bounded noninteractive task:
codex-router exec "Implement the change and run its relevant tests."
```

The launcher selects a mode-0600 profile outside this repository. The profile stores the dedicated client key using Codex’s file-based `experimental_bearer_token` provider field; no key is exported into the process environment. The provider uses the Responses API over the private Tailscale connection. Default model: `gpt-5.6-luna`, low reasoning. The profile disables inherited MCP servers and apps for this initial coding route. The launcher selects workspace-write sandboxing. Existing default Codex login and base configuration were not modified.

Do not add `--ignore-user-config`: in the installed Codex CLI 0.153.4 that also skips the named profile. This was caught during verification; the un-routed attempt was stopped and is excluded from the result below. A profile load failure must be fixed before treating the run as routed.

Private files (on the personal Mac):
- `~/.codex/untitled-router.config.toml`
- `~/.local/bin/codex-router`

Never copy the client key, management key, or upstream OAuth credentials into this fork. A live shell check showed that an environment exclusion did not remove the initial environment-based key. The profile was changed to file-based bearer authentication, and the launcher removes any stale `UNTITLED_ROUTER_API_KEY` variable. The repeated live check passed with `KEY_NOT_IN_TOOL_ENV` (exit 0). Client and management credentials have different permissions.

## Verified coding task — 2026-09-15

Codex CLI through the dedicated provider implemented `src/features/untitled/quotaFormat.ts` plus `tests/untitledQuotaFormat.test.ts`.

The helper converts used percentage to remaining percentage, clamps finite values into 0–100, and preserves absent/invalid values as null. This ensures missing account quota cannot appear as a full allowance.

- Profile connectivity check returned `ROUTED_CLIENT_OK`; CLI banner identified provider `untitled_router` and model `gpt-5.6-luna`.
- Actual task: 8 successful Business requests; Pro successful requests unchanged; no failures on either account.
- Before: Pro 5 successful / 0 failed; Business 4 successful / 0 failed.
- After: Pro 5 successful / 0 failed; Business 12 successful / 0 failed.
- The task demonstrated reading files, writing tests, running a failing test, implementing code, and rerunning tests.
- Independent host verification: `bun test tests/untitledQuotaFormat.test.ts` — 11 passed, 0 failed.

The implementation task is an integration test of the requested Codex profile. It was launched directly with that installed client; CE's generic external author adapter does not expose this custom provider/profile selection. The remainder of the frontend implementation uses native CE execution.

## Routing behavior

The router uses round-robin selection across eligible Pro and Business credentials with session affinity enabled. Four independent smoke sessions selected Pro, Business, Pro, Business. Repeated sessions stayed on the original account. This balances new sessions, not exact token counts, subscription prices, or quota percentages. Different models and unavailable credentials can change selection.

OpenAI API credits are not in the verified model pool. Cursor is available through explicitly selected model names in a separate provider; it does not join the Codex round-robin credential pool. No Paleovalley integration is part of this workflow.

## Build and operational verification

```sh
bun install --frozen-lockfile
bun run verify
```

The deployable output is `dist/index.html`, installed as the service's `management.html`. Preserve a copy of the current panel before replacing it. The server has panel auto-update disabled so a custom build is not overwritten.

After deployment, verify the authenticated overview shows live Pro and Business credentials, quota timestamps/reset windows, the current routing strategy, and correct unavailable states. Verify Manage, Logs, Settings, refresh, logout, and narrow-screen navigation. Account counters are gateway activity and can reset with the service; quota comes from the upstream account endpoint and includes usage outside this gateway.


## Dashboard validation — 2026-09-15

- `bun run verify`: 660 tests passed across 89 files, 0 failed; ESLint, TypeScript, and the single-file production build passed.
- Live Ubuntu panel: both subscriptions active; account totals and provider-reported quota loaded successfully. The Pro account exposed only a weekly window, so the five-hour meter correctly showed Unavailable.
- Business-only filter, manual refresh, automatic refresh, Manage, Logs, Settings, the standard layout fallback, and return to the custom overview were verified. Logout removed the protected dashboard; signing back in restored live data.
- Desktop appearance was inspected. Narrow layouts stacked the account cards, and DOM measurements showed no document-level horizontal overflow at observed widths of 425 and 845 CSS pixels. The browser viewport screenshot tool produced capture artifacts at overridden sizes, so those captures were not used as polished visual evidence.
- Browser console: no warnings or errors observed during these checks.
- A stock panel backup is retained on the VM for rollback. Static panel replacement does not require restarting the proxy or changing routing credentials.

Simplification retained the quota and session safety checks. Shared object, provider, and credential-index helpers replaced duplicate normalization; status precedence and test imports were clarified. Additional aggregate caching and worker-pool machinery were not justified for the current two-account setup.


## Review and fixes

`ce-code-review` completed with run ID `20260915-170349-f0e58920`. Seven local review lenses and one cross-model pass produced four validated findings. All four were resolved: omitted false affinity values, unsupported plugin navigation, coupled account/config refresh failures, and a source import alias. The external route requested Grok through Cursor but did not attest the actual serving model, effort, or independence.

The refresh regressions exercise successful accounts with failed/slow config, account failures, aborts, and obsolete-request completions. A full browser test that switches servers or management keys during a pending request is not automated; the callback boundary is tested and the live logout/login path was verified. That initial review left no security findings or unresolved actionable findings.


## PR feedback follow-up — 2026-09-15

The later GitHub review raised four additional findings: three fixed in this follow-up and one declined under the overview’s existing product scope. These are separate from the four initial local review fixes above.

The overview now fetches quota when a credential has an auth index but no account ID header, and uses a successful usage response’s plan metadata before auth-file metadata. Eight regression cases cover account selection, plan precedence, normalization, and fallback. Exact five-hour and weekly duration classification is unchanged; monthly quota display remains outside this overview’s scope.

The custom layout now uses the existing `PageTransition` component for document scroll reset and history restoration. `bun run verify` passed with 660 tests, ESLint, TypeScript, and the single-file production build. Local browser verification was unavailable because browser tab creation failed; the deploying maintainer still needs to verify custom-route navigation and back/forward scroll behavior against the installed artifact.


## Cursor coding route — 2026-09-16

The intended Cursor Pro+ account is connected through an isolated local provider. On-demand usage was visibly off during verification. Choose a tested model explicitly:

```sh
codex-router -m cursor/composer-2.5
codex-router -m cursor/cursor-grok-4.6-low
codex-router -m cursor/claude-fable-5-low
```

The default remains `gpt-5.6-luna`. The Codex client completed a real fixture task through Composer: it read the files, replaced the implementation stub, and passed all four existing tests. Independent host verification passed too. Additional API contract tests exercised streaming, tools, continuation, errors, and Responses translation. All three exposed models and the existing Codex model passed requests through the main endpoint.

The dashboard's Cursor card reflects provider configuration and links to provider settings. It deliberately shows no remaining subscription balance, because the plugin cannot provide one. See [Cursor integration](cursor-investigation.md) for pinned versions, isolation, verification boundaries, and rollback.

Frontend validation: `bun run verify` passed 691 tests across 91 files, ESLint, TypeScript, and the single-file build.

Live browser validation: the deployed overview showed Cursor Pro+ as Configured, unavailable subscription remaining, and all three Codex accounts. The Cursor link opened provider settings, where `cursor-subscription` was active with three models and successful requests. Returning to the overview after a reload preserved these states. The section now reads Other integrations. Native browser inspection was used because extension tab control was unavailable; browser console inspection was not available through that route.

The deployed single-file artifact SHA256 is `3f38a270cb4540d63f2fc6a8194a2480f85069e938fa10fbe74f851643e9aac6`. A pre-change panel backup is retained as `management.pre-cursor-20260916.html` on the VM. Both router services remained active after the panel replacement.

Review `20260916-001424-3897b9f9` completed with seven local lenses and a Grok-through-Cursor pass. The serving model identity was not independently attested. One validated finding was fixed: every Cursor card state now links to provider settings, including an incomplete route. Its regression test failed before the fix and passed afterward. No actionable finding remains. Mounted-hook credential-switch coverage is still a test limitation; the refresh coordinator and state classifier are tested separately.
