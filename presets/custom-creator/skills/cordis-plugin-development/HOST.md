# Cordis Plugin Development — Host

Use this reference for Host Services and Events, dependency injection, timers, lifecycle effects, dynamic model Tools, and package-private Host handlers.

## Access Services

Read optional capabilities with `ctx.get(name)` and handle absence:

```js
return {
  apply(ctx) {
    const service = ctx.get('serviceName')
    if (service === undefined) return
    service.someMethod()
  },
}
```

Declare `inject` only for a hard dependency that should place the Plugin into waiting until the Service appears:

```js
return {
  inject: ['requiredService'],
  apply(ctx) {
    ctx.requiredService.someMethod()
  },
}
```

The live Service contract decides the method names, parameters, return values, access rules, and cleanup behavior. Use `ctx.requiredService` only when that name appears in `inject`.

## Own side effects

Every contribution must be removable after stop, update, or removal.

- Register Events with `ctx.on()`.
- Wrap external subscriptions with `ctx.effect()` when the subscription returns a disposer.
- Retain disposers returned by Services, Tools, timers, themes, and other Cordis APIs.
- Keep effects inside `apply()` or a Cordis-owned lifecycle scope.

Example:

```js
return {
  apply(ctx) {
    const service = ctx.get('serviceName')
    if (service === undefined) return
    ctx.effect(() => service.subscribe((value) => {
      console.log(value)
    }))
  },
}
```

If a subscription does not return a disposer, inspect its live contract for the supported cleanup mechanism before using it.

## Timers

On Host and Client, `timer` is a Service rather than a global Builtin. Query the corresponding platform's `Service.listService` contract for `timer`, then declare it as a hard dependency before using the timer mixin.

```js
return {
  inject: ['timer'],
  apply(ctx) {
    ctx.timeout(() => console.log('done'), 300)
  },
}
```

Periodic work uses the live timer mixin in the same way. Prefer Cordis timers over assumed native timer globals so cleanup follows the Plugin lifecycle.

## Events

Inspect the Event contract before registering the listener. Confirm platform, argument order, return value, and mode.

Ordinary emit Event:

```js
return {
  apply(ctx) {
    ctx.on('some/event', (payload) => {
      console.log(payload)
    })
  },
}
```

For a Waterfall Event, the live contract identifies `next`. Continue downstream processing unless the feature intentionally terminates the waterfall:

```js
return {
  apply(ctx) {
    ctx.on('some/waterfall', (payload, next) => {
      console.log(payload)
      return next()
    })
  },
}
```

## Package-private Client → Host RPC

Use package-private RPC when Client UI genuinely needs Host-owned data or behavior.

Host registers a method with the live `harness.handle` contract:

```js
return {
  apply(ctx) {
    harness.handle('read-state', async (args) => {
      return { value: args.key }
    })
  },
}
```

Client invokes it with the live `host.call` contract. Arguments and return values must be lossless JSON. Extract scalars from internal live data before constructing the response.

Keep the method package-private. A private Package bridge does not require a public Remote Service.

## Dynamic model Tools

Host may register a Tool callable in a later model step.

Before registration:

1. Read the current `harness` signature with Host `Builtin.listBuiltins`.
2. Read `Tool.listTools` to confirm the current Tool namespace and avoid collisions.
3. Define JSON-compatible arguments and business results.
4. Register the Tool inside the current Plugin Fiber so stop/update removes it automatically.

The Tool's `execute` path owns the business result. Rendering owns presentation only. Do not place Cordis runtime objects, functions, class instances, React elements, Services, or Contexts in Tool input/output.

## Internal live data

Service instances, Event payloads, Session data, Conversation Snapshots, Tool state, and other DSH/Cordis objects are live runtime data.

Select only the leaf fields the feature needs. Build owned JSON from strings, numbers, booleans, arrays, and plain objects under your control. Avoid whole-object copying, recursive enumeration, or generic serialization of runtime objects.

## Host checklist

Before defining the Package:

- every Service and Event came from the current Host live contract;
- each `ctx.x` hard dependency appears in `inject`;
- optional Services use `ctx.get()` and handle absence;
- every listener, subscription, timer, Tool, or handler has a Cordis-owned cleanup path;
- package RPC and Tool values are JSON-owned data rather than live runtime objects.
