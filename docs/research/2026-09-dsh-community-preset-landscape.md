# DSH community Agent preset landscape

Date: 2026-09-12

Research question: what kinds of Agent presets / modes are the DSH community already building, and what ideas do they expose for customizing DeepSeek Harness?

## Executive summary

Community presets are not converging on one pattern. They currently fall into at least six useful classes:

1. **Behavior/persona overlays** — keep most or all Standard capabilities but change how the agent collaborates with the user.
2. **Capability-minimized role presets** — deliberately remove tools to make a narrowly scoped agent.
3. **Workflow/skill distributions** — bundle an opinionated engineering methodology plus the skills and tool mappings required to run it.
4. **Platform/model adapters** — change shell/tool composition or prompting for Windows, Qwen, IFlow, older/non-DeepSeek models, etc.
5. **Purpose-specific professional roles** — writer, researcher, general assistant, coding specialist, roleplay, and similar modes.
6. **Multi-agent orchestration presets** — encode several cooperating roles and sometimes add UI/configuration around them.

The strongest design lesson is that a DSH preset is best understood as a **session-scoped product configuration**: persona + prompt sections + model-facing tools + skills + compaction/planning behavior. A plugin is still appropriate when the feature must provide a reusable host/process capability or UI/service; several community projects combine a plugin with presets when they need both.

For the current `dsh-lab` work on a leaner Standard-derived profile, the community prior art argues for starting as a **preset**, not a plugin, unless the design needs new host services, a reusable runtime capability, or UI that cannot live in the preset composition itself.

## Baseline: what DSH itself says a preset is

The official preset package defines an Agent preset as a directory containing `agent.cordis.yml`; mounting it gives that session its own tools and prompt sections while other sessions keep their own compositions. DSH also explicitly makes persona composable, so a preset may change identity/behavior as well as tools.

Official source:
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/preset/README.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/config/agent-presets/cordis/skills/editing-cordis-compositions/SKILL.md

The official authoring skill draws the key boundary:

- **Host composition:** registries, persistence, settings, credentials, sandbox/approval, model route, cross-session services.
- **Agent preset:** what one session contributes to those registries — tool plugins, persona/prompt sections, compaction policy, and other agent-scoped behavior.

That boundary is useful when deciding whether a customization should be “just a preset” or needs a plugin.

## Community discovery surfaces

### DSH Preset Market

A community catalog announced in the official DSH Discussions reports **48+ presets** gathered from `dsh-preset` / `dsh-plugin` repositories, grouped into software development, planning/collaboration, multi-agent, platform adapters, and vertical scenarios. Its detail pages expose persona, tools, skills, and install path.

Source:
- https://github.com/deepseek-ai/deepseek-harness/discussions/5191
- https://dsh-preset.tech/

This taxonomy is useful even without treating the catalog itself as authoritative source code: community authors are already using presets as a general distribution format for complete Agent configurations, not merely prompt variants.

### GitHub `dsh-preset` topic

The GitHub topic currently surfaces, among others:

- `YKennen/dsh-zh-output`
- `dsh-mixxed/dsh-preset-grilling`
- `dsh-mixxed/dsh-preset-superpowers`
- `hackerFish/awesome-dsh-presets`

Source:
- https://github.com/topics/dsh-preset

## Representative patterns

### 1. Ask-first / clarification-gated mode

**Project:** `light051001/dsh-preset-qa-mode`

The QA mode keeps the Standard capability set and primarily changes the persona/protocol. Every task begins with structured clarification, followed by a summary/confirmation gate before execution; complex work plans first.

This is important prior art because it demonstrates that a “mode” can be almost entirely a **behavior policy** while retaining the same tools.

Sources:
- https://github.com/deepseek-ai/deepseek-harness/discussions/2522
- https://github.com/light051001/dsh-preset-qa-mode

Customization idea:
- Use presets for collaboration styles such as “ask first”, “autonomous”, “pairing”, “reviewer”, or “teacher” without creating new infrastructure.

### 2. Pair-programming / model-adapted interaction modes

**Project:** `R-LEI2536/dsh-more-agent-presets`

This package ships several modes:

- `qwencode-coding-agent`
- `iflow-coding-agent`
- `iflow-cre-agent`
- `pair-coding-agent`

The author explicitly positions them as alternatives for non-DeepSeek/older models and for users who prefer interactive collaboration. Compared with default DSH, these presets discuss direction more often and use iterative, collaborative planning rather than a single static approval document.

