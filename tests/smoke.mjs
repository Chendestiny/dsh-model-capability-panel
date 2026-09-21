/**
 * Smoke test for the browser half: drives the registered settings section with a
 * minimal React stub and asserts the `settings.mutate` payloads it produces.
 * No browser, no dsh server, no network.
 *
 * The mutate stub is stateful on purpose: a write lands in the namespace's user
 * layer, so the three postures of `reasoningEfforts` can be driven end to end
 * (enabled → switched off → switched on again) instead of being asserted from a
 * fixture that never moves.
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
globalThis.window = { __ModuleLoader__: { load: (spec) => { registration = spec; } } };
await import(`${clientUrl}?t=${Date.now()}`);
eq(registration?.id, 'dsh-model-capability-panel', 'bundle registers under its package name (module route is /plugins/<package>/client.js)');

const mod = registration.factory((name) => {
	if (name === 'react') return react;
	throw new Error(`unexpected require: ${name}`);
});
eq(typeof mod.apply, 'function', 'exports apply');
deep(mod.inject, ['slots', 'connection'], 'declares the services it needs');

// ---- fixtures --------------------------------------------------------------
const routeAModels = [
	/* enabled, the shape the existing pi-ai routes carry */
	{ id: 'glm-5.3-flash', input: ['text', 'image'], reasoningEfforts: { off: null, low: 'low', medium: 'medium', high: 'high' } },
	/* enabled with the extras already set: the disclosure must start open */
	{ id: 'full-model', reasoningEfforts: { off: null, minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' } },
	/* enabled with a hand-written wire spelling that must survive every edit */
	{ id: 'custom-wire-model', contextWindow: 500000, reasoningEfforts: { high: 'weird-wire' } },
	/* disabled */
	{ id: 'no-choice-model', reasoningEfforts: false },
	/* undeclared — the third-party case: no level picker in the chat UI because
	 * the built-in catalogue has no reasoning metadata for it */
	{ id: 'step-3.7-flash', contextWindow: 256000 },
	/* enabled, and never switched off: a spelling test needs a dict that was not
	 * discarded by a switch-off (switching off writes false, and the spellings go
	 * with it — only the checked levels are remembered, not how they were spelled) */
	{ id: 'spelling-model', contextWindow: 128000, reasoningEfforts: { high: 'weird-wire', low: 'low' } },
];
const namespaces = [
	{
		ns: 'llm-pi-ai',
		revision: 1,
		user: { providers: { routeA: { models: routeAModels } } },
		value: { providers: {
			routeA: { api: 'openai-completions', baseURL: 'https://example.test/v1', models: routeAModels },
			// catalogue-inherited route: no user layer, an empty modality list
			routeB: { api: 'openai-completions', models: [{ id: 'catalog-model', input: [] }] },
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

const writes = [];
let failNext = null;
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const setIn = (root, path, value) => {
	let node = root;
	for (const key of path.slice(0, -1)) { if (!isRecord(node[key])) node[key] = {}; node = node[key]; }
	node[path.at(-1)] = value;
};
const api = {
	settings: {
		describe: async () => ({ result: { ok: true, value: { writable: true, hasDocument: true, namespaces } } }),
		/* Stateful: the write lands in the user layer, so the next render sees it. */
		mutate: async (request) => {
			if (failNext !== null) { const message = failNext; failNext = null; throw new Error(message); }
			writes.push(request);
			const ns = namespaces.find((candidate) => candidate.ns === request.ns);
			ns.user = isRecord(ns.user) ? ns.user : {};
			for (const op of request.ops) if (op.op === 'set') setIn(ns.user, op.path, op.value);
			ns.revision = (ns.revision ?? 0) + 1;
			return { result: { ok: true, value: { ...ns } } };
		},
	},
};

// ---- capture the slot registration ---------------------------------------
let slot;
const ctx = {
	get: (name) => (name === 'connection' ? { api } : undefined),
	slots: { inject: (name, cb) => { eq(name, 'settings.section', 'waits on the settings section slot'); cb(); }, register: (options, component) => { slot = { options, component }; } },
};
mod.apply(ctx);
eq(slot?.options?.name, 'settings.section', 'registers on the settings section slot');
eq(slot?.options?.id, 'model-capability');
eq(slot?.options?.order, 150);
eq(slot?.options?.label?.(), '模型能力');
const injected = slot.options.inject();
eq(injected.api, api, 'injects the connection api');

// ---- render helpers --------------------------------------------------------
hooks.states[0] = { status: 'ready', namespaces, writable: true };
const render = (extra = {}) => { hooks.cursor = 0; return slot.component({ ...injected, close: () => {}, ...extra }); };
const walk = (node, visit) => {
	if (Array.isArray(node)) { node.forEach((child) => walk(child, visit)); return; }
	if (node === null || typeof node !== 'object') return;
	visit(node);
	walk(node.children, visit);
};
const boxesIn = (tree) => { const found = []; walk(tree, (node) => { if (node.type === 'input') found.push(node); }); return found; };
const nodesWith = (tree, predicate) => { const found = []; walk(tree, (node) => { if (predicate(node)) found.push(node); }); return found; };
const lastWrite = () => writes.at(-1);
/** The feedback line each row currently shows, keyed by `ns|route|index`. */
const feedbackByKey = (tree2) => {
	const map = new Map();
	walk(tree2, (node) => { if (typeof node.props?.key === 'string' && node.props.key.endsWith('|feedback')) map.set(node.props.key, node); });
	return map;
};
const lineOf = (tree2, key) => feedbackByKey(tree2).get(key)?.children.join('');

const tree = render();
const boxes = boxesIn(tree);
const box = (kind, model, level) => boxes.find((candidate) => candidate.props['data-kind'] === kind
	&& candidate.props['data-model'] === model
	&& (level === undefined || candidate.props['data-level'] === level));
/** The model entry as it stands now, read back out of the user layer. */
const modelOf = (model) => namespaces
	.find((candidate) => candidate.ns === 'llm-pi-ai')
	.user.providers.routeA.models.find((candidate) => candidate.id === model);
const masterOf = (tree2, model) => boxesIn(tree2)
	.find((candidate) => candidate.props['data-kind'] === 'reasoning-enabled' && candidate.props['data-model'] === model);
const stateOf = (model) => masterOf(render(), model).props['data-state'];
const levelsIn = (tree2, model) => boxesIn(tree2)
	.filter((candidate) => candidate.props['data-kind'] === 'reasoning-level' && candidate.props['data-model'] === model)
	.map((candidate) => candidate.props['data-level']);
const moreIn = (tree2, model) => nodesWith(tree2, (node) => node.props?.['data-role'] === 'more-levels' && node.props['data-model'] === model)[0];
const resetIn = (tree2, model) => nodesWith(tree2, (node) => node.props?.['data-role'] === 'reasoning-reset' && node.props['data-model'] === model)[0];
/** Drive the master switch, then re-render so the stateful stub's answer shows. */
const setEnabled = async (model, on) => {
	await masterOf(render(), model).props.onChange({ target: { checked: on } });
	return render();
};
/** Drive one level checkbox of an enabled row. */
const setLevel = async (model, level, on) => {
	const target = boxesIn(render()).find((candidate) => candidate.props['data-kind'] === 'reasoning-level'
		&& candidate.props['data-model'] === model && candidate.props['data-level'] === level);
	await target.props.onChange({ target: { checked: on } });
	return render();
};
/**
 * Drive an image checkbox. Always looked up from a fresh render: the handlers of
 * a stale tree close over the entry as it was then, while the real UI re-renders
 * after every write, so a user always clicks the current one.
 */
const setImage = async (model, on) => {
	const target = boxesIn(render()).find((candidate) => candidate.props['data-kind'] === 'image'
		&& candidate.props['data-model'] === model);
	await target.props.onChange({ target: { checked: on } });
	return render();
};
/** Open the extras disclosure when it is collapsed — an extra level is only
 * rendered (and therefore only clickable) while it is open. */
const openMore = (model) => {
	const button = moreIn(render(), model);
	if (button !== undefined && button.props['data-open'] === 'false') button.props.onClick();
};

// ---- 1. the two capability families, and only those ----------------------
eq(boxes.filter((candidate) => candidate.props['data-kind'] === 'image').length, 9, 'one image toggle per model over both families');
eq(boxes.filter((candidate) => candidate.props['data-kind'] === 'compat').length, 0, 'the compat switches are gone entirely');
eq(levelsIn(tree, 'deepseek-flash').length, 0, 'the deepseek family gets no level checkboxes (that catalogue schema has no reasoningEfforts)');
eq(masterOf(tree, 'deepseek-flash'), undefined, 'and no master switch either');

// ---- 2. the three postures render differently ----------------------------
eq(stateOf('step-3.7-flash'), 'default', 'a model with no reasoningEfforts renders as undeclared');
eq(stateOf('no-choice-model'), 'disabled', 'reasoningEfforts: false renders as disabled');
eq(stateOf('glm-5.3-flash'), 'enabled', 'a dict renders as enabled');
eq(masterOf(tree, 'glm-5.3-flash').props.checked, true, 'enabled means the master switch is on');
eq(masterOf(tree, 'no-choice-model').props.checked, false, 'disabled means the master switch is off');
eq(masterOf(tree, 'step-3.7-flash').props.checked, false, 'undeclared starts off, so opening it is an explicit act');

deep(levelsIn(tree, 'glm-5.3-flash').sort(), ['high', 'low', 'medium', 'off'], 'an enabled row shows the four base levels');
eq(box('reasoning-level', 'glm-5.3-flash', 'high').props.checked, true, 'a declared level renders checked');
eq(levelsIn(tree, 'step-3.7-flash').length, 0, 'undeclared renders no level checkboxes - nothing is invented');
eq(levelsIn(tree, 'no-choice-model').length, 0, 'disabled renders no level checkboxes either');
deep(levelsIn(tree, 'full-model').sort(), ['high', 'low', 'max', 'medium', 'minimal', 'off', 'xhigh'], 'an enabled row that already sets an extra level renders all seven');
eq(moreIn(tree, 'full-model').props['data-open'], 'true', 'and its disclosure starts open');
eq(moreIn(tree, 'glm-5.3-flash').props['data-open'], 'false', 'a row without extras starts collapsed');

const defaultBadges = nodesWith(tree, (node) => node.children?.[0] === '默认');
eq(defaultBadges.length, 2, `one default badge per undeclared row (got ${defaultBadges.length})`);
eq(nodesWith(tree, (node) => typeof node.children?.[0] === 'string' && node.children[0].startsWith('由内置目录决定')).length, 0,
	'the catalogue explanation does not repeat on every card - it lives in the panel intro only');
eq(nodesWith(tree, (node) => node.children?.[0] === '已禁用').length, 1,
	'the disabled row carries the short 已禁用 label');
const disabledHints = nodesWith(tree, (node) => typeof node.children?.[0] === 'string' && node.children[0].includes('已禁用'));
eq(disabledHints.length, 1, 'the disabled row says the model offers no level choice');
eq(nodesWith(tree, (node) => node.props?.['data-role'] === 'reasoning-reset').length, 5, 'reset-to-default is offered on every declared row, enabled or disabled');
ok(resetIn(tree, 'glm-5.3-flash') !== undefined, 'an enabled row can be returned to the catalogue');
eq(resetIn(tree, 'step-3.7-flash'), undefined, 'an undeclared row has nothing to reset');

// ---- 3. the disclosure reveals the extras --------------------------------
moreIn(render(), 'glm-5.3-flash').props.onClick();
eq(levelsIn(render(), 'glm-5.3-flash').includes('xhigh'), true, 'after clicking the disclosure the extra levels render');
moreIn(render(), 'glm-5.3-flash').props.onClick();
eq(levelsIn(render(), 'glm-5.3-flash').includes('xhigh'), false, 'clicking again collapses them');

// ---- 4. opening the master switch from undeclared checks the four common levels
await setEnabled('step-3.7-flash', true);
deep(modelOf('step-3.7-flash').reasoningEfforts, { off: null, low: 'low', medium: 'medium', high: 'high' },
	'opening an undeclared model writes the four common levels');
eq(Object.is(modelOf('step-3.7-flash').reasoningEfforts.off, null), true, 'off is written as null, never as the string "off"');
eq(Object.keys(modelOf('step-3.7-flash').reasoningEfforts).join(','), 'off,low,medium,high', 'keys land in canonical escalation order');
eq(lastWrite().ops[0].path.join('.'), 'providers.routeA.models', 'the write is a whole-array set on the route');
eq(modelOf('step-3.7-flash').contextWindow, 256000, 'the hand-written contextWindow survives');
eq(stateOf('step-3.7-flash'), 'enabled', 'and the row now renders as enabled');
eq(levelsIn(render(), 'step-3.7-flash').length, 4, 'with its four level checkboxes');

// ---- 5. switching off writes false, and switching back on restores -------
await setEnabled('custom-wire-model', false);
eq(modelOf('custom-wire-model').reasoningEfforts, false, 'switching off writes false - "no level choice" - not an empty object');
eq(stateOf('custom-wire-model'), 'disabled', 'and the row renders as disabled');
eq(lastWrite().ops[0].value[2].contextWindow, 500000, 'the rest of the entry is untouched by the switch-off');
await setEnabled('custom-wire-model', true);
deep(modelOf('custom-wire-model').reasoningEfforts, { high: 'weird-wire' },
	'switching back on hands back the remembered dict verbatim — the hand-written spelling included');
eq(Object.keys(modelOf('custom-wire-model').reasoningEfforts).join(','), 'high', 'and only that level');

// ---- 6. reset-to-default deletes the field -------------------------------
eq(stateOf('no-choice-model'), 'disabled', 'the fixture starts disabled');
await resetIn(render(), 'no-choice-model').props.onClick();
eq(Object.prototype.hasOwnProperty.call(modelOf('no-choice-model'), 'reasoningEfforts'), false,
	'reset removes the key instead of writing another value');
eq(stateOf('no-choice-model'), 'default', 'and the row is back to undeclared, where the catalogue decides');
eq(resetIn(render(), 'no-choice-model'), undefined, 'with nothing left to reset');
await setEnabled('step-3.7-flash', false);
await resetIn(render(), 'step-3.7-flash').props.onClick();
eq(stateOf('step-3.7-flash'), 'default', 'a model that was switched off can also be returned to the catalogue');

// ---- 7. the switch round trip, then level edits: spellings survive both ----
await setEnabled('step-3.7-flash', true);
/* The fix this round exists for: switching a model off records the whole dict,
 * so switching it back on restores the spellings the user typed instead of
 * rebuilding the levels from their names. */
await setEnabled('spelling-model', false);
eq(modelOf('spelling-model').reasoningEfforts, false, 'switching off still writes false');
ok(lineOf(render(), 'llm-pi-ai|routeA|5|feedback').includes('原档位在本页会话内已记住'),
	'and the switch-off line says where the levels went (this page session only)');
await setEnabled('spelling-model', true);
deep(modelOf('spelling-model').reasoningEfforts, { low: 'low', high: 'weird-wire' },
	'switching back on restores the remembered dict verbatim — weird-wire survives the round trip');
eq(Object.keys(modelOf('spelling-model').reasoningEfforts).join(','), 'low,high', 'in canonical order');

await setLevel('glm-5.3-flash', 'low', false);
deep(modelOf('glm-5.3-flash').reasoningEfforts, { off: null, medium: 'medium', high: 'high' }, 'unchecking one level drops just that key');
openMore('spelling-model');
await setLevel('spelling-model', 'minimal', true);
deep(modelOf('spelling-model').reasoningEfforts, { minimal: 'minimal', low: 'low', high: 'weird-wire' },
	'a level that was already there keeps its weird-wire spelling, while a new one takes its own name');
eq(Object.keys(modelOf('spelling-model').reasoningEfforts).join(','), 'minimal,low,high', 'in canonical order');
await setLevel('spelling-model', 'high', false);
await setLevel('spelling-model', 'minimal', false);
await setLevel('spelling-model', 'low', false);
eq(modelOf('spelling-model').reasoningEfforts, false, 'clearing the last level writes false rather than an empty object');

// ---- 8. image regression -------------------------------------------------
await setImage('step-3.7-flash', true);
const imagePayload = lastWrite().ops[0].value[4];
eq(imagePayload.id, 'step-3.7-flash', 'the edited entry is the one that was clicked');
eq(imagePayload.contextWindow, 256000, 'image on keeps every hand-written field');
deep(imagePayload.reasoningEfforts, { off: null, low: 'low', medium: 'medium', high: 'high' }, 'including the reasoning dict this session wrote');
deep(imagePayload.input, ['text', 'image'], 'and adds the modality');
await setImage('deepseek-flash', false);
const dsWrite = lastWrite();
eq(dsWrite.ns, 'llm-deepseek');
deep(dsWrite.ops, [{ op: 'set', path: ['models'], value: [
	{ id: 'deepseek-flash', inputModalities: ['text'] },
	{ id: 'deepseek-v4-pro', inputModalities: ['text'] },
] }], 'deepseek image off clears the modality and the image budget fields the validator rejects');

// ---- 9. feedback: a level set, an explicit false, a deletion, an image ---
await setEnabled('step-3.7-flash', false);
eq(lineOf(render(), 'llm-pi-ai|routeA|4|feedback'),
	'已写入 llm-pi-ai.providers.routeA.models[4].reasoningEfforts = false（该模型不提供推理档位；原档位在本页会话内已记住，重载页面后需重新勾选）',
	'the switch-off line names the real route/index, says what false means, and admits the memory is page-session scoped');
await setEnabled('step-3.7-flash', true);
eq(lineOf(render(), 'llm-pi-ai|routeA|4|feedback'),
	'已写入 llm-pi-ai.providers.routeA.models[4].reasoningEfforts = {off, low, medium, high}',
	'the switch-on line lists the levels it wrote');
await resetIn(render(), 'step-3.7-flash').props.onClick();
eq(lineOf(render(), 'llm-pi-ai|routeA|4|feedback'),
	'已删除 llm-pi-ai.providers.routeA.models[4].reasoningEfforts（回到内置目录默认）',
	'reset reports a deletion, not a value');
await setImage('step-3.7-flash', false);
eq(lineOf(render(), 'llm-pi-ai|routeA|4|feedback'),
	'已写入 llm-pi-ai.providers.routeA.models[4].input（字段已删除，回落默认纯文本）',
	'image off reports the deleted field, not a value');
await setImage('deepseek-flash', false);
eq(lineOf(render(), 'llm-deepseek||0|feedback'),
	'已写入 llm-deepseek.models[0].inputModalities（字段已删除，回落默认纯文本）',
	'the deepseek family reports llm-deepseek.models[i], not the pi-ai route shape');

// ---- 10. pending locks every control; a refusal is shown verbatim --------
const inFlight = masterOf(render(), 'full-model').props.onChange({ target: { checked: false } });
const midTree = render();
eq(feedbackByKey(midTree).get('llm-pi-ai|routeA|1|feedback')?.props['data-feedback'], 'pending', 'the clicked row shows a pending line while the write is in flight');
ok(boxesIn(midTree).every((candidate) => candidate.props.disabled === true), 'every control is disabled while a write is in flight');
await inFlight;
eq(feedbackByKey(render()).get('llm-pi-ai|routeA|1|feedback')?.props['data-feedback'], 'ok', 'and the row reports success once it lands');

const hostRefusal = 'llm-pi-ai: provider "routeA" model "full-model" sets reasoningEfforts "nonsense", which the schema does not accept';
failNext = hostRefusal;
await masterOf(render(), 'full-model').props.onChange({ target: { checked: false } });
const refusalNode = feedbackByKey(render()).get('llm-pi-ai|routeA|1|feedback');
eq(refusalNode?.props['data-feedback'], 'error', 'a refusal shows an error line on that row instead of a success line');
ok(refusalNode?.children.join('').includes(hostRefusal), 'the host\'s original validation text is shown verbatim');
ok(refusalNode?.children.join('').startsWith('写入被拒绝，宿主原文：'), 'and is labelled as the host refusal, not a bare "save failed"');
ok(!refusalNode?.children.join('').includes('已写入'), 'a refused write never claims to have written anything');
ok(boxesIn(render()).every((candidate) => candidate.props.disabled === false), 'the controls come back unlocked after a refusal');

// ---- 11. the success line clears itself ----------------------------------
const shortTtl = { feedbackTtlMs: 15 };
await masterOf(render(shortTtl), 'glm-5.3-flash').props.onChange({ target: { checked: false } });
ok(feedbackByKey(render(shortTtl)).has('llm-pi-ai|routeA|0|feedback'), 'the success line is on screen right after the write');
await new Promise((resolve) => setTimeout(resolve, 80));
eq(feedbackByKey(render(shortTtl)).has('llm-pi-ai|routeA|0|feedback'), false, 'and clears itself shortly after');
eq(feedbackByKey(render(shortTtl)).get('llm-pi-ai|routeA|1|feedback')?.props['data-feedback'], 'error', 'while a refusal stays put until the next write');

const rendered = JSON.stringify(render());
ok(rendered.includes('模型能力'), 'renders the panel title');
ok(rendered.includes('严格 JSON') === false, 'the strict-JSON copy is gone');

const images = boxes.filter((candidate) => candidate.props['data-kind'] === 'image').length;
const masters = boxes.filter((candidate) => candidate.props['data-kind'] === 'reasoning-enabled').length;
const levels = boxes.filter((candidate) => candidate.props['data-kind'] === 'reasoning-level').length;
console.log(`smoke: OK — first render ${boxes.length} controls (${images} image, ${masters} reasoning masters, ${levels} levels) over 6 pi-ai models + 2 deepseek models, ${writes.length} write payloads, ${checks} assertions`);
