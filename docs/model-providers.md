# Model providers

Settings → General → 模型供应商 reads the selected execution host's Codex configuration. Each provider has a Yard enable/disable switch. The composer model list opens providers first, then that provider's models. The existing Power control adjusts the selected model's supported efforts. DeepSeek Flash and V4 Pro offer Low, High and Max; Flash accepts images.

Enablement is stored per host in Yard's `native-state.json`. Disabling a provider hides its models and prevents subsequent selections; an executing turn continues. Re-enabling refreshes the model menu without reloading the page. New-chat model choices save the model and provider together in the existing default/profile configuration. Existing-chat choices apply to that chat.

## Configuration and catalogs

Keep existing `[model_providers.<id>]` entries. For DeepSeek, add:

```toml
[model_providers.DeepSeek]
name = "DeepSeek"
base_url = "https://api.deepseek.com/"
wire_api = "responses"
env_key = "DEEPSEEK_API_KEY"
requires_openai_auth = false
```

Provide the key to the Codex backend's environment before starting it. Keys and provider authentication configuration stay on the host. Yard sends sanitized provider labels, state and model metadata to the browser. Do not put keys in this repository or browser storage. Codex also supports its existing private bearer-token configuration.

The current provider's catalog comes from Codex `model/list`, retaining the user's configured model metadata. Other providers can supply a catalog through an existing Codex profile:

```toml
[profiles.my_provider_catalog]
model_provider = "my_provider"
model_catalog_json = "/absolute/path/to/my-provider-models.json"
```

The catalog uses Codex's `models` / `slug` metadata format. A provider should have one catalog profile. For a provider without a catalog profile, Yard supplies DeepSeek's documented capabilities when its endpoint is `api.deepseek.com`. Other local providers are discovered using their authenticated `/models` endpoint. Recognized model IDs reuse native metadata; unfamiliar IDs have no inferred reasoning efforts. A failed directory leaves the other providers available and appears in Settings on its next read. Remote providers use their host's profile catalog or the built-in DeepSeek metadata; Yard does not use local environment credentials to discover a remote provider's models.

DeepSeek's catalog is injected only into DeepSeek sessions. Yard does not change the global `model_catalog_json` or replace the existing GPT catalog. API calls go directly from Codex to the selected provider. Provider-qualified IDs are confined to the Yard browser protocol, so equal model names route independently.

## CLI compatibility

Verified with **Codex CLI 0.164.0** and the pinned UI **26.1013.40934**. No CLI upgrade is required for this integration. Start and fork pass Codex's native `modelProvider`. Changing an idle conversation on 0.164 releases Yard's subscriptions, resumes the same thread with the selected provider, verifies the result and restores subscriptions. History, collaboration mode, approval and sandbox settings are retained. Running turns and sessions still held by another client return an actionable error without sending a model turn. A session must already have a saved rollout before switching providers; for a fresh unsaved session, choose the provider on the new-chat page before sending.

CLI 0.166 and later require a new/forked conversation for a different provider. Yard rejects that cross-provider operation with guidance to create a new conversation. Validate CLI upgrades separately before replacing a shared backend.

## Validation

Run `npm run typecheck` and `npm test`. After building, run:

```sh
flock /tmp/agents-workbench-heavy.lock npm run test:model-providers:ui
```

This starts a disposable real CLI and two loopback Responses providers. It checks duplicate names, an actual command tool loop, same-thread round trips, settings persistence, menu refresh, DeepSeek effort selection, and phone layout. It never opens a personal chat or shared daemon. Mask the desktop installation for standalone validation. Private evidence is saved under `.local/model-providers/`.

An explicitly authorized live check accepts `YARD_TEST_DEEPSEEK_KEY` and `--live-deepseek`; it sends only its synthetic command-tool prompt. The key is excluded from evidence. To roll back the integration, disable the provider in Settings or remove its added config entry; retain the previous source commit and do not change the original provider/default catalog.

Capability reference: [DeepSeek's official Codex guide](https://api-docs.deepseek.com/quick_start/agent_integrations/codex/).