The package also demonstrates **preset lifecycle management from a plugin**: dynamic discovery, versioned updates, ownership markers, safe cleanup, and refusal to overwrite user-owned presets.

Source:
- https://github.com/R-LEI2536/dsh-more-agent-presets

Customization ideas:
- Model-family-specific prompting can be a preset concern.
- Interaction style can be independently varied from tool capability.
- A plugin can be justified as the **installer/manager for a collection of presets**, while the behavior remains in presets.

### 3. Engineering methodology bundles

**Project:** `dsh-mixxed/dsh-preset-grilling`

Built on Standard, this preset adds the full `mattpocock/skills` engineering workflow. It registers about three dozen skills and embeds routing/methodology rules in the persona. The intended workflow is roughly grill → spec → tickets → TDD → implementation → code review, with additional diagnosis, architecture and domain-modeling paths.

Source:
- https://github.com/dsh-mixxed/dsh-preset-grilling

**Project:** `dsh-mixxed/dsh-preset-superpowers`

Also Standard-derived, this packages the `obra/superpowers` workflow: brainstorming, plan writing/execution, TDD, subagent-driven development, parallel agents, systematic debugging, verification, reviews, worktrees, and branch finishing. DSH-specific tool mappings are provided, while session-start rules that upstream systems inject via hooks are embedded in the preset persona.

Source:
- https://github.com/dsh-mixxed/dsh-preset-superpowers

Customization ideas:
- A preset can be a **distribution unit for an entire working methodology**, not merely a static tool list.
- Preset-local Skills let different modes expose different workflow vocabularies without polluting every session.
- Persona can supply always-on routing rules while Skills hold large, on-demand procedures.

### 4. Minimal / platform-adapted coding mode

**Project:** `Saikel-Orado-Liu/dsh-coding-preset` (now archived/deprecated)

This was a Windows port of the official Minimal composition: fixed persona, no context compaction, only persistent PowerShell 7 plus `str_replace_editor`. It added a PowerShell terminal/tool implementation to replace the Bash-specific path.

The repository is now deprecated because official Minimal gained the same functionality, making it a useful example of community experimentation later absorbed by core.

Source:
- https://github.com/Saikel-Orado-Liu/dsh-coding-preset

Customization ideas:
- A mode can be intentionally tiny: shell + editor and nothing else.
- Platform-specific tool selection can live in a preset when the required tools already exist; if the tool implementation itself does not exist, that reusable capability belongs in a plugin/package.

### 5. Role-focused capability subsets

**Project:** `hackerFish/awesome-dsh-presets`

This repository contains four tested presets:

- `standard-zh` — full coding agent with Chinese persona
- `minimal-zh` — two-tool minimal mode with Chinese persona
- `writer` — technical writing composition
- `researcher` — research-oriented composition

It also validates YAML structure and package existence against an installed harness.

Source:
- https://github.com/hackerFish/awesome-dsh-presets

**Project:** `QlzqQlzq/dsh-dual-agent-presets`

Ships two contrasting modes:

- `general-agent` — research, file handling, planning, personal productivity; no raw shell by default
- `coding-pro` — repository-first coding with shell, planning, delegation, workflow and verification tools

Source:
- https://github.com/QlzqQlzq/dsh-dual-agent-presets

Customization ideas:
- Tool **absence** is a first-class design decision.
- A “general assistant” preset does not need to inherit every coding tool.
- Roles can be expressed as coherent combinations of persona + capability budget, rather than adding all available tools and relying on prompting not to use them.

### 6. Pure-conversation / roleplay specialization

**Project:** `oliblue-evan/dsh-roleplay-preset`

This mode intentionally removes shell/web-style capabilities and focuses on pure conversation, retaining a file-backed memory mechanism for long-running roleplay.

Source:
- https://github.com/deepseek-ai/deepseek-harness/discussions/1678
- https://github.com/oliblue-evan/dsh-roleplay-preset

Customization idea:
- Presets are suitable for **non-coding products** built on the same harness. The harness can expose radically different agents merely by changing the session composition.

### 7. Multi-agent orchestration as a mode

**Project:** `heyiwe1/dsh-multi-agent-preset`

The “Tri-Model Agent Preset” defines three cooperating roles — Director, Architect and Executor — with independent review/final-review stages. The project also adds a companion UI for model-role mapping and configuration.

Source:
- https://github.com/heyiwe1/dsh-multi-agent-preset

