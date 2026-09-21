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
let failNext = null;
const api = {
	settings: {
		describe: async () => ({ result: { ok: true, value: { writable: true, hasDocument: true, namespaces } } }),
		mutate: async (request) => {
			if (failNext !== null) { const message = failNext; failNext = null; throw new Error(message); }
			writes.push(request);
			return { result: { ok: true, value: { ...namespaces.find((n) => n.ns === request.ns), revision: 2 } } };
		},
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
			// strict key: supportsStrictMode (openai-completions); route compat feeds the 默认 badge
			routeA: { api: 'openai-completions', baseURL: 'https://example.test/v1', compat: { supportsStrictMode: true }, models: routeAModels },
			// no api declared at all: catalogue-inherited, so the strict toggle must not render.
			// Its route-level compat is not a leftover source — route compat stays read-only.
			routeB: { models: [{ id: 'catalog-model', input: [], compat: { supportsTemperature: true } }], compat: { forceAdaptiveThinking: true } },
			// strict key: supportsStrictTools (anthropic-messages); route compat feeds the 默认 badge
			routeC: { api: 'anthropic-messages', compat: { supportsStrictTools: true }, models: [
				{ id: 'claude-opus-5', compat: { supportsTemperature: false } },
			] },
			// an api no gate knows: the strict toggle must not render either
			routeD: { api: 'mystery-protocol', models: [{ id: 'unknown-api-model' }] },
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
const compatOf = (model) => compatBoxes.filter((candidate) => candidate.props['data-model'] === model);
const keysOf = (model) => compatOf(model).map((candidate) => candidate.props['data-key']);
const lastWrite = () => writes.at(-1);

eq(imageBoxes.length, 7, `one image toggle per model (got ${imageBoxes.length})`);
eq(compatBoxes.length, 7, `strict + leftovers, protocol-aware (got ${compatBoxes.length})`);
eq(boxes.length, 14, `14 toggles total: 7 image + 7 compat (got ${boxes.length})`);
deep(imageBoxes.map((candidate) => candidate.props.checked), [true, false, false, false, false, true, false], 'image toggles mirror the declared modality');
eq(compatBoxes.filter((candidate) => candidate.props['data-model'].startsWith('deepseek')).length, 0, 'the deepseek family gets no compat toggles (that adapter has none)');

// ---- the strict switch follows the route's protocol -----------------------
ok(keysOf('vision-model').includes('supportsStrictMode'), 'openai-completions renders supportsStrictMode');
ok(keysOf('claude-opus-5').includes('supportsStrictTools'), 'anthropic-messages renders supportsStrictTools instead');
eq(keysOf('claude-opus-5').includes('supportsStrictMode'), false, 'and never the other protocol\'s key');
eq(compatOf('unknown-api-model').length, 0, 'an api with no compat gate renders no strict toggle at all');
eq(keysOf('catalog-model').includes('supportsStrictMode'), false, 'a route that declares no api renders no strict toggle');
ok(keysOf('catalog-model').every((key) => key !== 'forceAdaptiveThinking'), 'a route-level non-strict key is not a leftover: route compat stays read-only');

// ---- leftovers: anything already configured stays reachable ---------------
deep(keysOf('text-model').sort(), ['supportsReasoningEffort', 'supportsStrictMode', 'supportsTemperature'], 'leftovers appear under their raw key names next to the strict switch');
deep(keysOf('claude-opus-5').sort(), ['supportsStrictTools', 'supportsTemperature'], 'leftovers render on the anthropic route too');
eq(compatOf('catalog-model').length, 1, 'a leftover alone still renders one toggle');

// ---- effective value + 默认 badge ----------------------------------------
eq(box('compat', 'text-model', 'supportsTemperature').props.checked, false, 'model-level false is shown as false');
eq(box('compat', 'text-model', 'supportsReasoningEffort').props.checked, true, 'model-level true is shown as true');
eq(box('compat', 'vision-model', 'supportsStrictMode').props.checked, true, 'route-level value applies to a model that declares nothing');
eq(box('compat', 'claude-opus-5', 'supportsStrictTools').props.checked, true, 'route-level value applies on the anthropic route');
eq(box('compat', 'catalog-model', 'supportsTemperature').props.checked, true, 'a model-level leftover reads from the model itself');
eq(box('compat', 'text-model', 'supportsStrictMode').props.checked, true, 'an unstated switch falls back to the route value');
const defaultBadges = [];
walk(tree, (node) => { if (node.children?.[0] === '默认') defaultBadges.push(node); });
eq(defaultBadges.length, 3, `one 默认 badge per route-inherited switch (got ${defaultBadges.length})`);
const rendered = JSON.stringify(tree);
ok(rendered.includes('模型能力'), 'renders the panel title');
ok(rendered.includes('模型读图') === false, 'the old title is gone');
ok(rendered.includes('supportsStrictTools'), 'the anthropic key is visible somewhere in the tree');

// ---- strict on: a model that declared no compat gains one ----------------
await box('compat', 'vision-model', 'supportsStrictMode').props.onChange({ target: { checked: true } });
const firstWrite = lastWrite();
eq(firstWrite.ns, 'llm-pi-ai');
eq(firstWrite.expectedRevision, 1, 'carries the namespace revision');
deep(firstWrite.ops, [{ op: 'set', path: ['providers', 'routeA', 'models'], value: [
	{ id: 'vision-model', contextWindow: 1000000, input: ['text', 'image'], compat: { supportsStrictMode: true } },
	routeAModels[1],
] }], 'the strict write adds only that switch, keeps every other field, and leaves sibling models untouched');

// ---- strict off: explicit false, sibling keys survive --------------------
await box('compat', 'text-model', 'supportsReasoningEffort').props.onChange({ target: { checked: false } });
deep(lastWrite().ops[0].value[1].compat, { supportsReasoningEffort: false, supportsTemperature: false }, 'unchecking a leftover writes an explicit false instead of deleting the key, and keeps the other keys');

// ---- strict on over an existing compat object ----------------------------
await box('compat', 'text-model', 'supportsStrictMode').props.onChange({ target: { checked: true } });
deep(lastWrite().ops[0].value[1].compat, { supportsReasoningEffort: true, supportsTemperature: false, supportsStrictMode: true }, 'checking adds true next to the existing keys');

// ---- the anthropic route writes its own key ------------------------------
await box('compat', 'claude-opus-5', 'supportsStrictTools').props.onChange({ target: { checked: false } });
const anthropicWrite = lastWrite();
deep(anthropicWrite.ops, [{ op: 'set', path: ['providers', 'routeC', 'models'], value: [
	{ id: 'claude-opus-5', compat: { supportsTemperature: false, supportsStrictTools: false } },
] }], 'the anthropic switch writes supportsStrictTools, never supportsStrictMode');

// ---- catalogue-inherited route materializes, empty modality list dropped --
await box('compat', 'catalog-model', 'supportsTemperature').props.onChange({ target: { checked: false } });
deep(lastWrite().ops, [{ op: 'set', path: ['providers', 'routeB', 'models'], value: [
	{ id: 'catalog-model', compat: { supportsTemperature: false } },
] }], 'inherited route writes the resolved entry and drops an empty input list');

// ---- image regression: on -------------------------------------------------
await box('image', 'text-model').props.onChange({ target: { checked: true } });
deep(lastWrite().ops, [{ op: 'set', path: ['providers', 'routeA', 'models'], value: [
	routeAModels[0],
	{ ...routeAModels[1], input: ['text', 'image'] },
] }], 'image on keeps hand-written contextWindow/reasoningEfforts/compat and adds the modality');

// ---- image regression: off ------------------------------------------------
await box('image', 'vision-model').props.onChange({ target: { checked: false } });
deep(lastWrite().ops[0].value[0], { id: 'vision-model', contextWindow: 1000000 }, 'image off removes the field instead of writing ["text"], and invents no compat');

// ---- deepseek family image toggle ----------------------------------------
await box('image', 'deepseek-flash').props.onChange({ target: { checked: false } });
const dsWrite = lastWrite();
eq(dsWrite.ns, 'llm-deepseek');
eq(dsWrite.expectedRevision, 7);
deep(dsWrite.ops, [{ op: 'set', path: ['models'], value: [
	{ id: 'deepseek-flash', inputModalities: ['text'] },
	{ id: 'deepseek-v4-pro', inputModalities: ['text'] },
] }], 'deepseek image off clears the modality and the image budget fields the validator rejects');

// ---- feedback: the host's own words on refusal, the path on success -------
/** Re-render with the state the toggles have written so far. */
const render = (extra = {}) => { hooks.cursor = 0; return slot.component({ ...injected, close: () => {}, ...extra }); };
const feedbackByKey = (tree2) => {
	const map = new Map();
	walk(tree2, (node) => {
		if (typeof node.props?.key === 'string' && node.props.key.endsWith('|feedback')) map.set(node.props.key, node);
	});
	return map;
};
const lineOf = (tree2, key) => feedbackByKey(tree2).get(key)?.children.join('');

// pending: observable while the write is in flight, and every toggle locks
const inFlight = box('compat', 'claude-opus-5', 'supportsStrictTools').props.onChange({ target: { checked: false } });
const midTree = render();
eq(feedbackByKey(midTree).get('llm-pi-ai|routeC|0|feedback')?.props['data-feedback'], 'pending', 'the clicked row shows a pending line while the write is in flight');
const midBoxes = [];
walk(midTree, (node) => { if (node.type === 'input') midBoxes.push(node); });
ok(midBoxes.length > 0 && midBoxes.every((candidate) => candidate.props.disabled === true), 'every toggle is disabled while a write is in flight');
await inFlight;

// success: the real path, the value, and the inherited-default note
eq(lineOf(render(), 'llm-pi-ai|routeC|0|feedback'),
	'已写入 llm-pi-ai.providers.routeC.models[0].compat.supportsStrictTools = false（当前继承默认，本次写入已变为显式覆写）',
	'the anthropic success line names the real route/index/key and flags the inherited default it just overrode');

const visionInFlight = box('compat', 'vision-model', 'supportsStrictMode').props.onChange({ target: { checked: false } });
await visionInFlight;
eq(lineOf(render(), 'llm-pi-ai|routeA|0|feedback'),
	'已写入 llm-pi-ai.providers.routeA.models[0].compat.supportsStrictMode = false（当前继承默认，本次写入已变为显式覆写）',
	'the openai-completions line names supportsStrictMode, not the other protocol\'s key');

// success on a value the model declared itself: no inherit note
await box('compat', 'text-model', 'supportsTemperature').props.onChange({ target: { checked: true } });
eq(lineOf(render(), 'llm-pi-ai|routeA|1|feedback'),
	'已写入 llm-pi-ai.providers.routeA.models[1].compat.supportsTemperature = true',
	'a switch the model declares itself gets no inherit note');

// success on image off: says the field was deleted rather than invented
await box('image', 'vision-model').props.onChange({ target: { checked: false } });
eq(lineOf(render(), 'llm-pi-ai|routeA|0|feedback'),
	'已写入 llm-pi-ai.providers.routeA.models[0].input（字段已删除，回落默认纯文本）',
	'image off reports the deleted field, not a value');

// the deepseek family reports its own path shape
await box('image', 'deepseek-flash').props.onChange({ target: { checked: false } });
eq(lineOf(render(), 'llm-deepseek||0|feedback'),
	'已写入 llm-deepseek.models[0].inputModalities（字段已删除，回落默认纯文本）',
	'the deepseek family reports llm-deepseek.models[i], not the pi-ai route shape');

// failure: the host refusal is surfaced verbatim, never swallowed
const hostRefusal = 'llm-pi-ai: provider "routeC" model "claude-opus-5" sets compat "supportsStrictMode", but its api is "anthropic-messages", which does not take it; that switch exists on openai-completions, and "anthropic-messages" offers supportsEagerToolInputStreaming, supportsLongCacheRetention, supportsCacheControlOnTools, supportsTemperature, forceAdaptiveThinking, allowEmptySignature, supportsStrictTools';
failNext = hostRefusal;
await box('compat', 'claude-opus-5', 'supportsTemperature').props.onChange({ target: { checked: false } });
const refusalNode = feedbackByKey(render()).get('llm-pi-ai|routeC|0|feedback');
eq(refusalNode?.props['data-feedback'], 'error', 'a refusal shows an error line on that row instead of a success line');
ok(refusalNode?.children.join('').includes(hostRefusal), 'the host\'s original validation text is shown verbatim');
ok(refusalNode?.children.join('').startsWith('写入被拒绝，宿主原文：'), 'and is labelled as the host refusal, not a bare "保存失败"');
ok(!refusalNode?.children.join('').includes('已写入'), 'a refused write never claims to have written anything');
const afterRefusal = [];
walk(render(), (node) => { if (node.type === 'input') afterRefusal.push(node); });
ok(afterRefusal.every((candidate) => candidate.props.disabled === false), 'the toggles come back unlocked after a refusal instead of sticking in pending');

// the success line clears itself, so it cannot be mistaken for persisted state
const shortTtl = { feedbackTtlMs: 15 };
const shortBoxes = [];
walk(render(shortTtl), (node) => { if (node.type === 'input') shortBoxes.push(node); });
const shortBox = shortBoxes.find((candidate) => candidate.props['data-kind'] === 'compat'
	&& candidate.props['data-model'] === 'catalog-model');
await shortBox.props.onChange({ target: { checked: false } });
ok(feedbackByKey(render(shortTtl)).has('llm-pi-ai|routeB|0|feedback'), 'the success line is on screen right after the write');
await new Promise((resolve) => setTimeout(resolve, 80));
eq(feedbackByKey(render(shortTtl)).has('llm-pi-ai|routeB|0|feedback'), false, 'and clears itself shortly after');
eq(feedbackByKey(render(shortTtl)).get('llm-pi-ai|routeC|0|feedback')?.props['data-feedback'], 'error', 'while a refusal stays put until the next write');

console.log(`smoke: OK — ${boxes.length} toggles (${imageBoxes.length} image + ${compatBoxes.length} compat) over 7 models across 4 pi-ai routes + deepseek, ${writes.length} write payloads, ${checks} assertions`);