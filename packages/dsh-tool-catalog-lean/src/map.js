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
 * subtrees stay byte-identical. Properties whose stock description is
 * already minimal (e.g. bash `command`, edit `file_path`) are simply left
 * out of the map. A curated empty string deliberately EMPTIES a
 * description that only restates what the schema one line away already
 * confesses (parameter names, types, enum values, defaults, required-ness):
 * the schema is the source of truth, and a restatement is a cache of a
 * lookup sitting next to it.
 *
 * Every curated entry is a semantically faithful compression of the stock
 * description, keeping the tool's whole contract self-contained inside the
 * description (nothing is relocated to prompt sections, so `complete: true`
 * personas keep working). Small tools whose stock text is already terse
 * (job_list, web_fetch, read, get_goal, skill) are compressed lightly, not
 * telegraphic, on purpose — do not over-trim them. Cuts concentrate on the
 * five largest definitions (bash, subagent_fork, subagent, list_agents,
 * todo_write), per spec #77.
 *
 * Curation policy per tool is pinned by `safetyChecklists` below and
 * enforced by `test/map.test.js`; measured before/after sizes live in the
 * package README.
 */

export const descriptionMap = {
  ask_user_question: {
    description:
      "Ask the user a concise question when you need confirmation, a choice, or missing information before proceeding. One or more questions, each with a stable id echoed in the answer.",
    parameters: {
      properties: {
        questions: {
          description: "",
          items: {
            properties: {
              id: "",
              question: "",
              header: "",
              options:
                "Recommended option goes first, labeled \"(Recommended)\".",
              multi_select:
                "May select more than one option; defaults to false.",
            },
          },
        },
      },
    },
  },

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

  create_goal: {
    description:
      "Create one persisted same-session completion goal when a direct human request is a long-running objective across autonomous goal rounds (inferable). Not for trivial single-turn work; rejects non-human and subagent authority.",
    parameters: {
      properties: {
        objective: "",
        max_goal_rounds: "Safe-integer cap on continuation rounds.",
      },
    },
  },

  edit: {
    description:
      "Edit an existing UTF-8 text file by replacing literal text.",
    parameters: {
      properties: {
        old_string: "Must match exactly.",
        new_string: "Empty string deletes the match.",
        replace_all:
          "Default false. When false, old_string must appear exactly once.",
        sandbox_permissions:
          "Wider mode for a one-shot retry after a sandbox denial.",
        justification:
          "With sandbox_permissions: one sentence justifying the wider access.",
      },
    },
  },

  get_goal: {
    description:
      "Read the current same-session goal — exact id/revision, objective, phase, completed rounds, round limit, blocker reason, whether another continuation is armed. Call before updating a goal.",
  },

  glob: {
    description:
      "Find files matching a glob pattern — never directories — hidden and ignored files included (VCS metadata excluded). Up to 100 paths in modification-time order; larger results return the first 100 and where the complete list was saved. Does not enumerate directory entries.",
    parameters: {
      properties: {
        pattern:
          "No \"/\" matches the basename at any depth; include a separator to anchor depth (e.g. \"**/*.ts\").",
        path: "Directory to search; defaults to the session workspace.",
      },
    },
  },

  grep: {
    description:
      "Search file contents with a ripgrep regex; matches return with line numbers, grouped by file. First 250 matches inline; a capped result reports where the full list was saved. Use read on a matched file for context.",
    parameters: {
      properties: {
        path: "File or directory to search; defaults to the workspace.",
        include:
          "One glob filter for files searched; not a list, no negation.",
      },
    },
  },

  interrupt_agent: {
    description:
      "Cancel a background agent's current turn by agent id — a direct child or deeper agent under you. Only the current turn stops: queued messages stay parked until a later send_message, agents it started keep running, and it stays available for follow-ups. Interrupting a finished agent is a no-op.",
    parameters: {
      properties: {
        agent_id: "",
      },
    },
  },

  job_kill: {
    description:
      "Cancel a running background job by job id; returns immediately, settles as killed once its work stops.",
    parameters: {
      properties: {
        job_id: "Job id from the tool that started the work.",
        reason: "Logged and forwarded to the job.",
      },
    },
  },

  job_list: {
    description:
      "List background jobs (running and finished) with ids/kinds/statuses.",
  },

  job_output: {
    description:
      "Read a background job. Stream jobs return output since the previous read; final-output jobs return their result after settlement; responses end with `[status: ...]`. Non-blocking unless `wait: true`.",
    parameters: {
      properties: {
        job_id: "Job id from the tool that started the work.",
        wait: "Block until terminal or timeout; timed-out waits return [status: running], job alive.",
        timeout_ms: "Only meaningful with wait: true.",
      },
    },
  },

  list_agents: {
    description:
      "List continuable background subagents by durable id and label — to recall which you started, not to poll for completion (you are told when one finishes). running = working now; idle = loaded, between turns; ready = storage-only (resumable, no pending result). `send_message` steers a running child or starts a turn for an idle one; direct children are candidates in every status. The snapshot is not a delivery promise — send_message re-checks and may fail. `descendants` walks your whole subtree; send_message is depth-1 only, deeper entries interrupt_agent-only.",
    parameters: {
      properties: {
        scope: "Default: children.",
      },
    },
  },

  read: {
    description:
      "Read a UTF-8 text file; returns line-numbered content.",
    parameters: {
      properties: {
        offset: "1-based first line; defaults to 1.",
        limit: "Max lines; defaults to 2000.",
      },
    },
  },

  read_image: {
    description:
      "Read a PNG/JPEG/WebP/GIF file and return the image itself. Extension-less paths are fine — format is detected from content. The harness validates and downscales large images; pass files directly. Independent files may be read concurrently in small batches; requires a model that accepts image input.",
  },

  send_message: {
    description:
      "Send a message to a direct continuable child by agent id — or your direct parent, if you are a resident continuable child. Working: the message steers its nearest step; idle: starts a turn. No answer returns — only delivery confirmation; failure means NOT delivered.",
    parameters: {
      properties: {
        agent_id: "",
        message: "",
      },
    },
  },

  skill: {
    description:
      "Load a skill's full instructions; call with the exact skill name from the session catalog before acting on a task that names or clearly matches it.",
    parameters: {
      properties: {
        name: "",
      },
    },
  },

  subagent: {
    description:
      "Delegate a self-contained task to a subagent — a separate agent in its own context, blind to this conversation (write a complete, standalone prompt; you receive only its result). Background by default: durable subagent id returned immediately; the parent gets a runtime notice with the outcome and final message on settlement. `send_message` steers a running child's nearest step or starts a turn for an idle one; `run_in_background: false` waits for the result.",
    parameters: {
      properties: {
        description: "Short (3-5 word) task description.",
        prompt: "The complete, standalone task.",
        run_in_background: "Default true.",
      },
    },
  },

  subagent_fork: {
    description:
      "Delegate to a subagent that inherits this conversation — seeded with all completed turns, not the in-flight one — for follow-ups on this context (you receive only its result). Background by default: durable subagent id returned immediately; the parent gets a runtime notice with the outcome and final message on settlement. `send_message` steers a running child's nearest step or starts a turn for an idle one; `run_in_background: false` waits for the result.",
    parameters: {
      properties: {
        description: "Short (3-5 word) task description.",
        prompt: "State only what is new.",
        run_in_background: "Default true.",
      },
    },
  },

  todo_write: {
    description:
      "Record/update a structured task list for current work. Send the ENTIRE list every call — it REPLACES the previous list (no partial updates); add one todo per concrete step up front. Keep at least one `in_progress` while work remains (several at once for genuinely parallel work); mark `completed` the moment a todo is done. Skip for trivial single-step tasks.",
    parameters: {
      properties: {
        todos: "",
      },
    },
  },

  update_goal: {
    description:
      "Update the exact current goal revision: edit/pause/resume need a direct top-level human request; complete and blocked also allowed during an automatic continuation. blocked is rejected before the minimum round count; explain in blocked_reason that the same condition persisted across those rounds.",
    parameters: {
      properties: {
        action: "",
        revision: "Exact revision from get_goal.",
        objective: "Replacement objective; only with edit.",
        max_goal_rounds: "Replacement cap; only with edit.",
        blocked_reason: "Required with action blocked.",
      },
    },
  },

  web_fetch: {
    description:
      "Fetch the content of an HTTP(S) URL, decoded to text.",
  },

  web_search: {
    description:
      "Search the web for current information; returns an optional summary answer and source URLs.",
    parameters: {
      properties: {
        queries: "Required; accepts 1–4 queries, results merged.",
      },
    },
  },

  write: {
    description: "Create or fully replace a UTF-8 text file.",
    parameters: {
      properties: {
        sandbox_permissions:
          "Wider mode for a one-shot retry after a sandbox denial.",
        justification:
          "With sandbox_permissions: one sentence justifying the wider access.",
      },
    },
  },
};