Customization ideas:
- Preset = the agent-facing orchestration/protocol.
- Plugin/UI = configuration and interactive controls around that protocol.
- This is a good example of the **hybrid boundary**: use a preset where session behavior belongs, add a plugin only for reusable services/UI.

### 8. Large preset packs / vertical workflows

**Project:** `h565656445/dsh-presets-pack`

This repository aggregates presets from a larger family of DSH-derived projects: Agent OS/runtime/planning/scheduler components, infrastructure, story/tutorial/sports/motion adapters, governance, and other specialized workflows.

Source:
- https://github.com/h565656445/dsh-presets-pack

The individual projects vary in maturity, but the pack demonstrates the upper bound of the concept: presets can act as deployment recipes for vertically specialized agents.

## A useful design matrix

| Dimension | Community examples | What the preset changes |
| --- | --- | --- |
| Interaction policy | QA mode, Pair Coding | Persona / prompt protocol |
| Capability budget | Minimal, roleplay, general-agent | Tool inclusion/exclusion |
| Workflow methodology | Grilling, Superpowers | Persona + preset-local Skills + tool mappings |
| Platform | Windows coding preset | Shell/tool implementation selection |
| Model family | Qwen/IFlow modes | Prompting + interaction conventions |
| Professional role | Writer, Researcher, Coding Pro | Persona + tool/skill subset |
| Multi-agent behavior | Tri-Model | Roles, delegation/review protocol; sometimes companion UI |
| Distribution | more-agent-presets | Plugin manages/install multiple preset directories |

## Implications for `dsh-lab`

### Preset should be the default choice when

- the behavior is different only for sessions that select the mode;
- you are mostly adding/removing existing tools;
- you are changing persona, instructions, planning policy, compaction policy, or Skills;
- you want several purpose-specific modes to coexist in one DSH process;
- the composition can be represented in `agent.cordis.yml` plus preset-local files.

### Plugin is justified when

- a new reusable tool/service implementation is required;
- the capability must live on the host/process plane or serve multiple sessions;
- credentials/settings/storage need their own host service;
- the customization requires new Web UI surfaces or runtime integration;
- you want a package to install/update/manage multiple presets safely.

### Hybrid is appropriate when

The user-facing concept is a mode, but it needs infrastructure that cannot be session-scoped. The multi-agent preset and the model/preset management packages demonstrate this pattern: keep the agent composition in presets, and let a plugin provide the management/UI/runtime capability.

## Specific ideas worth experimenting with

1. **Standard-lite / focused Standard** — remove expensive or rarely used tools while retaining the normal DSH persona and core file/shell editing path.
2. **Research mode** — web/file search + reading + note capture, no mutation-oriented coding workflow.
3. **Pair mode** — same tools as Standard, but require alignment before non-trivial changes and use iterative planning.
4. **Autonomous mode** — Standard capabilities with fewer interaction gates and stronger verification-before-finish rules.
5. **Architecture/review mode** — read/search/analysis tools, subagents if useful, but no direct write path by default.
6. **Writing mode** — file/search/web/questions and writing Skills; no shell/subagents unless specifically justified.
7. **Model-adapted variants** — retain a common tool composition but swap persona/planning protocol for DeepSeek vs Qwen/GLM/local models.
8. **Platform variants** — choose Bash/Pwsh and platform-specific helper Skills conditionally without changing the conceptual mode.
9. **Workflow distributions** — package a coherent skill set inside the preset rather than globally installing every Skill.
10. **Preset packs** — one optional plugin can manage several source-controlled presets, with ownership/version markers, while the presets themselves remain plain DSH compositions.

## Recommendation for the leaner Standard-derived work

Implement the first version as a **plain Agent preset derived from Standard** unless the proposed design introduces a capability Standard does not already have.

That keeps the experiment cheap and makes the core question measurable: which tools, prompt sections, Skills, compaction/planning pieces can be removed while preserving the desired daily workflow?

If later you need a settings UI, automatic preset synchronization, additional shell/runtime implementation, or other host-level behavior, add a plugin around the preset rather than making the preset itself a plugin from the start.

## Related DSH discussions / mechanics

- Presets are selected for a new session and are normally fixed for that session: https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-agent-preset/README.md
- A community fork explored live preset switching at turn boundaries, showing that changing the composition mid-session is substantially more complex because history/tool replay has to be rewritten safely: https://github.com/deepseek-ai/deepseek-harness/discussions/1585
- A community request proposes per-workspace default preset/model selection, suggesting another useful axis for future customization: https://github.com/deepseek-ai/deepseek-harness/discussions/2080
