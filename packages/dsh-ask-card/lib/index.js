// @s2p2/dsh-ask-card — node half.
//
// Deliberately a no-op: this plugin is pure browser surface (the client half
// in ./client.js shadows the stock ask_user_question transcript row in the
// web shell's tool.call.toolview slot). Nothing to contribute host-side.
/** Host plugin body — client-only plugin; the web face lives in ./client.js. */
export function apply() {}
