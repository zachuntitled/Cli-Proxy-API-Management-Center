# Cursor subscription integration

Verified 2026-09-16: **connected to the Untitled router** using the intended Pro+ account. The Cursor account dashboard showed **On-Demand Usage is Off**; no billing settings were changed.

## Deployment

The main router remains upstream CLIProxyAPI v7.3.4. Cursor uses the community `yobo2u/omsub` plugin v0.5.10 in a separate instance of the same binary. The archive and contained plugin checksums were verified against the release assets.

- [Plugin registry](https://github.com/router-for-me/CLIProxyAPI-Plugins-Store/blob/main/registry.json)
- [Pinned release](https://github.com/yobo2u/omsub/releases/tag/v0.5.10)
- Archive SHA256: `5bf24a9a3a4c675d6e1eda3fc90025fa0e24abac6970d51a7083af997d13de52`

`cliproxyapi-cursor-test.service` is enabled at boot and listens only on `127.0.0.1:18317`. Its dedicated `cursor-router-test` Unix account and private state directory isolate its OAuth credentials from the main router's Codex credentials. Systemd restricts filesystem writes to its own configuration/state, protects home directories, and prevents privilege escalation. The main router loads no Cursor plugin.

The main router's `cursor-subscription` OpenAI-compatible provider forwards three explicit model names to this local instance:

- `cursor/composer-2.5`
- `cursor/cursor-grok-4.6-low`
- `cursor/claude-fable-5-low`

Only these tested models are exposed. Existing Codex credentials, routing, and the default model remain unchanged. These explicit names select Cursor; they do not enter the Codex credential pool. Main configuration comparison found only `openai-compatibility` changed, and the main router was not restarted.

## Verified behavior

- OAuth completed with the intended account; authentication persisted after restarting the isolated service.
- Client authentication and management authentication remain separate. Unauthenticated inference and client-key management calls returned 401.
- All three models completed a Responses request through the main router. The existing `gpt-5.6-luna` route also passed.
- Composer passed non-streaming and streaming Chat Completions, tool calls and tool-result continuation, multi-turn continuity, translated Responses, streaming Responses, and invalid-model rejection.
- A client disconnect ended the gateway request. Upstream cancellation and billing effects were not independently established.
- Composer generated a Python function through a Responses function call; it passed 10 independent cases.
- The actual `codex-router` client selected `cursor/composer-2.5`, read a bounded fixture, implemented its Python function, and ran the unchanged four-test suite successfully. Independent host verification also passed. Codex displayed an unknown-model metadata warning; the request still used the explicitly selected Cursor model.

## Status and usage boundaries

The dashboard reports **Configured** from the normalized provider configuration. This means a usable route is configured, not that a live health or quota check succeeded. Loading and failed configuration reads show an unavailable state; disabled providers show disabled.

The plugin does not expose subscription quota. A separate [read-only usage bridge](cursor-usage.md) now queries Cursor's account usage endpoint using the isolated service's existing OAuth credentials. The dashboard shows Cursor Models and Other Models as separate percentages used, with observation and reset dates. These readings establish usage availability, not inference health. Missing or expired data is unavailable; no token-based quota estimates are shown. Cursor remains excluded from Codex subscription counts and quota meters. The internal usage endpoint can change; Cursor's account dashboard remains the fallback. Registry inclusion is not Cursor endorsement; this community provider uses Cursor CLI protocol/OAuth endpoints rather than the official agent SDK.

## Operations and rollback

On `cloud-1`, inspect `systemctl status cliproxyapi-cursor-test` and its journal for connection or authentication failures. The service can restart independently of the main router. A healthy route returns a completed response for an explicit Cursor model; repeated authentication/upstream errors or failures in previously working Codex requests warrant rollback investigation.

To disable this integration, disable the `cursor-subscription` provider in provider settings, then stop the isolated service if needed. Preserve its private credentials for a reversible rollback; do not paste them into this repository. Private test evidence and pre-change configuration backups are under the operator's `~/.config/cliproxyapi-cursor-test/` directory on the VM.

The official [Cursor Python SDK](https://prod.cursor.com/docs/sdk/python) remains a separate agent-job alternative. It is not the transport used here.
