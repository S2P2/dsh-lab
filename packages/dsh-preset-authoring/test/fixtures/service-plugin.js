export function apply(ctx, config) {
	return ctx.provide(config.name, { from: "preset" });
}
