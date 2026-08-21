# AI-assisted content

Mark output you produce as an AI agent with the robot emoji and an "AI-assisted" note, so humans can tell at a glance what was drafted with agent help under human direction.

## Mark these collaboration surfaces

- **Issues, PR descriptions, and comments** — lead with `🤖 AI-assisted —`.
- **Human-reviewed issues, PR descriptions, and comments** — use `🤖 AI-assisted, human-reviewed —` only when the human operator has explicitly reviewed or approved the content before posting.
- **Commit messages** — prefix the subject line with `🤖 `, for example `🤖 fix: handle expired tokens`.

The `code-review` skill may use `🤖 AI review` for review comments.

## Do not mark these

Do **not** add AI markers to:

- source code
- code comments
- tests
- committed docs such as `CONTEXT.md`, ADRs, README files, or design docs

Those artifacts are reviewed through normal PR/review processes, and emojis in source/docs are noise.
