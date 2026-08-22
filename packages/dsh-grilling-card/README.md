# dsh-grilling-card

A rich grilling card for [DSH](https://github.com/deepseek-ai/deepseek-harness) web: the grilling skill's rounds render as a structured card — full round overview, one focused editor, starred Recommendations with rationale, one-click "accept all recommended", per-question Comments, a frontier meter — and after submit the transcript keeps a flat read-only Recorded Round instead of a tool-call JSON blob. Spec of record: [issue #2](https://github.com/S2P2/dsh-lab/issues/2); attachment design: [ADR 0001](../../docs/adr/0001-grilling-card-plugin-only-attachment.md).

Dual-face plugin:

- **Host half** (`src/index.js`) registers the `grill_round` tool. It calls `ctx.userQuestions.ask` directly (the stock `ask_user_question` tool drops the wire fields the card needs) and normalizes answers back to the stock shape plus a `status` per question.
- **Browser half** (`src/client.js`, hand-authored lazy-CJS bundle — the tsdown client preset is not published and the bundle-purity gate forbids value-importing shipped chrome) takes over the composer for `grill:`-prefixed question batches at `priority: -1` and registers the `grill_round` transcript toolview.

## Tool contract — `grill_round`

Args (agent-facing): `{ questions: [{ id, question, body?, options?: [{ label, description? }], recommended?, recWhy?, draft?, multi? }], detail, progress: { round, decisionsOpen } }`.

Rules enforced by the host (see `src/round.js`): unique ids (none may start `grill:`); ≥ 2 options on choice questions; a Recommendation on **every** question — a starred option (`recommended`, verbatim label) for choice questions, a prose `draft` for narrative questions; `detail` is the round preamble; `progress` drives the frontier meter.

Result: `{ answers: [{ id, status: "answered"|"skipped"|"unanswered", selected: string[], custom? }] }` — the stock `ask_user_question` shape plus `status`, `grill:` prefix stripped, comments trimmed.

## Wire mapping (host → user-questions)

- ids prefixed `grill:` (the composer-takeover key; ADR 0001);
- every question declared `multiSelect: true`, so a choice **and** a comment coexist legally (`selected` + `custom` — the apiproxy's `matchesQuestions` allows both only for multi-select);
- option labels ride verbatim (host answer validation is label-exact);
- the round preamble rides the first question's `detail` (the only wire field the generic fallback card renders for free);
- narrative-with-draft questions carry `✓ Agree with this draft` / `✗ Disagree` as their two wire options;
- an explicit skip needs a carrier the stock wire offers no other way, so the host appends one reserved option, `Skip this question`, to every question. The card renders it as the skip affordance (never as a chip); agents' own options may not use that label.

Recommendation metadata (stars, rationale, drafts, meter) never touches the wire: the live card joins the wire questions to the running `grill_round` call's args by question id, reading the call block from the session projection. Without a join (e.g. the call fell off the loaded page) the card degrades to wire-only rendering: options, comments, and skips still work; stars and accept-all do not.

## Enforcement points

- **Disagree-requires-comment** is enforced twice: the card refuses submit until the comment box fills, and the host seam normalizes a commentless `✗ Disagree` (possible only through the *generic fallback card*) back to `status: "unanswered"` — the question flows to the next round instead of silently recording an incomplete verdict. Degraded but functional, per the ADR's fallback doctrine.
- **Unanswered questions never block submit**: they return with `status: "unanswered"` and get re-asked in a later round; explicit skips return `status: "skipped"`.
- **Spec reconciliations** (issue #2 leaves these open):
  - The `skipped` status needs a wire carrier the stock protocol doesn't offer, so the host appends one reserved option (`Skip this question`) to every question. The card renders it as the skip affordance, never a chip; through the generic fallback it appears as one extra option — the same degraded-but-functional trade the ADR accepts for checkbox styling.
  - "A Recommendation on every question" and "draftless narrative stays plain free text" are reconciled by making `draft` mandatory at the tool seam, while the card keeps a degraded plain-free-text branch for questions it cannot join (a round whose tool call fell off the loaded page renders wire-only, without stars or accept-all).
  - The card's collapse and dismiss affordances mirror the shipped question composer's minimize/cancel — chrome parity with the surface it takes over, not new invention.

## MCP elicitation compatibility

`src/to-elicitation.js` serializes any valid round to exactly one 2026-07-28 form-mode elicitation request (options → `enum`, multi → array-of-enum, recommendation/draft → `default`, preamble → `message`), verified by test. DSH itself has no elicitation support; "compatible" means *losslessly mappable*. The 2025-06-18 subset has no home for recommendations.

## Development

```sh
pnpm --filter @s2p2/dsh-grilling-card test
```

Dogfood: `dsh plugin --profile web add ../dsh-lab/packages/dsh-grilling-card`, restart `dsh web`, then ask an agent to run a grilling round (`grill_round` with a couple of questions).

No build step by design: the browser bundle is authored directly in the `window.__ModuleLoader__.load` factory format (the quota-bar precedent), so there is nothing to rebuild and the published package is the working artifact.

## Layout

```
src/round.js           pure domain: args validation, wire mapping, answer normalization
src/index.js           host plugin: grill_round tool over ctx.userQuestions.ask
src/to-elicitation.js  pure MCP form-mode serializer (tested)
src/client.js          browser bundle: live card (composer takeover) + recorded-round toolview
test/                  round-trip, wire-legality (upstream oracle), elicitation, bundle smoke
```
