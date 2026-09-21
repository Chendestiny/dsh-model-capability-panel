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
assert.equal(registration?.id, 'dsh-model-modality-panel', 'bundle registers under its package id');

const mod = registration.factory((name) => {
	if (name === 'react') return react;
	throw new Error(`unexpected require: ${name}`);
});
assert.equal(typeof mod.apply, 'function', 'exports apply');
assert.deepEqual(mod.inject, ['slots', 'connection'], 'declares the services it needs');

// ---- capture the slot registration ---------------------------------------
let slot;
const ctx = {
	get: (name) => (name === 'connection' ? { api } : undefined),
	slots: { inject: (name, cb) => { assert.equal(name, 'settings.section'); cb(); }, register: (options, component) => { slot = { options, component }; } },
};
const writes = [];
const api = {
	settings: {
		describe: async () => ({ result: { ok: true, value: { writable: true, hasDocument: true, namespaces } } }),
		mutate: async (request) => { writes.push(request); return { result: { ok: true, value: { ...namespaces.find((n) => n.ns === request.ns), revision: 2 } } }; },
	},
};
mod.apply(ctx);
assert.equal(slot?.options?.name, 'settings.section', 'registers on the settings section slot');
assert.equal(slot?.options?.id, 'model-modality');
assert.equal(slot?.options?.order, 150);
assert.equal(slot?.options?.label?.(), '模型读图');
const injected = slot.options.inject();
assert.equal(injected.api, api, 'injects the connection api');

// ---- fixtures --------------------------------------------------------------
const namespaces = [
	{
		ns: 'llm-pi-ai',
		revision: 1,
		user: { providers: { routeA: { models: [
			{ id: 'vision-model', contextWindow: 1000000, input: ['text', 'image'] },
			{ id: 'text-model', contextWindow: 256000, reasoningEfforts: { high: 'high' } },
		] } } },
		value: { providers: {
			routeA: { api: 'openai-completions', baseURL: 'https://example.test/v1', models: [
				{ id: 'vision-model', contextWindow: 1000000, input: ['text', 'image'] },
				{ id: 'text-model', contextWindow: 256000, input: [], reasoningEfforts: { high: 'high' } },
			] },
			routeB: { models: [{ id: 'catalog-model', input: [] }] },
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
const checkboxes = [];
walk(tree, (node) => { if (node.type === 'input') checkboxes.push(node); });
const labels = [];
walk(tree, (node) => { if (typeof node.children?.[0] === 'string') labels.push(node.children[0]); });
assert.equal(checkboxes.length, 5, `one checkbox per model (got ${checkboxes.length})`);
assert.deepEqual(checkboxes.map((box) => box.props.checked), [true, false, false, true, false], 'checked mirror the declared modality');

// ---- toggle on: text-model gains image -----------------------------------
await checkboxes[1].props.onChange({ target: { checked: true } });
const first = writes.at(-1);
assert.equal(first.ns, 'llm-pi-ai');
assert.equal(first.expectedRevision, 1, 'carries the namespace revision');
assert.deepEqual(first.ops, [{ op: 'set', path: ['providers', 'routeA', 'models'], value: [
	{ id: 'vision-model', contextWindow: 1000000, input: ['text', 'image'] },
	{ id: 'text-model', contextWindow: 256000, reasoningEfforts: { high: 'high' }, input: ['text', 'image'] },
] }], 'whole-array write keeps every hand-written field and adds the modality');

// ---- toggle off: vision-model drops the declaration ----------------------
await checkboxes[0].props.onChange({ target: { checked: false } });
const second = writes.at(-1);
assert.deepEqual(second.ops[0].value[0], { id: 'vision-model', contextWindow: 1000000 }, 'unchecking removes the field instead of writing ["text"]');

// ---- catalogue-inherited route materializes on first edit ----------------
await checkboxes[2].props.onChange({ target: { checked: true } });
const third = writes.at(-1);
assert.deepEqual(third.ops, [{ op: 'set', path: ['providers', 'routeB', 'models'], value: [{ id: 'catalog-model', input: ['text', 'image'] }] }], 'inherited route writes the resolved entry');

// ---- deepseek family ------------------------------------------------------
await checkboxes[3].props.onChange({ target: { checked: false } });
const fourth = writes.at(-1);
assert.equal(fourth.ns, 'llm-deepseek');
assert.equal(fourth.expectedRevision, 7);
assert.deepEqual(fourth.ops, [{ op: 'set', path: ['models'], value: [
	{ id: 'deepseek-flash', inputModalities: ['text'] },
	{ id: 'deepseek-v4-pro', inputModalities: ['text'] },
] }], 'deepseek toggle-off clears the modality and the image budget fields the validator rejects');

const rendered = JSON.stringify(tree);
assert.ok(rendered.includes('模型读图'), 'renders the panel title');
console.log('smoke: OK — 5 models, 4 write payloads verified');
