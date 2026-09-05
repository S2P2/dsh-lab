# Custom Creator preset

A local fork of DeepSeek Harness Creator (`cordis`) mode for authoring Agent presets and dynamic Cordis plugins.

The composition stays close to the upstream Creator preset so it retains the normal coding-agent surface plus runtime inspection and self-modification. The main customization is the preset-local `cordis-plugin-development` skill: its core workflow is kept compact, while Host, Client UI, and runtime/version details are progressively disclosed through focused references.

## Included

- standard coding-agent tools, planning, compaction, delegation, jobs, goals, filesystem, web, and questions
- Cordis runtime inspection and temporary plugin tooling
- preset-local skill loading
- `editing-cordis-compositions` for preset composition work
- rewritten `cordis-plugin-development` for dynamic plugin work

## Source and maintenance

The preset composition began from DeepSeek Harness `master`; the composition-authoring guidance is synced to the installed DSH `0.1.2-rc.1` Cordis and agent-preset contracts. See `UPSTREAM.md` for the source paths and license note.

When syncing with upstream, treat the upstream Creator preset as authoritative for composition rows and runtime capabilities. Re-apply the local skill refactor rather than assuming copied plugin rows remain current.

## Credentials

No secrets belong in this preset. Provider credentials remain in the DSH Host/profile credential system.

## Verification

After editing the composition, mount-validate it using the Creator runtime guidance, then start a real session with `custom-creator` and verify that the Cordis tools and both preset-local Skills appear. For plugin-development changes, exercise one Host-only task, one Client UI task, and one failed update/rollback path so each disclosed reference is reached at least once.
