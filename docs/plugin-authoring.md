# DSH plugin authoring — field notes

What the shipped package READMEs don't say plainly, learned by building
`dsh-quota-bar` (2026-08-22 session; every trap below cost at least one failed
restart). Audience: future plugins in this lab. The authoritative contracts
live in the per-package READMEs under
`node_modules/@deepseek-ai/*/README.md` of the DSH install — this file is the
distilled "how the pieces fit", not a replacement.

## Two halves, one package

A plugin is a plain npm package with a `dsh` manifest in `package.json`:

```jsonc
{
  "name": "@s2p2/dsh-<thing>",
  "type": "module",
  "main": "src/index.js",                  // host half (Node)
  "exports": {
    ".": "./src/index.js",
    "./client": "./src/client.js",         // browser half (served at /plugins/<pkg>/client.js)
    "./package.json": "./package.json"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },   // REQUIRED for composition (see trap 1)
    "client": {
      "inject": ["@deepseek-ai/dsh-client-runtime"],  // package ids the browser half uses
      "platform": "web"
    }
  }
}
```

- **Host half** (`src/index.js`): ESM, exports `apply(ctx, config)`. Node
  side. Can inject host services (`webServer`, `credentials`, `settings`, …).
- **Client half** (`src/client.js`): registers a classic-script factory. No
  build step required — a hand-written bundle works; TS packages compile to
  the same shape with tsdown. React is available via the shell
  (`require("react")`), no bundler needed.

## The four traps

### 1. The patch file is a list of OPERATIONS

`cordis.patch.yml` entries must be wrapped in `- insert:`. A bare `- id:` row
is parsed as a config override for a nonexistent entry and is **silently
ignored** — the entry never composes, the bundle never serves (404), and no
error appears anywhere.

```yaml
# dsh bundle patch: inserts this plugin into a profile's layer stack.
- insert:
    - id: dsh-<thing>
      name: '@s2p2/dsh-<thing>'
```

### 2. `inject` means SERVICE names on both halves — but they're different lists

- **Host** (`cordis.patch.yml` row or `ctx.inject([...])`): service names —
  `"webServer"`, `"credentials"`, `"settings"`. A package name here stalls the
  fiber forever: "pending (waiting for service: @deepseek-ai/…)" and the boot
  banner fails.
- **Client** (`package.json dsh.client.inject` and the bundle's
  `exports.inject`): PACKAGE ids for browser packages you import — but
  `exports.inject` (the runtime wait list) takes SERVICE names again
  (`["slots"]`, `["sessions"]`, …). Confusingly, `dsh.client.inject` in the
  manifest takes package ids. They are different fields with different
  grammars; check both.

### 3. `slots.register` — `name` is the TARGET SLOT KEY

```js
ctx.slots.inject("conversation.input.dock", function* () {
  yield ctx.slots.register(
    { name: "conversation.input.dock", id: "my-thing", order: 12 },
    MyComponent
  );
});
```

`name` must equal the slot's declared key (the same string you inject on); a
unique name creates a phantom slot nothing renders — no error, no output.
`id` is your contribution's identity; `order` positions it in list slots.

Known slots (declare-check by grepping shipped bundles):
`conversation.input.dock` (ordered stack above composer, GoalBar = order 10),
`conversation.input.right`, `conversation.session.header.actions`,
`sidebar.footer.action`, `shell.overlay` (app-shell floating layer —
dshmarket/quota-panel pattern; always renders).

### 4. `apiKeyEnv` is a credentials REF, not an env var read

Provider settings carry references; values live behind the credentials
service. Resolve per operation, never cache:

```js
const hit = await ctx.credentials.resolve("ZAI_API_KEY");  // { value, source } | undefined
```

Precedence inside the service: process env > `~/.dsh/.credentials.yaml` >
`.env` files. Reading `process.env` directly misses keys stored via the
Models page. Also: declare `["webServer", "credentials"]` in `ctx.inject` and
fetch only after they're ready — an eager fetch at activation races service
startup and caches a key-missing error until the next interval tick.

## Host → browser data path

Client Typert remotes are fixed at build time (shipped assembly) — third-party
plugins serve data over an HTTP route instead, the dshmarket pattern:

```js
ctx.inject(["webServer", "credentials"], (host) => {
  host.effect(() =>
    host.webServer.register({
      kind: "exact",
      path: "/dsh-<thing>/data",
      handler: (req, res) => { /* GET -> JSON, loopback */ },
    })
  , "dsh-<thing>: route");
});
// browser: fetch("/dsh-<thing>/data") — same origin, no CORS
```

Keep secrets host-side; respond with derived data only (percentages, times).

## Theme & styling

Use DSW design-token CSS variables (what shipped UI uses) with literal
fallbacks:

- Surfaces: `--dsw-specific-tip` (floating cards), `--dsw-alias-bg-base` —
  note bg-base can be translucent in some themes; prefer opaque card
  surfaces over full-width strips (seam-leak lesson).
- Border/track: `--dsw-alias-border-l1` · dim text: `--dsw-alias-label-tertiary`
- States: `--dsw-alias-state-{success,warn,error}-primary`
- Composer alignment: `--dsh-composer-side-clearance`,
  `--dsh-composer-dock-inset`, `--dsw-composer-card-max-width` (see
  GoalBar's dock CSS in `dsh-client-ui-goal` for the width calc).

## Dev loop (no build step)

1. `dsh plugin --profile web add /abs/path/packages/dsh-<thing>` — links the
   package (add to `dsh.profile.bundles` requires trap 1's `dsh.bundle.patch`).
2. `dsh --profile web --dump-config` — verify the entry composed (this
   rewrites `cordis.yml`; run it whenever composition is in doubt).
3. Client-only changes: hard-refresh (Ctrl+Shift+R) may suffice; if the
   served hash is stale, restart `dsh web`. Host changes always need restart.
4. Browser-side diagnosis: `performance.getEntriesByType("resource")` (did the
   bundle load?), boot graph in page HTML (is the entry listed?),
   `document.body.innerText` (did anything render?).

## References

- Shipped READMEs: `node_modules/@deepseek-ai/{dsh-client-runtime,
  dsh-client-modules,dsh-credentials,dsh-credentials-local}/README.md`
- Working third-party example (TS, full feature set): dshmarket repo.
- This lab's minimal no-build template: `packages/dsh-quota-bar`.
- Prototype methodology (slot bake-off): branch `proto/quota-bar-slots`,
  `packages/dsh-quota-proto`.
