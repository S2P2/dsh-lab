# DSH plugin landscape

Use this reference when a task needs prior art or ecosystem context for a new or materially changed DSH plugin. It is a semantic map synthesized from [`awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin), not a mirror of the catalog and not a prescribed research workflow.

## Source and authority

`awesome-dsh-plugin` keeps its catalog source of truth in [`data/plugins/*.yml`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/tree/main/data/plugins). Each entry is intentionally small: repository URL, display name, one primary category, one-line localized description, and an optional release tarball. The canonical category IDs and their order live in [`scripts/lib/entries.mjs`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/scripts/lib/entries.mjs); display names live in [`site/locales.mjs`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/site/locales.mjs).

The taxonomy is editorial, not an API. The upstream contribution guide explicitly says categories may be split, renamed, or merged as the ecosystem changes. Several current categories grew out of overloaded buckets such as `tools`, `ui`, and `dev`. Treat the current map as a strong discovery lens, not a permanent ontology.

The catalog is curated for discoverability and basic installability. Upstream review checks for a real `dsh.bundle`, working code, repository age and history, active maintenance, an accurate description, reasonable categorization, duplication, and obvious source-level red flags. Listing is still not an endorsement or a security audit. The repository also maintains sidecar data for added dates, downloads, stars, and screenshots; these are useful signals, not substitutes for reading the plugin repository.

This reference was synthesized from the upstream repository on 2026-08-23. Re-read the canonical category source when exact current IDs or membership matter.

## What the catalog tells you

The catalog is strongest at answering **what kinds of DSH plugins already exist** and **where related work tends to cluster**. Its one-line descriptions are good for candidate discovery, while the linked repositories are the authority for architecture, behavior, configuration, maintenance, and license.

The catalog intentionally loses detail. An entry has only one category, so cross-cutting plugins are forced into a primary bucket. There are no official subcategories, tags, architectural roles, runtime faces, or compatibility dimensions. The subthemes and boundaries below are therefore a dsh-lab synthesis of the current entries, designed to preserve useful knowledge that the upstream schema does not encode.

## Working mental map

For navigation, the 21 upstream categories can be mentally grouped into six families. These families are local shorthand, not upstream structure:

- **Experience** — UI Enhancements, Themes & Appearance, Voice & Audio.
- **Models and agent state** — Models & Providers, Identity & Communication, Sessions & Messages, Memory, Skills.
- **Capabilities** — Tools & Capabilities, Browser & Web, Vision & Multimodal, Docs & Rendering.
- **Execution and engineering** — Workflow & Automation, Git & Code Review.
- **Platform and operations** — Usage & Billing, Notifications & Integrations, Development & Runtime, Security & Permissions, Remote & Mobile.
- **Ecosystem and extras** — Plugin Markets & Managers, Just for Fun.

## Category map

The **subthemes** column is synthesized from the current catalog. It is deliberately more detailed than the upstream single-category schema so an agent can recognize nearby prior art even when names differ.

| ID | Upstream category | What tends to live here | Recurring subthemes | Often adjacent to |
|---|---|---|---|---|
| `ui` | UI Enhancements | Changes how the DSH interface behaves or how users interact with it. | Alternate shells and launchers; composer helpers; input history and completion; conversation navigation; file/workspace explorers; embedded terminals; model/task/status panels; message folding and rendering; mobile layout adaptations; small productivity widgets. | `theme`, `session`, `model`, `workflow`, `remote` |
| `usage` | Usage & Billing | Measures consumption, limits, cost, and provider account state. | Account balances; subscription quotas; token counts; session/daily costs; pricing; context usage; heatmaps and trends; budgets and alerts; multi-provider usage comparisons; exports. | `model`, `ui`, `dev` |
| `theme` | Themes & Appearance | Changes presentation without primarily changing interaction semantics. | Color themes and full skins; wallpapers; live/video/WebGPU backgrounds; glass and transparency; fonts; icons; branding; theme managers; ambient and decorative effects. | `ui`, `market` |
| `model` | Models & Providers | Connects, authenticates, selects, or routes model backends. | Provider adapters; subscription-backed providers; OAuth; OpenAI-compatible gateways; CLI-backed providers; local models; model and role routing; subagent model selection; fallback/failover; model discovery; reasoning controls; proxies and retry behavior. | `usage`, `workflow`, `security`, `identity` |
| `identity` | Identity & Communication | Gives agents identities or direct agent-to-agent communication semantics. | Agent identity; direct messaging; groups and rooms; agent mail; A2A protocols; federation. | `session`, `workflow`, `notify`, `remote` |
| `session` | Sessions & Messages | Manages conversation lifecycle and message-level operations. | Archive/delete/restore; organization and search; titles/tags/metadata; undo and rewind; recovery and repair; forks and branches; side conversations; cross-session messaging; prompt queues; import and migration; export and sharing; handoff; context retrieval and management. | `memory`, `ui`, `workflow`, `identity` |
| `memory` | Memory | Persists or retrieves knowledge beyond the immediate message flow. | User/profile memory; project memory; session recall; facts and lessons; semantic memory; vector retrieval and RAG; knowledge bases; knowledge graphs; consolidation; context compaction; provenance/governance; external memory services; notes integration; memory migration. | `session`, `tools`, `workflow`, `security` |
| `tools` | Tools & Capabilities | General executable capabilities that do not yet justify a narrower top-level category. | OS/computer control; shell and terminal; SSH and remote systems; Docker/Kubernetes; databases; cloud platforms; MCP infrastructure; files and storage; data analysis; academic research; finance; maps/location; calendars/RSS; publishing; media processing; developer utilities; observability; human-in-the-loop tools; domain-specific capabilities. | Almost every capability category, especially `browser`, `vision`, `docs`, `git`, `dev` |
| `browser` | Browser & Web | Web search, retrieval, scraping, crawling, browser control, and web testing. | Search providers; fetch/read tools; scraping; crawling and site maps; Playwright/CDP automation; visible browser control; existing-profile control; browser extensions; frontend/acceptance testing; anti-bot fetching; media discovery/download. | `tools`, `vision`, `workflow`, `security` |
| `vision` | Vision & Multimodal | Visual input/output and multimodal understanding. | Vision bridges for text-only models; native multimodal routes; OCR; document vision; screen capture; image understanding; UI understanding; visual QA and pixel diff; image generation/editing; video understanding; local/offline vision. | `browser`, `docs`, `ui`, `model`, `tools` |
| `voice` | Voice & Audio | Speech and audio interaction. | Browser voice input; local/cloud speech-to-text; text-to-speech; custom/RVC voices; full-duplex voice; voice calls; notification sounds; UI sound effects. | `ui`, `notify`, `remote`, `model` |
| `docs` | Docs & Rendering | Creates, parses, converts, previews, or publishes document artifacts. | Markdown; Word documents; spreadsheets; presentations; PDF; office suites; LaTeX and papers; diagrams; reports; document parsing; conversion; publishing and sharing. | `tools`, `vision`, `skill`, `workflow` |
| `skill` | Skills | Packages reusable instructions, methods, or domain expertise for agents. | Software engineering methods; architecture/design; research/science; academic and general writing; business/strategy; marketing/social; finance; legal/government; media production; productivity/life; domain expertise; skill routers; skill managers; skill creation/evolution. | `workflow`, `tools`, `docs`, `dev` |
| `workflow` | Workflow & Automation | Controls execution order, state, scheduling, delegation, and multi-step automation. | Cron/one-shot scheduling; triggers and watches; task management; Kanban/project management; workflow engines; DAG orchestration; multi-agent teams and swarms; delegation; review/verification loops; approval gates; background/proactive agents; auto-resume/retry; visual workflow builders. | `skill`, `session`, `identity`, `tools`, `git`, `notify` |
| `git` | Git & Code Review | Source-control and review lifecycle tooling. | Git status/commit/branch operations; graph views; diff UIs; human change acceptance; AI/adversarial review; code quality; worktrees; GitHub issues/PRs; CI/CD diagnostics; commit/release hygiene. | `tools`, `workflow`, `dev`, `security` |
| `notify` | Notifications & Integrations | Sends events or bridges DSH into communication/productivity systems. | Desktop/browser notifications; push services; generic webhooks; WeChat/WeCom; Feishu/Lark; Telegram; Slack; Discord; QQ/DingTalk/WhatsApp/iMessage; unified IM gateways; remote approvals; email; productivity apps; editor/app bridges; update notifications. | `remote`, `workflow`, `identity`, `voice` |
| `dev` | Development & Runtime | Extends, diagnoses, configures, operates, or evolves DSH itself as a platform. | Plugin templates/scaffolds; plugin testing; health/doctor/conflict diagnosis; startup and recovery; service management; hot reload/runtime patching; updates/upgrades; profiles/rules/configuration; backup/migration; tracing/metrics; performance testing; Node/Python/network toolchains; plugin/self-evolution. | `tools`, `security`, `market`, `usage` |
| `security` | Security & Permissions | Controls trust, authorization, isolation, and security analysis. | Permission rules; automatic/human approval; tool-risk guards; filesystem and secret protection; prompt-injection/taint defense; network egress control; web authentication; RBAC; sandboxing; plugin scanners; supply-chain verification; dependency/CVE audits; audit/provenance; code security. | `dev`, `tools`, `workflow`, `model`, `remote` |
| `remote` | Remote & Mobile | Makes DSH accessible or operable from other devices and networks. | LAN access; VPN/Tailscale; public tunnels; reverse proxies; secure pairing; mobile web UI; PWA; native mobile apps; multi-device operation; remote sessions; remote/SSH workspaces; API gateways; mesh/peer networking. | `notify`, `security`, `ui`, `identity` |
| `market` | Plugin Markets & Managers | Discovers, evaluates, installs, updates, or organizes extensions. | Plugin discovery; marketplaces/stores; one-click installation; installed-plugin management; updates; recommendations; rankings/scorecards; security vetting; compatibility/conflict analysis; plugin recipes/bundles; theme/skin markets; MCP markets; unified extension managers. | `dev`, `security`, `theme`, `tools` |
| `fun` | Just for Fun | Entertainment, personality, novelty, and playful UI. | Desktop pets; Live2D; games and mini-games; idle games; achievements/gamification; roleplay and character cards; visual novels; music/video; memes/stickers; novelty widgets; game integrations and companions. | `ui`, `theme`, `voice` |

## Boundary heuristics

Use these distinctions when a proposed plugin could plausibly belong to several categories. They describe the center of gravity, not hard exclusion rules.

- **UI vs Themes** — UI changes behavior, layout, navigation, or interaction; Themes changes presentation and visual style.
- **Models vs Usage** — Models connects or routes inference backends; Usage measures their consumption, limits, pricing, or account state.
- **Identity vs Sessions** — Identity answers who an agent is and how agents address one another; Sessions manages conversation instances and their messages.
- **Sessions vs Memory** — Sessions owns conversation lifecycle; Memory retains and retrieves knowledge across or beyond conversations.
- **Tools vs Skills** — A tool gives the agent an executable capability; a skill gives the agent reusable instructions or methodology.
- **Skills vs Workflow** — A skill teaches how to act; a workflow controls when, in what order, and under what state/approval conditions actions run.
- **Tools vs Browser/Vision/Docs/Git** — `tools` is the general bucket; use a specialized category when the plugin's primary capability is clearly web, visual, document, or source-control specific.
- **Tools vs Development & Runtime** — Tools expands what the user/agent can do; Development & Runtime changes or operates DSH itself.
- **Notifications vs Remote** — Notifications communicates an event outward; Remote provides an ongoing path to operate or access DSH elsewhere.
- **Security vs Development & Runtime** — Security's primary concern is trust, permissions, isolation, or attack surface; Development & Runtime's primary concern is platform operation and developer mechanics.

## Recurring plugin shapes

Across categories, current entries repeatedly fall into a smaller set of architectural roles. These shapes are often more useful for comparing implementations than category labels alone:

- **Surface** — adds or replaces a host/client UI surface: card, panel, composer, shell, picker, status view, theme, or mobile view.
- **Adapter** — translates between DSH and a provider, account system, model protocol, application API, or external service.
- **Bridge** — exposes an external capability as tools, often through direct APIs, MCP, CLI processes, browser control, or operating-system automation.
- **State layer** — stores, indexes, retrieves, migrates, or repairs sessions, memory, metadata, or project knowledge.
- **Orchestrator** — coordinates tasks, schedules, agents, retries, gates, reviews, or durable background execution.
- **Integration transport** — carries events, approvals, messages, or control between DSH and another device/channel/system.
- **Runtime extension** — modifies DSH startup, configuration, diagnostics, update behavior, plugin lifecycle, observability, or development tooling.
- **Manager/curator** — discovers, scores, installs, updates, groups, or vets plugins, skills, themes, MCP servers, or other extensions.

A plugin may combine several shapes. For prior-art comparison, note the dominant shape and any secondary ones rather than assuming two plugins in the same category solve the problem in the same way.

## Cross-cutting comparison axes

The catalog does not encode these dimensions, but they recur across many plugin descriptions and repositories and are useful when distinguishing related implementations:

- **Runtime face** — host-side, web/client-side, or dual-face.
- **Execution boundary** — in-process, child process/CLI, MCP server/client, browser automation, remote service, or external API.
- **State** — stateless, session-scoped, profile/project-scoped, or durable external storage.
- **Provider scope** — single-provider, protocol-compatible family, or provider-agnostic.
- **Deployment** — local-only, LAN, tunneled/public, cloud-backed, or peer-to-peer.
- **Human control** — automatic, ask/approve, review gate, or fully manual handoff.
- **Trust surface** — filesystem, credentials, network egress, browser profile, build/install scripts, remote access, or third-party data service.
- **Interaction style** — invisible infrastructure, tool call, command, composer interaction, transcript card, persistent panel, notification, or separate UI.

## Light use during research

Map the problem to one likely upstream category and the neighboring categories suggested above, then use the live catalog to discover candidate repositories. Let the task-specific research agent decide its own search terms, comparison dimensions, and depth; this document supplies the ecosystem map, not the research recipe.

For any promising candidate, the repository itself outranks the catalog description. The catalog is the index; source code, manifests, configuration, documentation, maintenance history, and license are the evidence.

## Upstream references

- [`awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) — current generated catalog and repository links.
- [`data/plugins/`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/tree/main/data/plugins) — one YAML source record per listed plugin.
- [`scripts/lib/entries.mjs`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/scripts/lib/entries.mjs) — canonical category IDs, entry schema, validation, and ordering.
- [`site/locales.mjs`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/site/locales.mjs) — category display names.
- [`contributing.md`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md) — inclusion criteria, review model, duplicate handling, and the explicit statement that the taxonomy evolves.
