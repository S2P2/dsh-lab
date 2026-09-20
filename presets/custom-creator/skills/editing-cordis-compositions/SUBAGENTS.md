# Native product subagents

Load this reference when exposing Codex or Claude Code delegation from an agent preset, or when configuring additional named instances of those providers.

## Separate provider availability from preset exposure

Native product providers are optional Host-side Profile Bundles. The Host owns provider availability; an agent preset only grants one session the corresponding delegation Tool.

For the default providers, install only the product bundles the Profile needs, then restart that Profile so the Host can register them:

```sh
dsh plugin --profile <name> add @deepseek-ai/dsh-subagent-codex
dsh plugin --profile <name> add @deepseek-ai/dsh-subagent-claude-code
dsh plugin --profile <name> remove @deepseek-ai/dsh-subagent-codex
dsh plugin --profile <name> remove @deepseek-ai/dsh-subagent-claude-code
```

Confirm current package names and CLI syntax from the installed DSH environment when they may have changed.

A preset cannot supply the missing Host provider. Enabling a delegation Tool without its provider leaves the consumer without the dependency it needs.

## Preset tool rows

Start from the corresponding disabled rows in the current full/shipped preset rather than treating this file as an authoritative cache of composition syntax. At the time this custom preset was derived, the rows had this shape:

```yaml
- id: tool-subagent-codex
  name: '@deepseek-ai/dsh-tool-subagent'
  disabled: true
  config:
    provider: codex
    toolName: subagent_codex
    backgroundMode: one-shot
    maxDepth: provider-managed

- id: tool-subagent-claude-code
  name: '@deepseek-ai/dsh-tool-subagent'
  disabled: true
  config:
    provider: claude-code
    toolName: subagent_claude_code
    backgroundMode: one-shot
    maxDepth: provider-managed
```

Enable only the products requested by the user. Leaving both disabled preserves the copied preset; enabling one exposes only that product's delegation Tool.

Keep the normal Jobs Tool when the preset supports background delegation so users can inspect, list, cancel, and receive completion notices for background jobs.

## Additional named instances

For an additional Codex or Claude Code instance:

1. configure a separate Host-plane provider row from the installed provider package;
2. give it a unique `providerName`;
3. add a separate preset delegation Tool row whose `provider` exactly matches that provider name;
4. give each exposed Tool a unique `toolName`;
5. retain the default rows for the default provider names rather than overloading one Tool row for several providers.

Provider identity belongs to provider configuration. Keep it independent of permission settings, credentials, or environment-derived names.

## Product boundaries

Installing a provider bundle or enabling a preset Tool does not authenticate the native product, select its model, probe credentials, or manage product-specific settings. Those remain concerns of the native provider/product environment.

Keep provider packages and registries on the Host plane. Keep only the delegation Tool contribution in the agent preset. If ownership is uncertain, apply the plane test in `SKILL.md` and the Service rules in [`REALMS.md`](REALMS.md).