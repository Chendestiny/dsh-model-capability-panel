/**
 * Model capability panel, node half. Pure UI plugin: the empty apply exists so the
 * plugin appears in the host cordis composition / Loader; the browser half ships
 * via `exports["./client"]`, discovered through the package.json `dsh.client`
 * declaration and served at `/plugins/dsh-model-capability-panel/client.js`.
 *
 * The panel writes the per-model fields the runtime already enforces:
 *   - `llm-pi-ai.providers.<route>.models[].input`        (`["text","image"]`)
 *   - `llm-deepseek.models[].inputModalities`             (`["text","image"]`)
 *   - `llm-pi-ai.providers.<route>.models[].reasoningEfforts` (level dict / `false`)
 * and reorders by whole-value sets (the `models` array per route, the user-layer
 * `providers` map) — the host cannot address array elements, so nothing is ever
 * patched in place.
 *
 * @module dsh-model-capability-panel
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
function apply() {}

export { apply };
