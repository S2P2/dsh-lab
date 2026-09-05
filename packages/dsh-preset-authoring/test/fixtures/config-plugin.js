import z from "@deepseek-ai/schemastery";

export const Config = z.object({ requiredText: z.string().required() });
export function apply() {}
