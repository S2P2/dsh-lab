# Shared preset drafts

Load this reference when the Preset panel has opened a candidate, Creator needs programmatic access to that candidate, or a saved target may have changed underneath it.

## One Host-owned candidate

The preset-authoring plugin's Host service owns the shared draft. The Preset panel and Creator must read and mutate that same service object; a second in-chat copy, temporary file, or reconstructed YAML document would create competing state.

A draft identifies its target and carries two distinct kinds of revision:

- the draft service's own evolving candidate state;
- an opaque source revision for the saved target from which the draft began.

The source revision is a plugin-owned fingerprint of the complete preset tree, including `agent.cordis.yml`, `preset.yml`, preset-local skills, and assets. Treat it as an opaque compare-and-set token. Do not derive it from roster metadata, composition text alone, a browser path, mtimes, or Git `HEAD`.

Send the exact source revision expected by the live service on mutations and Apply. If the service reports it stale, preserve the candidate and ask the user to review/rebase or reopen it; never silently overwrite the newer saved tree.

## Temporary Host bridge

Cordis Inspect is read-only discovery. To operate the draft service:

1. Call `cordis_inspect_list`, then query the returned Host `Service.listService` provider with `cordis_inspect_query` for the exact draft-service and `tools` contracts. Do not guess the service name or methods.
2. Call `cordis_define` for a Host-only Package. Inject only the draft service and `tools`; register one narrowly scoped Tool for the operation currently needed, with target id and revision fields explicit in its schema.
3. Call `cordis_run mode:"run"` with the exact ids returned by define. The Tool becomes available on a later model step.
4. Invoke the temporary Tool. Let it delegate directly to the Host draft service so panel edits and Creator edits immediately observe one state.
5. Call `cordis_stop` as soon as the operation is complete, then `cordis_undefine`. Stopping removes the model-facing registration; undefining also discards the temporary source and versions.

Use a separate narrow bridge only when a later operation is actually needed. A permanent `preset.inspect`, `preset.patch`, `preset.validate`, or similar Tool family duplicates the Host domain and adds tool-schema cost to ordinary Creator turns.

## Editing bounds

Use deterministic schema metadata for common field edits, enabling, and disabling. Keep unknown plugin metadata explicitly uninspected. Research an unknown component's installed schema, docs, or source only when the requested change touches it or the user asks; routine inspection does not require expanding every unknown row.

The shared draft remains a candidate until Apply. Cheap draft checks are early feedback; authoritative validation still requires materializing the candidate through the Host-owned path and calling `ctx.agentPresets.standingKeyFor(targetId)`. A clean mount is followed by behavioral verification in a fresh session, not by switching the running Creator session.
