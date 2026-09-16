# OpenRouter models in Codex

The router exposes six explicitly selectable OpenRouter models alongside the existing subscription providers. Requests to these aliases use the configured OpenRouter account balance. They are not automatically substituted for subscription models.

| Upstream model | Codex alias |
| --- | --- |
| anthropic/claude-fable-5.1 | openrouter/claude-fable-5.1 |
| anthropic/claude-opus-5 | openrouter/claude-opus-5 |
| z-ai/glm-5.3-flash | openrouter/glm-5.3-flash |
| deepseek/deepseek-v4.1-flash | openrouter/deepseek-v4.1-flash |
| qwen/qwen3.8-flash | openrouter/qwen3.8-flash |
| qwen/qwen3.8-max-0902 | openrouter/qwen3.8-max-0902 |

## Configuration

`provider.example.json` is a credential-free provider object for CLIProxyAPI's `openai-compatibility` array. Supply one `api-key-entries` object containing an `api-key` through private server configuration or the authenticated management interface. The empty example credential list is intentional; the template alone cannot send requests.

Preserve other providers when adding this object. Back up the current configuration first. For atomic file replacements, preserve the existing owner, group, and permissions, and verify that the service user can read the resulting file before restarting. A replacement that becomes root-owned with mode 0600 can prevent the service from starting.

Use the configured listening address for health checks; a service bound to a specific interface may not accept localhost requests. After configuration reload or restart, check service health and confirm all six aliases in `/v1/models`. Codex's model catalog uses `/v1/models?client_version=<client-version>` and returns `models` entries with `slug` fields.

Keep the OpenRouter key on the server. Never commit populated provider configuration, management credentials, or temporary key-entry files. Remove temporary local credential files after successful installation.

## Verified rollout

The setup was verified on CLIProxyAPI 7.3.4 on September 16, 2026:

- All six exact upstream IDs existed in OpenRouter's public catalog and advertised tools.
- Each alias passed a streaming `/v1/responses` request that called an `add` tool with integers 2 and 3.
- A second request supplied the tool result; each model returned `5` and a completed response event.
- The router advertised all six aliases in both API and Codex model catalogs.
- The service was active and its configuration was readable by the service user.
- The user confirmed all six models appeared in the Codex model picker.

These checks establish basic streaming and tool-round-trip compatibility, not a comprehensive coding benchmark. Catalog metadata and provider availability can change; recheck them when updating this configuration. If an already-running Codex instance does not show refreshed models, reopen the app.

# Account credits bridge

The read-only bridge fetches account-wide purchased credits and usage from
`GET https://openrouter.ai/api/v1/credits`. It does not report the API key's
optional spending limit and does not change inference routing or configuration.

## Contract and boundaries

`GET http://127.0.0.1:18319/credits` returns exactly:

```json
{"version":1,"status":"fresh","totalCredits":100,"totalUsage":23.5,"remainingCredits":76.5,"observedAtMs":1800000000000}
```

These are synthetic example values in USD. Status is `fresh`, `auth_required`
(upstream HTTP 401/403), or `unavailable`. All four data fields are null on
failure. Finite nonnegative total and usage values are required; remaining is
clamped at zero. Fresh results cache for 60 seconds without changing their
observation timestamp. Errors immediately clear money data and impose a
15-second retry cooldown. There is no stale monetary fallback.

The existing `/etc/cliproxyapi/config.yaml` is read with `yaml.safe_load`, bounded
to 64 KiB. Exactly one enabled `openai-compatibility` entry named `openrouter`
must have `base-url: https://openrouter.ai/api/v1` and exactly one enabled
`api-key-entries` key. Missing, malformed, unreadable, or ambiguous configurations
return unavailable. Full config contents and file identity invalidate the cache;
a second identity check discards a result if configuration changed in flight.

The destination and method are fixed. TLS verifies against system roots;
proxy/CA environment overrides and redirects are ignored. Responses have a
64 KiB limit and an eight-second socket/deadline bound. The loopback HTTP server
rejects unexpected Host, Origin, Authorization, request body, path, and methods.
All responses are `no-store`; raw provider payloads, credentials, requests, and
exception text are not logged or exposed. It must not be reverse-proxied or
bound to an external interface.

## Installation on the router

Prerequisites: Python 3, Ubuntu's `python3-yaml` package, the existing
`cliproxyapi` service user with read access to its existing 0600 configuration,
and free loopback port 18319. Keep the config owner/mode unchanged. The bridge
runs under that user with a read-only filesystem and no added capabilities.

From this repository on the server:

```sh
sudo apt-get install python3-yaml
sudo -u cliproxyapi /usr/bin/python3 -c 'import yaml'
sudo -u cliproxyapi test -r /etc/cliproxyapi/config.yaml
sudo ss -ltn '( sport = :18319 )'
sudo install -d -m 0755 /opt/untitled-openrouter-credits
sudo install -m 0644 server/openrouter_credits.py /opt/untitled-openrouter-credits/openrouter_credits.py
sudo install -m 0644 deploy/untitled-openrouter-credits.service /etc/systemd/system/untitled-openrouter-credits.service
sudo systemd-analyze verify /etc/systemd/system/untitled-openrouter-credits.service
sudo systemctl daemon-reload
sudo systemctl enable --now untitled-openrouter-credits.service
sudo systemctl is-active untitled-openrouter-credits.service
```

For an update, preserve the prior bridge script/unit as rollback files before
installation, then restart only `untitled-openrouter-credits`. No inference
service restart or provider config replacement is required.

## Smoke checks

Inspect the local normalized response privately with
`curl --fail --silent http://127.0.0.1:18319/credits`. It must be fresh with only the
six documented fields. Check `ss -ltnp '( sport = :18319 )'` shows only 127.0.0.1.

Through the authenticated management API, POST `/v0/management/api-call` with
this body using the current management session:

```json
{"method":"GET","url":"http://127.0.0.1:18319/credits","proxy_url":"direct"}
```

Do not add an OpenRouter bearer header: the bridge reads the key privately.
Check the management wrapper's successful `status_code` and parse its `body` as
the contract above. Compare the normalized balance with the displayed amount;
do not save actual balances or secrets in evidence. Verify an unauthenticated
remote management call is rejected, the bridge port is inaccessible remotely,
and existing inference services/model catalogs remain available.

Local tests use fake transports and an isolated dependency environment:

```sh
python3 -m venv /tmp/router-credits-tests
/tmp/router-credits-tests/bin/pip install -r server/requirements.txt
PYTHONDONTWRITEBYTECODE=1 /tmp/router-credits-tests/bin/python -m unittest discover -s server -p 'test_*.py'
```

## Rollback

Stop and disable only `untitled-openrouter-credits.service` for a first-install
rollback. For an update, restore the saved bridge script/unit, run
`systemctl daemon-reload`, and restart that bridge. Restore the separately backed
up dashboard HTML if rolling back the UI. Keep the existing provider config,
credentials, and inference services intact; the UI treats an absent bridge as
unavailable.
