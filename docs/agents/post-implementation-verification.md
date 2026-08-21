# Post-implementation verification

After finishing an implementation task, answer the human's question: **"Is there anything I should manually test?"**

## Rule

Only propose manual checks that **automated tests structurally cannot cover**. If everything meaningful is already asserted by tests, say **"Skip"** and explain briefly why.

The human's time is scarce. Do not pad a checklist with things tests already prove.

## What counts as "tests can't cover it"

- **Domain/language recall** with real-world phrasings a synthetic test invents.
- **UX / feel** — flow pacing, wording tone, scroll behavior, visual polish.
- **Cross-system wiring** a unit/integration test stubs out, such as real SSO, live model behavior, real email delivery, or a third-party API.
- **Security boundary spot-checks** — seeing with your own eyes that sensitive data does not appear where tests only assert a sanitized store.

## What does not count

- Status codes
- schema validation
- database column updates
- round-trip serialization/crypto
- invariant properties already covered by assertions

## Output format

Use one of these:

- **Skip** — one sentence explaining what is already covered by automated tests.
- **One focused check** — the concrete thing to verify, the command or UI step, and the signal to look for.

Prefer **Skip** when unsure.
