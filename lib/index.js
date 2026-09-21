/**
 * Model modality panel, node half. Pure UI plugin: the empty apply exists so the
 * plugin appears in the host cordis composition / Loader; the browser half ships
 * via `exports["./client"]`, discovered through the package.json `dsh.client`
 * declaration and served at `/plugins/dsh-model-modality-panel/client.js`.
 *
 * The panel writes only the per-model modality field the runtime already
 * enforces:
 *   - `llm-pi-ai.providers.<route>.models[].input`        (`["text","image"]`)
 *   - `llm-deepseek.models[].inputModalities`             (`["text","image"]`)
 *
 * @module dsh-model-modality-panel
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
function apply() {}

export { apply };
