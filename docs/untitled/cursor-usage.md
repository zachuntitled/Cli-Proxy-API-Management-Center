# Cursor subscription usage bridge

The bridge reads the isolated Cursor service's existing OAuth file and queries only
`https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage` using a
POST with `{}`. It never refreshes tokens or writes credentials. The plugin remains
the credential owner. Usage availability does not establish inference health.

## Response contract (version 1)

`GET http://127.0.0.1:18318/usage` returns HTTP 200 and exactly these JSON fields,
including when authentication or the upstream service is unavailable:

```json
{
  "version": 1,
  "status": "fresh",
  "cursorPercentUsed": 0.4491666667,
  "otherPercentUsed": 0.4909090909,
  "observedAtMs": 1800000000000,
  "cycleStartMs": 1799000000000,
  "cycleEndMs": 1801000000000
}
```

The numbers above are illustrative. `status` is `fresh`, `stale`, `auth_required`,
or `unavailable`. The remaining fields are numbers or null; dates are integer Unix
milliseconds. `auth_required` and `unavailable` null every data field. A missing or
invalid pool is null independently, never zero. Both missing pools are unavailable.
Upstream `planUsage.autoPercentUsed` maps to Cursor Models and
`planUsage.apiPercentUsed` maps to Other Models. These are percentage points, so
0.45 means 0.45%, not 45%. Valid zero and over-100 values are preserved. The browser
may clamp bar widths only. Cycle dates come from `billingCycleStart` and
`billingCycleEnd`; a reported cycle already ended is unavailable.

Only the bridge retains snapshots, in memory. Fresh observations cache for 60
seconds with the original successful-fetch timestamp. A transient timeout, 429,
or 5xx may return a stale snapshot for less than five minutes since observation,
only with a known cycle end still in the future. Billing rollover invalidates even
a cache younger than 60 seconds. Failure retries have a 15-second delay and requests
share one in-flight fetch. Malformed payloads, redirects, other non-success HTTP
statuses, missing/disabled credentials, and upstream 401/403 never reuse stale data.
Authentication errors are a usage state, not an outer management HTTP 401/logout.
The browser must clear snapshots on transport errors and route/session changes.

Every request checks a memory-only SHA-256 fingerprint of the exact credential
file identity/content. A second check after fetching rejects results if credentials
changed mid-flight. Tokens, raw payloads, account identifiers, error bodies, and
fingerprints never appear in responses or logs. Successful replies use `no-store`.
The transport ignores proxy environment variables, uses verified system TLS roots
without environment CA overrides, refuses redirects, and bounds response size to
64 KiB. Socket operations and response reading have an eight-second deadline.

Only the exact `/usage` GET path is supported; queries and caller authorization
headers are rejected. Host must be `127.0.0.1:18318`, and Origin must be absent.
There is no CORS. The authenticated main management `/api-call` with direct proxy
mode is the remote access boundary; local host processes are trusted. These checks
are defense in depth, not local authentication.

## Installation skeleton

1. Verify port 18318 is free and that `cursor-router-test` already exists as the
   isolated service user. Keep the two existing inference services running.
2. Identify the exact existing Cursor OAuth file from the isolated service's
   configuration. Verify the service user can already read it. Do not print its
   contents, copy credentials, change ownership, or widen permissions.
3. Install `server/cursor_usage.py` as root-owned, mode 0644 at
   `/opt/untitled-cursor-usage/cursor_usage.py`; the directory should be root-owned,
   mode 0755. Python 3 with its standard library and OS CA roots is sufficient.
4. Copy `deploy/untitled-cursor-usage.service` to
   `/etc/systemd/system/untitled-cursor-usage.service`. Replace `@CURSOR_AUTH_FILE@`
   with that exact file path, quoting it using systemd argument syntax if needed.
   The path is configuration, never a token. The service deliberately requires
   `--auth-file`; directory discovery/account selection is unsupported. Do not pick
   the first file from a directory with multiple matching credentials.
5. Run `systemd-analyze verify` against the installed unit, then
   `systemctl daemon-reload` and `systemctl enable --now untitled-cursor-usage`.
   Verify the listener is IPv4 loopback only and the normalized local response has
   no extra fields. Verify the same response through authenticated management
   `/api-call` before deploying dashboard HTML.

The unit runs as the existing user with a read-only filesystem, empty capabilities,
no privilege escalation, and no credential environment variables. No permission
changes to existing auth files are needed. If this user's credential path cannot be
read under the sandbox, correct the path/sandbox narrowly; do not broaden file
permissions. The supplied unit is a template and must not be started before path
substitution.

## Local tests and rollback

Run `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s server -p 'test_*.py'`.
All fixtures and transports are fake; tests make no live Cursor requests. Include
this focused command in CI alongside the existing frontend checks.

To roll back, restore the previous dashboard HTML, then stop and disable only
`untitled-cursor-usage.service`. Leave existing inference services and their OAuth
files intact. Deployment evidence and the served dashboard check belong to the
rollout record; unit tests alone do not establish live behavior.

## Verified rollout: 2026-09-16

The bridge was installed on `cloud-1` with an IPv4 loopback listener. Both direct
and authenticated management requests returned the version 1 allowlist, with
Cursor Models at 0.5208333333% used and Other Models at 0.4909090909% used.
Unauthenticated management requests returned 401, and port 18318 refused remote
connections. Existing Cursor OAuth ownership and mode 0600 were preserved.

The deployed dashboard displayed 0.52% and 0.49%, plus the provider's October 15
reset date. Desktop and 390px layouts were inspected; Codex filtering preserved
the Cursor card. Stopping only the bridge produced Usage unavailable while Codex
cards continued refreshing; restarting it restored the two live readings. There
were no browser console errors before the intentional outage. The dashboard
refreshes while visible, and clears expired observations rather than inventing
stale usage. Browser suspension and provider-side billing rollover are covered by
expiry/invalidation tests rather than a live billing-cycle wait.

Validation passed: 711 frontend tests, ESLint, TypeScript, production build, and
17 Python bridge tests. CI runs both suites. The initial deployed HTML SHA-256 was
`1aa2d7e55c1c06be088131be2a5166f881eec680cec2a9547491b5f1883bf479`;
the previous HTML was retained as `management.before-cursor-usage-6551899.html`.

During verification, a concurrent provider configuration replacement left the
main configuration root-owned and unreadable to its service user. Restoring
`cliproxyapi:cliproxyapi` ownership, retaining mode 0600 and all configuration
content, restored service. Future atomic configuration replacements must preserve
ownership as well as mode. This repair did not change provider or billing settings.

The reviewed refresh fix preserves a current observation during routine config
reads and requests fresh Cursor usage at its own expiry or visible-tab resume.
Clock-driven tests cover the 59-second cache/poll offset, hidden expiry, resume,
billing reset and listener cleanup. The final deployed UI showed 0.57% / 0.49%;
its observation advanced automatically across the next minute without the old
unavailable gap in sampled browser checks. Final HTML SHA-256:
`e5bde64815a1e13dbc9ea606e2cd2f6093ccb2a50923cabfbe5c48deb5865455`.
