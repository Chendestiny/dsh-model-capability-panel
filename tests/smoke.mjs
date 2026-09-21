/**
 * Smoke test for the browser half: drives the registered settings section with a
 * minimal React stub and asserts the `settings.mutate` payloads it produces.
 * No browser, no dsh server, no network.
 *
 *   node tests/smoke.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const clientPath = join(here, '..', 'lib', 'client.js');
const clientUrl = pathToFileURL(clientPath).href;

let checks = 0;
const eq = (actual, expected, msg) => { checks++; assert.equal(actual, expected, msg); };
const deep = (actual, expected, msg) => { checks++; assert.deepEqual(actual, expected, msg); };
const ok = (value, msg) => { checks++; assert.ok(value, msg); };

// ---- load the bundle through a fake module loader -------------------------
let registration;
const loader = { load: (spec) => { registration = spec; } };
const hooks = { states: [], cursor: 0 };
const react = {
	createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
	useState: (init) => {
		const index = hooks.cursor++;
		if (!(index in hooks.states)) hooks.states[index] = typeof init === 'function' ? init() : init;
		const set = (next) => { hooks.states[index] = typeof next === 'function' ? next(hooks.states[index]) : next; };
		return [hooks.states[index], set];
	},
	useEffect: () => {},
	useCallback: (fn) => fn,
};
globalThis.window = { __ModuleLoader__: loader };
await import(`${clientUrl}?t=${Date.now()}`);
eq(registration?.id, 'dsh-model-capability-panel', 'bundle registers under its package name (module route is /plugins/<package>/client.js)');

const mod = registration.factory((name) => {
	if (name === 'react') return react;
	throw new Error(`unexpected require: ${name}`);
});
eq(typeof mod.apply, 'function', 'exports apply');
deep(mod.inject, ['slots', 'connection'], 'declares the services it needs');

// ---- capture the slot registration ---------------------------------------
let slot;
const ctx = {
	get: (name) => (name === 'connection' ? { api } : undefined),
	slots: { inject: (name, cb) => { eq(name, 'settings.section', 'waits on the settings section slot'); cb(); }, register: (options, component) => { slot = { options, component }; } },
};
const writes = [];
const api = {
	settings: {
		describe: async () => ({ result: { ok: true, value: { writable: true, hasDocument: true, namespaces } } }),
		mutate: async (request) => { writes.push(request); return { result: { ok: true, value: { ...namespaces.find((n) => n.ns === request.ns), revision: 2 } } }; },
	},
};
mod.apply(ctx);
eq(slot?.options?.name, 'settings.section', 'registers on the settings section slot');
eq(slot?.options?.id, 'model-capability');
eq(slot?.options?.order, 150);
eq(slot?.options?.label?.(), '模型能力');
const injected = slot.options.inject();
eq(injected.api, api, 'injects the connection api');

// ---- fixtures --------------------------------------------------------------
const routeAModels = [
	{ id: 'vision-model', contextWindow: 1000000, input: ['text', 'image'] },
	{
		id: 'text-model',
		contextWindow: 256000,
		reasoningEfforts: { high: 'high' },
		compat: { supportsReasoningEffort: true, supportsTemperature: false },
	},
];
const namespaces = [
	{
		ns: 'llm-pi-ai',
		revision: 1,
		user: { providers: { routeA: { models: routeAModels } } },
		value: { providers: {
			routeA: { api: 'openai-completions', baseURL: 'https://example.test/v1', compat: { supportsStore: true }, models: routeAModels },
			routeB: { models: [{ id: 'catalog-model', input: [] }], compat: { forceAdaptiveThinking: true } },
		} },
	},
	{
		ns: 'llm-deepseek',
		revision: 7,
		user: { models: [
			{ id: 'deepseek-flash', inputModalities: ['text', 'image'], imagePixelBudget: 640000, imageMaxBytes: 1048576 },
			{ id: 'deepseek-v4-pro', inputModalities: ['text'] },
		] },
		value: { models: [
			{ id: 'deepseek-flash', inputModalities: ['text', 'image'], imagePixelBudget: 640000, imageMaxBytes: 1048576 },
			{ id: 'deepseek-v4-pro', inputModalities: ['text'] },
		] },
	},
];

// ---- render the ready state ----------------------------------------------
hooks.states[0] = { status: 'ready', namespaces, writable: true };
hooks.cursor = 0;
const tree = slot.component({ ...injected, close: () => {} });

const walk = (node, visit) => {
	if (Array.isArray(node)) { node.forEach((child) => walk(child, visit)); return; }
	if (node === null || typeof node !== 'object') return;
	visit(node);
	walk(node.children, visit);
};
const boxes = [];
walk(tree, (node) => { if (node.type === 'input') boxes.push(node); });
const box = (kind, model, key) => boxes.find((candidate) => candidate.props['data-kind'] === kind
	&& candidate.props['data-model'] === model
	&& (key === undefined || candidate.props['data-key'] === key));
const imageBoxes = boxes.filter((candidate) => candidate.props['data-kind'] === 'image');
const compatBoxes = boxes.filter((candidate) => candidate.props['data-kind'] === 'compat');
const lastWrite = () => writes.at(-1);

eq(imageBoxes.length, 5, `one image toggle per model (got ${imageBoxes.length})`);
eq(compatBoxes.length, 24, `8 compat toggles on each of 3 pi-ai models (got ${compatBoxes.length})`);
eq(boxes.length, 29, `29 toggles total: pi-ai 3x9 + deepseek 2x1 (got ${boxes.length})`);
deep(imageBoxes.map((candidate) => candidate.props.checked), [true, false, false, true, false], 'image toggles mirror the declared modality');
eq(compatBoxes.filter((candidate) => candidate.props['data-model'].startsWith('deepseek')).length, 0, 'the deepseek family gets no compat toggles (that adapter has none)');

// ---- compat effective value + 默认 badge ---------------------------------
eq(box('compat', 'text-model', 'supportsTemperature').props.checked, false, 'model-level false is shown as false');
eq(box('compat', 'text-model', 'supportsReasoningEffort').props.checked, true, 'model-level true is shown as true');
eq(box('compat', 'vision-model', 'supportsStore').props.checked, true, 'route-level value applies to a model that declares nothing');
eq(box('compat', 'catalog-model', 'forceAdaptiveThinking').props.checked, true, 'route-level value applies to a catalogue-inherited model');
eq(box('compat', 'vision-model', 'supportsStrictMode').props.checked, false, 'an unstated switch reads as false');
const defaultBadges = [];
walk(tree, (node) => { if (node.children?.[0] === '默认') defaultBadges.push(node); });
eq(defaultBadges.length, 3, `one 默认 badge per route-inherited switch (got ${defaultBadges.length})`);
const rendered = JSON.stringify(tree);
ok(rendered.includes('模型能力'), 'renders the panel title');
ok(rendered.includes('模型读图') === false, 'the old title is gone');

// ---- compat on: a model that declared no compat gains one ----------------
await box('compat', 'vision-model', 'supportsStrictMode').props.onChange({ target: { checked: true } });
const firstWrite = lastWrite();
eq(firstWrite.ns, 'llm-pi-ai');
eq(firstWrite.expectedRevision, 1, 'carries the namespace revision');
deep(firstWrite.ops, [{ op: 'set', path: ['providers', 'routeA', 'models'], value: [
	{ id: 'vision-model', contextWindow: 1000000, input: ['text', 'image'], compat: { supportsStrictMode: true } },
	routeAModels[1],
] }], 'compat write adds only the switch, keeps every other field, and leaves sibling models untouched');

// ---- compat off: explicit false, sibling keys survive --------------------
await box('compat', 'text-model', 'supportsReasoningEffort').props.onChange({ target: { checked: false } });
deep(lastWrite().ops[0].value[1].compat, { supportsReasoningEffort: false, supportsTemperature: false }, 'unchecking writes an explicit false instead of deleting the key, and keeps the other keys');

// ---- compat on over an existing compat object ----------------------------
await box('compat', 'text-model', 'supportsStrictTools').props.onChange({ target: { checked: true } });
deep(lastWrite().ops[0].value[1].compat, { supportsReasoningEffort: true, supportsTemperature: false, supportsStrictTools: true }, 'checking adds true next to the existing keys');

// ---- catalogue-inherited route materializes, empty modality list dropped --
await box('compat', 'catalog-model', 'forceAdaptiveThinking').props.onChange({ target: { checked: false } });
deep(lastWrite().ops, [{ op: 'set', path: ['providers', 'routeB', 'models'], value: [
	{ id: 'catalog-model', compat: { forceAdaptiveThinking: false } },
] }], 'inherited route writes the resolved entry and drops an empty input list');

// ---- image regression: on -------------------------------------------------
await box('image', 'text-model').props.onChange({ target: { checked: true } });
deep(lastWrite().ops, [{ op: 'set', path: ['providers', 'routeA', 'models'], value: [
	routeAModels[0],
	{ ...routeAModels[1], input: ['text', 'image'] },
] }], 'image on keeps hand-written contextWindow/reasoningEfforts/compat and adds the modality');

// ---- image regression: off ------------------------------------------------
await box('image', 'vision-model').props.onChange({ target: { checked: false } });
deep(lastWrite().ops[0].value[0], { id: 'vision-model', contextWindow: 1000000 }, 'image off removes the field instead of writing ["text"]');

// ---- deepseek family image toggle ----------------------------------------
await box('image', 'deepseek-flash').props.onChange({ target: { checked: false } });
const dsWrite = lastWrite();
eq(dsWrite.ns, 'llm-deepseek');
eq(dsWrite.expectedRevision, 7);
deep(dsWrite.ops, [{ op: 'set', path: ['models'], value: [
	{ id: 'deepseek-flash', inputModalities: ['text'] },
	{ id: 'deepseek-v4-pro', inputModalities: ['text'] },
] }], 'deepseek image off clears the modality and the image budget fields the validator rejects');

console.log(`smoke: OK — ${boxes.length} toggles (${imageBoxes.length} image + ${compatBoxes.length} compat) over 5 models, ${writes.length} write payloads, ${checks} assertions`);