/**
 * Behavior-preservation checklists: facts each curated description must
 * still state, so wording edits cannot silently drop safety semantics.
 * One test per curated tool asserts every item survives the projection
 * (checked against the tool-level description plus every description
 * string inside its projected parameters).
 */
export const safetyChecklists = {
  ask_user_question: [
    "confirmation, a choice, or missing information", // why to ask
    "stable id", // id is echoed in the answer
    "(Recommended)", // recommendation convention
    "goes first", // recommended option ordering
    "more than one option", // multi-select semantics
    "defaults to false", // multi_select default
  ],
  bash: [
    "fresh shell", // no state persists between calls; workdir instead of cd
    "[exit code: N]", // non-zero exits are reported as a marker
    "[sandbox: file access denied under <mode> mode]", // sandbox-denial marker
    "retry the exact same command once with `sandbox_permissions`", // one-shot escalation
    "`justification`", // escalation requires a justification sentence
    "returns a job id immediately", // background runs come back as a job id
    "truncated to its tail", // long output truncation + spill file
  ],
  create_goal: [
    "same-session", // goal scope
    "long-running objective", // when to create
    "autonomous goal rounds", // continuation across rounds
    "trivial single-turn", // anti-pattern
    "non-human and subagent authority", // execution authority rule
    "Safe-integer", // max_goal_rounds constraint
  ],
  edit: [
    "replacing literal text", // literal-replacement contract (overwrite semantics)
    "Must match exactly", // exact-match requirement
    "must appear exactly once", // old_string uniqueness when replace_all is false
    "Default false", // replace_all default
    "Empty string deletes", // deletion via empty new_string
  ],
  get_goal: [
    "id/revision", // identifies the exact goal for updates
    "blocker reason", // blocked state surface
    "round limit", // max rounds visibility
    "before updating a goal", // read-before-update rule
  ],
  glob: [
    "never directories", // files only
    "hidden and ignored files", // visibility scope
    "modification-time order", // result ordering
    "first 100", // cap behavior
    "Does not enumerate directory entries", // not an ls
  ],
  grep: [
    "ripgrep", // regex engine
    "line numbers", // match shape
    "grouped by file", // match grouping
    "250", // inline cap
    "read on a matched file", // context follow-up
    "not a list", // include is a single glob
  ],
  interrupt_agent: [
    "current turn", // what is cancelled
    "direct child or deeper agent", // reachable targets
    "Only the current turn stops", // scope of the stop
    "parked until a later send_message", // queued messages survive
    "keep running", // agents it started are unaffected
    "available for follow-ups", // agent survives the interrupt
    "no-op", // interrupting a finished agent is safe
  ],
  job_kill: [
    "background job by job id", // wiring: id from the starting tool
    "returns immediately", // async cancellation
    "killed", // eventual settled state
    "Job id from the tool that started the work", // job wiring
  ],
  job_list: ["running and finished", "ids/kinds/statuses"],
  job_output: [
    "background job", // job wiring
    "Job id from the tool that started the work", // job wiring via job_id
    "since the previous read", // stream semantics
    "after settlement", // final-output semantics
    "[status: ...]", // status marker on every response
    "Non-blocking unless `wait: true`", // wait opt-in
    "[status: running]", // timed-out wait leaves the job alive
  ],
  list_agents: [
    "durable id", // identity of listed agents
    "not to poll for completion", // recall, not polling
    "told when one finishes", // completion notice arrives unprompted
    "running = working now", // status meaning
    "idle = loaded, between turns", // status meaning
    "storage-only", // ready status meaning
    "steers a running child", // send_message steering (running)
    "starts a turn", // send_message steering (idle)
    "candidates in every status", // direct children always addressable
    "not a delivery promise", // snapshot advisory
    "depth-1 only", // send_message depth rule
    "interrupt_agent-only", // deeper entries rule
  ],
  read: [
    "line-numbered", // output shape
    "1-based", // offset convention
    "defaults to 2000", // limit default
  ],
  read_image: [
    "PNG/JPEG/WebP/GIF", // supported formats
    "detected from content", // extension not required
    "downscales large images", // harness-side preprocessing
    "concurrently in small batches", // parallel reads
    "accepts image input", // model capability requirement
  ],
  send_message: [
    "direct continuable child", // primary target
    "direct parent", // resident-child upward messaging
    "steers its nearest step", // steering a working target
    "starts a turn", // starting an idle target
    "No answer returns", // no reply channel
    "NOT delivered", // failure semantics
  ],
  skill: [
    "full instructions", // what loading yields
    "exact skill name", // name must match exactly
    "before acting", // load before following a skill
  ],
  subagent: [
    "separate agent in its own context", // isolated context
    "blind to this conversation", // no shared context with the child
    "only its result", // parent receives result, not steps
    "complete, standalone prompt", // prompt requirement
    "Background by default", // default execution mode
    "durable subagent id", // immediate return value
    "runtime notice", // completion notice
    "outcome and final message", // notice contents
    "nearest step", // send_message steering (running)
    "starts a turn", // send_message steering (idle)
    "`run_in_background: false`", // foreground opt-in
  ],
  subagent_fork: [
    "inherits this conversation", // inherited context (vs subagent's isolated)
    "all completed turns", // what the child is seeded with
    "not the in-flight one", // seeding boundary
    "only its result", // parent receives result, not steps
    "Background by default", // default execution mode
    "durable subagent id", // immediate return value
    "runtime notice", // completion notice
    "outcome and final message", // notice contents
    "nearest step", // send_message steering (running)
    "starts a turn", // send_message steering (idle)
    "`run_in_background: false`", // foreground opt-in
  ],
  todo_write: [
    "ENTIRE list", // full-list send
    "REPLACES the previous list", // replacement semantics
    "no partial updates", // no incremental edits
    "at least one `in_progress`", // invariant while work remains
    "several at once", // parallel in_progress allowed
    "the moment a todo is done", // complete immediately, no batching
    "trivial single-step", // when to skip the list
  ],
  update_goal: [
    "exact current goal revision", // revision matching
    "direct top-level human request", // edit/pause/resume authority
    "automatic continuation", // when complete/blocked open up
    "minimum round count", // blocked guard
    "persisted across those rounds", // same-condition judgment
    "blocked_reason", // explanation field
  ],
  web_fetch: ["HTTP(S) URL", "decoded to text"],
  web_search: [
    "1–4 queries", // query-array bounds
    "results merged", // multi-query merging
    "summary answer", // optional summary
    "source URLs", // result shape
  ],
  write: [
    "Create or fully replace", // overwrite semantics (no append/partial)
    "sandbox_permissions", // escalation path exists
    "one sentence justifying the wider access", // escalation justification
  ],
};
