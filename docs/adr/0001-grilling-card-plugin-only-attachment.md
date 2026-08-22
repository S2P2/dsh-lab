# Grilling card attaches plugin-only, via composer takeover keyed on a question-id prefix

The rich grilling card must appear inside DSH's live question flow without any upstream `deepseek-ai/deepseek-harness` changes (the presentation-intent union is closed at five synchronized schema/validation points, so a `grilling-round` intent would be an upstream release), and it stays plugin-only permanently — grilling is not universal enough to belong in core; if the plugin stabilizes we list it, we do not propose it upstream. The client half registers a `conversation.composer` chain entry at `priority: -1` whose selector claims only questions whose ids carry the `grill:` prefix (declining everything else, so the shipped card is untouched); the host half's `grill_round` tool mints those ids.

## Considered Options

- **Upstream `grilling-round` presentation intent** — rejected: five-place upstream schema change, release latency, and a feature most DSH users never need.
- **Structural takeover matching** (claim any multi-select question with `detail`) — rejected: false-positives on other tools' questions; the id prefix is the only wire field fully ours to key on.
- **JSON payload smuggled through the `custom` answer field** — rejected: machine JSON in a human-visible field breaks the generic-card fallback.

## Consequences

- Choice+comment on one question rides the stock wire by declaring every grilling question `multiSelect: true` (the wire permits `selected` and `custom` together only for multi-select); fallback users see checkbox styling — degraded but functional.
- Recommendation metadata (star, rationale, prose drafts, frontier meter) lives in the `grill_round` tool args, not the wire; the live card joins wire questions to the running tool call's args by question id.
- The tool normalizes answers back: strips the `grill:` prefix and returns the stock `ask_user_question` result shape plus a `status` field (`answered`/`skipped`/`unanswered`), so agents read a familiar shape.
