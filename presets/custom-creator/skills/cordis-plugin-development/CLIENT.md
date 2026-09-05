# Cordis Plugin Development — Client UI

Use this reference for Slots, settings, session/page props, Tool cards, overlays, themes/styles, and the Client side of package-private RPC.

## Register UI through Slots

Query `Slots.listSubTree` without `root` to choose a target from the live topology, then query the exact Slot with `root` before writing registration code.

The exact Slot contract determines:

- its purpose in the layout;
- registration protocol (`single`, `list`, `keyed`, or `chain`);
- registration options, keys, ids, or selectors;
- standard scope props and owner props;
- current occupants, replacement risks, and descendant Slots.

Use `ctx.get('slots')` for the optional Slot service, then `slots.inject` to wait for the declaration and register inside that callback:

```js
return {
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return
    slots.inject('target.slot', () => slots.register(
      { name: 'target.slot', id: 'my-view' },
      (props) => React.createElement('div', null, String(props.someValue)),
    ))
  },
}
```

Take the target name, key/id/selector, and props from the live Slot contract. Prefer an additive inner Slot over replacing a root-level occupant because replacing an occupant also removes the descendant Slots it declares.

## React and execution environment

Client code is plain JavaScript evaluated without JSX or a bundler. Build UI with `React.createElement(...)` and use only globals confirmed by `Builtin.listBuiltins`.

`apply()` registers lifecycle contributions; it does not return a React Element as the Plugin result.

## Settings UI

Choose the narrowest settings entry point that still fits the feature.

A full settings surface normally deserves its own settings section. A compact general preference may fit a general settings item. Query the actual subtree and exact Slot contract before choosing.

Dynamic Plugins are process-local. Keep temporary interaction state in memory for the Plugin lifetime unless the requested feature explicitly requires a real persistence Service and the live contract supports it.

## Session and page data

Session-scoped Slots may already provide hooks or owner props for Session, workspace, projection, input state, actions, or Conversation Snapshot data.

Use those props directly when they own the needed data. Select only the fields the component renders or acts on. Add Host RPC only when the data or operation is genuinely Host-owned.

## Cordis Run-specific UI

When UI is specifically tied to the latest `cordis_run` result for this Package, inspect `tool.view.cordis` before registering it. The current upstream contract commonly uses `key: 'self'`, which binds to the current Plugin + Package rather than a particular run id.

Treat that as a specialized surface, not the default destination for every Client feature. Settings, sidebars, message actions, overlays, and other product regions should use their own queried Slots when those locations better match the requirement.

## Ordinary Tool cards

To customize a model Tool call card, inspect the live Tool-view Slot and the exact Tool schema first. A keyed registration can replace an existing product card, so verify both the key and replacement risk before registering.

When the Plugin adds a new Tool itself, verify that Tool's visible schema after registration before customizing its card.

## Overlays and local entry points

For a toast, status notice, or frame-wide overlay, inspect the overlay Slot and its pointer-event/layering contract first. Decide how the user shows and hides interactive overlays and how the element should coexist with existing layers.

For small controls, prefer narrow additive Slots close to the feature rather than replacing a whole sidebar, conversation region, or page shell.

## Themes and styles

Choose scope before implementation:

1. **Global theme change:** inspect `Theme.listTokens`, then inspect the Client theme Service contract. Override only supported tokens and retain the returned disposer.
2. **Package-owned components:** insert local CSS through the live styles capability and prefer theme CSS variables for colors.
3. **New visible content:** choose the Slot first, then decide whether local styles or a global token change is appropriate.

Integrate with Slots and Theme APIs rather than product DOM selectors. Use `document`, `window`, or other browser globals only if the live Builtin contract explicitly provides them.

## Client side of package RPC

Call a package-private Host method through the live `host.call` contract:

```js
return {
  async apply(ctx) {
    const result = await host.call('read-state', { key: 'demo' })
    console.log(result.value)
  },
}
```

Arguments and results must be lossless JSON. Pass owned data, not functions, React elements, Services, Contexts, or other runtime objects.

If the same information is already supplied in Slot props, use the props instead of RPC.

## Timers in React

The Client timer is a Service, not a native global. Inspect the Client timer Service, declare it as a hard dependency, and let the returned disposer follow component/Plugin lifecycle.

```js
return {
  inject: ['timer'],
  apply(ctx) {
    function Clock() {
      React.useEffect(() => ctx.interval(() => console.log('tick'), 1000), [])
      return React.createElement('div', null, 'Running')
    }
    // Register Clock through a queried Slot.
  },
}
```

## Client checklist

Before defining the Package:

- the target Slot was chosen from the current subtree and then queried exactly;
- registration options, keys/selectors, and props match that live contract;
- data already supplied by Slot props stays on Client rather than being fetched again;
- JSX, imports, and assumed browser globals are absent;
- component, Slot, theme, style, and timer effects have lifecycle cleanup;
- whole live Session/Snapshot/props objects are not copied or rendered indiscriminately.
