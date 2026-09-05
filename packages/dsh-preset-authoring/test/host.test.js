import assert from "node:assert/strict";
import { test } from "node:test";
import { apply, serviceName } from "../src/index.js";

test("host plugin provides one disposable shared draft service", () => {
	let provided;
	const dispose = () => {};
	const returned = apply({
		provide(name, value) {
			provided = { name, value };
			return dispose;
		},
	});

	assert.equal(provided.name, serviceName);
	assert.equal(typeof provided.value.dispatch, "function");
	assert.equal(typeof provided.value.getSnapshot, "function");
	assert.equal(returned, dispose);
});
