# @s2p2/dsh-ask-card

Rich transcript card for the stock `ask_user_question` tool. Collapsed, the row is
pixel-identical to stock (same DisclosureRow chrome, tokens, summaries, running sweep,
state dots). Expanded, instead of the generic IN/OUT JSON card it renders a read-only
question/answer card: every asked question with its options, the user's choices
highlighted, recommended badges (`(recommended)` suffix convention), custom answers,
multi-select checkboxes, skipped questions, and pending/cancelled/interrupted chips.

Any payload it cannot parse falls back to the exact stock IN/OUT card, so a transcript
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

🌱 early scaffold — verified against `@deepseek-ai/dsh-*` `0.1.1-rc.2`. The row chrome
and fallback card were copied from that version's `ToolRow.module.css`; a DSH update may
drift the stock look (the card itself only uses stable `--dsw-*` design tokens).
