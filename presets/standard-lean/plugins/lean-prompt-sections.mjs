// Prompt-section surgery for the standard-lean preset.
//
// Upstream DSH is actively deduplicating guidance: rc.1 -> rc.2 shrank the
// glob, web_search, web_fetch, subagent, write, and edit sections to their
// unique rules and compressed tool-level descriptions by more than half.
// This listener removes the deployment sections a lean coding session aimed
// at arbitrary repositories does not need, and passes everything else
// through so upstream improvements keep arriving on upgrade.
//
// Maintain via the "Prompt sections" watch list in README.md: when upstream
// stops shipping a dropped section, remove the entry here in the same
// change that re-diffs cordis.patch.yml.
//
// NOTE: bundle edits materialize into the profile's loader tree only at
// INSTALL time (see README.md "Install") — changing this file alone does
// nothing until the bundle is re-installed and the Host restarted.

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

export function apply(ctx) {
  // The assemble event is an onion chain: every listener receives
  // (assembly, context, next) and must return next()'s result, exactly like
  // dsh-agent's model-selection listener. Returning undefined (e.g. by only
  // mutating in place) breaks the chain and crashes downstream listeners
  // with "Cannot read properties of undefined (reading 'variables')".
  ctx.on('system-prompt/assemble', async (assembly, _context, next) => {
    assembly.sections = assembly.sections.filter(
      (section) => !DROP.has(section.name),
    )
    return next()
  })
}
