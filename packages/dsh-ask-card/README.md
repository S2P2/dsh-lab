# @s2p2/dsh-ask-card

Richer transcript view for the stock `ask_user_question` tool. Newer DSH versions
already show the asked question and recorded answer in the stock expanded row; this
plugin keeps that useful summary but adds the questionnaire context that stock still
omits: every offered option, the user's selections highlighted, recommended badges
(`(recommended)` suffix convention), custom answers (highlighted like a selected option
so free-text answers stand out while reviewing), multi-select checkboxes, skipped
questions, and pending/cancelled/interrupted chips.

The tradeoff is density: the richer expanded card uses more vertical UI space than the
stock view. Collapsed, the row stays pixel-identical to stock (same DisclosureRow chrome,
tokens, summaries, running sweep, and state dots), so the extra space is only paid when
you expand the transcript entry.

Any payload it cannot parse falls back to the exact stock transcript row, so a transcript
never renders worse than stock. The pending-question composer takeover
(`dsh-client-ui-user-questions`) is a different slot and is untouched.

## How it works

DSH's `tool.call.toolview` slot is keyed by tool name, and the slot system renders the
**lowest-priority** entry for a key. The stock `dsh-client-ui-tool` registers
`ask_user_question` at the default priority `0`; this plugin registers the same key at
`priority: -1` to shadow it:

```js
ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({
  name: "tool.call.toolview",
  key: "ask_user_question",
  priority: -1,
  locale: NS
}, AskCardRow));
```

Uninstalling the plugin (or the stock package updating to a lower priority) restores the
stock row with no behavioral residue.

## Install

```sh
dsh plugin --profile web add ../dsh-lab/packages/dsh-ask-card
```

Then restart `dsh web`. Client-only plugin: no host-side half, no build step —
`lib/client.js` is hand-written in the web module-table format
(`window.__ModuleLoader__.load`), so edits land on the next restart (or immediately
under `dev:web` HMR).

## Status

🌱 early scaffold — originally verified against `@deepseek-ai/dsh-*` `0.1.1-rc.2`.
Newer DSH releases have improved the stock `ask_user_question` transcript row to show
the question and recorded answer, which narrows this plugin's role to the richer context
above. The row chrome and fallback behavior can still drift as DSH evolves.
