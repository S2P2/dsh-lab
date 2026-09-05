# Upstream provenance

This preset is derived from DeepSeek Harness Creator (`cordis`) mode.

Upstream repository: `deepseek-ai/deepseek-harness`

Composition reference revision: `cd5ef8148158c3a752a658978873241fdf8e2bbc` (`master`, 2026-08-28)

Authoring API sync baseline: installed `@deepseek-ai/dsh-agent-presets` and `@deepseek-ai/dsh-tool-cordis` version `0.1.2-rc.1`.

Primary source paths:

- `packages/preset/agent-presets/presets/cordis/agent.cordis.yml`
- `packages/preset/agent-presets/presets/cordis/preset.yml`
- `packages/preset/agent-presets/presets/cordis/skills/editing-cordis-compositions/SKILL.md`
- `packages/preset/agent-presets/presets/cordis/skills/cordis-plugin-development/SKILL.md`

The local `cordis-plugin-development` skill is intentionally rewritten rather than copied verbatim. It preserves the upstream operating model while moving branch-specific details into references and sharpening completion criteria.

DeepSeek Harness is MIT licensed. Copyright (c) 2026 DeepSeek. See the upstream `LICENSE` for the full license text.
