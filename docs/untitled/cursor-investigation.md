# Cursor Pro+ integration investigation

Checked 2026-09-15. Status: **not connected to this router**. Neither option below has been authenticated or run against the user's intended Pro+ account as part of this investigation.

## Official agent-job integration

Cursor provides a Python agent SDK with local and cloud execution. Personal user API keys can authenticate SDK calls. Existing CLI login does not prove SDK access or the selected identity.

The SDK documentation states usage follows the IDE/Cloud pricing and request pools. `get_usage()` can expose billed cost after settlement; missing cost is unknown. Available models and billing/overage settings must be checked for the actual Pro+ account. This is an agent job interface, not a raw OpenAI-compatible inference API. Route complete bounded jobs to it rather than assuming it can replace an in-progress Codex model call.

- [Official Python SDK](https://prod.cursor.com/docs/sdk/python)
- [Official SDK authentication](https://github.com/cursor/plugins/blob/main/cursor-sdk/skills/cursor-sdk/references/auth.md)
- [Models and pricing](https://cursor.com/docs/models-and-pricing)

## Community CLIProxyAPI provider

The official CLIProxyAPI plugin registry now lists `cursor` by `yobo2u`, from `yobo2u/omsub`. Native v7.3.4 core has no Cursor executor, but this plugin offers another path.

- [Registry](https://github.com/router-for-me/CLIProxyAPI-Plugins-Store/blob/main/registry.json)
- [Plugin source](https://github.com/yobo2u/omsub/tree/cursor/cursor-plugin)
- [Published v0.5.10 release](https://github.com/yobo2u/omsub/releases/tag/v0.5.10)

The latest published release observed was v0.5.10; branch documentation described source v0.6.1. The author reports Linux amd64 validation against CLIProxyAPI v7.2.154, which is not proof against our v7.3.4 installation. It uses Cursor CLI protocol/OAuth endpoints rather than the official agent SDK. Chat Completions is exposed under `cursor/<model>`; Responses depends on gateway translation. Remaining subscription quota is unavailable, and reported tokens are estimates rather than billing evidence. Registry inclusion does not establish compatibility or Cursor endorsement.

## Recommended next experiment

For adding Cursor specifically to the model pool, test the pinned community plugin in a separate router instance, with the intended personal account and verified overage controls, before enabling it in the existing service. Exercise model discovery, ordinary responses, streaming, tools, multi-turn continuity, cancellation, errors, and usage attribution. Record the exact plugin/server versions and distinguish estimated tokens from settled charges. If this contract cannot be verified, use official SDK agent jobs as a separate route.

For now the dashboard should label Cursor **Not connected**, link to the integration options, show no fabricated quota, and exclude it from active account counts/balancing. The local Cursor CLI was present and reported authenticated, but identity and subscription billing were deliberately not inspected or changed.
