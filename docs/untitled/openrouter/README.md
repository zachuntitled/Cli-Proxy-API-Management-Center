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
