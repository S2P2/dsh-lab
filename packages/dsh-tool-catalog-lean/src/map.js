/**
 * Curated short-form descriptions for stock DSH tools, keyed by tool name.
 *
 * Each entry provides:
 *   - `description`: replacement for the tool-level description string;
 *   - `parameters`: a replacement tree mirroring the JSON-schema shape of
 *     `parameters`. Under `properties`, a plain string replaces that
 *     property node's `description`; a plain object is a nested
 *     replacement node (with its own `description`/`properties`/`items`)
 *     for properties that are themselves schemas. Schema nodes without a
 *     curated `description` keep their stock string;
 *   - `output_schema`: same replacement-tree shape, applied to
 *     `output_schema` when the tool schema has one.
 *
 * A replacement is applied only where the stock schema already has a
 * string `description` — the transform never adds fields, so unchanged
 * subtrees stay byte-identical.
 *
 * Tracer bullet (#79): exactly one curated entry (`bash`). The full stock
 * map lands with #80.
 */

export const descriptionMap = {
  bash: {
    description:
      "Execute a bash command (`bash -c`) and return stdout/stderr. Each call runs in a fresh shell — no state (cwd, variables, functions) persists; pass `workdir` instead of `cd`. Non-zero exits are reported as `[exit code: N]`. Long output is truncated to its tail; the full output is saved to a file whose path is reported. A file-sandbox denial is reported as `[sandbox: file access denied under <mode> mode]` — a policy denial, not a bug; do not retry another way. When a denial is real and a wider mode would let it succeed, retry the exact same command once with `sandbox_permissions` (narrowest wider mode) plus a one-sentence `justification`; never escalate speculatively. If approvals are disabled or the retry is rejected, the denial is final. For long-running commands set `run_in_background: true`: the call returns a job id immediately; collect with `job_output`, stop with `job_kill`.",
    parameters: {
      properties: {
        description:
          "What this command does, in active voice, 5-10 words (shown in the UI).",
        timeoutMs:
          "Timeout in ms; the executor applies its default and cap and kills the command on expiry.",
        workdir:
          "Working directory; defaults to the session workspace (relative paths resolve against it).",
        run_in_background:
          "Run in the background, returning a job id immediately (job_output/job_kill); no timeout applies.",
        sandbox_permissions:
          "Wider mode for a one-shot retry after a sandbox denial; requires justification and user approval.",
        justification:
          "Required with sandbox_permissions: one sentence on why this exact command needs the wider access.",
      },
      // `command` keeps its stock description: it is already minimal.
    },
  },
};

/**
 * Behavior-preservation checklists: facts each curated description must
 * still state, so wording edits cannot silently drop safety semantics.
 * One test per curated tool asserts every item survives the projection.
 */
export const safetyChecklists = {
  bash: [
    "fresh shell", // no state persists between calls; workdir instead of cd
    "[exit code: N]", // non-zero exits are reported as a marker
    "[sandbox: file access denied under <mode> mode]", // sandbox-denial marker
    "retry the exact same command once with `sandbox_permissions`", // one-shot escalation
    "`justification`", // escalation requires a justification sentence
    "returns a job id immediately", // background runs come back as a job id
    "truncated to its tail", // long output truncation + spill file
  ],
};
