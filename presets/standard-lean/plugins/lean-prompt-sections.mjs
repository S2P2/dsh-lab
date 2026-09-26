// Prompt-section surgery for the standard-lean preset.
//
// Upstream DSH is actively moving tool-guidance mechanics into tool
// descriptions and keeping only short unique-rule sections (rc.1 -> rc.2
// deduplicated glob, web_search, web_fetch, subagent, and most of
// write/read). This listener finishes that job for the sections a lean
// coding session still pays for, and passes everything else through so
// upstream improvements keep arriving on upgrade.
//
// Maintain via the "Prompt sections" watch list in README.md: when upstream
// deduplicates a rewritten section or stops shipping a dropped one, remove
// the entry here in the same change that re-diffs cordis.patch.yml.

export const name = 'standard-lean-prompt-sections'

// Sections dropped outright. Their content is deployment context a lean
// coding session aimed at arbitrary repositories does not need:
//   - harness:source                 DSH implementation checkout root
//   - app:web-surface                Web GUI / HMR / no-replacement-server rules
//   - ui:deliverable-file-references deliverable-card and link-formatting policy
//                                     (a two-line replacement lives in the
//                                     persona suffix in cordis.patch.yml)
const DROP = new Set([
  'harness:source',
  'app:web-surface',
  'ui:deliverable-file-references',
])

// Sections kept but rewritten to only the rule that tool descriptions do
// not already carry. `tool:edit`'s stock paragraph restates the literal
// match / replace_all semantics that edit's property descriptions cover;
// the read-first policy with its this-session exception is the only
// unique rule, so it is what stays.
const REPLACE = new Map([
  [
    'tool:edit',
    'Read a file before editing it with edit (the default fs-observation-policy requires it), unless you just created or edited it in this session.',
  ],
])

export function apply(ctx) {
  ctx.on('system-prompt/assemble', (assembly) => {
    assembly.sections = assembly.sections.filter(
      (section) => !DROP.has(section.name),
    )
    for (const section of assembly.sections) {
      const replacement = REPLACE.get(section.name)
      if (replacement !== undefined) section.text = replacement
    }
  })
}
