# Writing preset

A small Agent preset for writing-focused work.

## Intended capability surface

Included:

- writing-focused persona
- workspace file read/write and file search
- web search for sourced writing
- `ask_user_question` for editorial choices
- preset-local Skills from `./skills/`

Deliberately excluded:

- shell access
- coding/build/test workflows
- subagents and workflow orchestration
- credentials or secret values

This scaffold is intentionally conservative. Add writing Skills under `skills/` and only add new tools when a concrete writing workflow requires them.

## Credentials

This preset contains no credentials. Any web/provider credentials required by the Host remain in the DSH profile/credential system and are resolved at runtime.
