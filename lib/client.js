/**
 * Model capability panel — browser half.
 *
 * Settings → 模型能力: one row per model, two capabilities:
 *
 *   · 输入 —— image input modality: `models[].input` for llm-pi-ai,
 *     `models[].inputModalities` for llm-deepseek;
 *   · 推理档位 —— whether this model offers a reasoning-level choice, written to
 *     `models[].reasoningEfforts` (llm-pi-ai only: the deepseek catalogue schema
 *     has no such field, so that family renders the image toggle alone).
 *
 * The reasoning field has three postures, and the panel shows all three rather
 * than pretending two of them are the same:
 *
 *   1. 未声明 — no `reasoningEfforts` key. The level set then comes from the
 *      built-in catalogue, which the browser cannot read; a model the catalogue
 *      has no reasoning metadata for simply offers no level picker in the chat
 *      UI. Shown as an unchecked master switch + 默认 badge, and it is the state
 *      恢复默认 returns to.
 *   2. 已启用 — the master switch is on and `reasoningEfforts` holds a dict of
 *      levels: off/low/medium/high shown outright, minimal/xhigh/max behind
 *      更多档位 (which starts open when the model already sets one of them).
 *   3. 已禁用 — `reasoningEfforts: false`, meaning "this model offers no level
 *      choice". Written by turning the master switch off.
 *
 * Turning the switch on from 未声明 checks the four common levels; from 已禁用 it
 * restores the levels that were checked when it was switched off, falling back to
 * the same four. A level's value is its own name, except `off`, whose YAML shape
 * is a valueless key and is therefore written as `null`. Clearing every level
 * writes `false` — "no choice" — rather than an empty object, and a wire spelling
 * already on the entry is never rewritten: only newly checked levels take the
 * default spelling.
 *
 * Registered on the root `settings.section` slot, the same seat the official
 * Models page uses — this plugin deliberately does NOT inject into the official
 * model form, because the `settings.models.model.fields` extension point that
 * once allowed it was removed in dsh 0.1.1+.
 *
 * Writes go through `settings.mutate` with whole-array `set` ops: the host's
 * `applyPathOp` descends into plain objects only, so a path that crosses an array
 * element is not addressable and would replace the array instead. Entries are
 * cloned field by field, so hand-written `contextWindow` / `input` values survive
 * every write — including the deletion 恢复默认 performs, which is a whole-array
 * write with that one key removed.
 *
 * Every toggle answers back: the row shows a pending line, then the settings path
 * it wrote (or deleted), or the host's own rejection text verbatim. A checkbox
 * that flips silently says nothing about whether the write was accepted.
 *
 * The id below must equal the package name: the client module route is
 * `/plugins/<package-name>/client.js` and every official bundle registers under
 * its own package name.
 *
 * @module dsh-model-capability-panel/client
 */
window.__ModuleLoader__.load({
	id: "dsh-model-capability-panel",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");
		const e = react.createElement;

		const TEXT = "text";
		const IMAGE = "image";
		const PI_NS = "llm-pi-ai";
		const DS_NS = "llm-deepseek";
		const IMAGE_LIST = [TEXT, IMAGE];

		/**
		 * Every level `reasoningEfforts` accepts as a key, in the escalation order
		 * the adapter declares them — the order this panel writes them in.
		 */
		const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

		/** The levels offered without opening the disclosure, and their labels. */
		const BASE_LEVELS = [
			{ level: "off", label: "关闭" },
			{ level: "low", label: "低" },
			{ level: "medium", label: "中" },
			{ level: "high", label: "高" }
		];

		/** The levels behind 更多档位. */
		const MORE_LEVELS = ["minimal", "xhigh", "max"];

		/**
		 * The levels switching the master switch on selects for a model that
		 * declared nothing — the shape the existing pi-ai routes already carry.
		 */
		const DEFAULT_LEVELS = BASE_LEVELS.map((entry) => entry.level);

		/**
		 * `off` is the one level whose YAML shape is a valueless key, so it is
		 * the one level written as `null` instead of its own name.
		 */
		const VALUELESS_LEVEL = "off";

		/**
		 * The whole `reasoningEfforts` dict per row as it stood when its master
		 * switch was turned off — level to wire spelling, `off: null` included.
		 *
		 * The dict, not a list of level names: a hand-written spelling such as
		 * `high: "something-else"` is configuration the user typed, and switching
		 * the model off and on again must hand it back rather than quietly
		 * replace it with the default spelling. Module scope on purpose: this is a
		 * UI memory of the last answer, not part of the settings document, so it
		 * dies with the page — which is why the switch-off line says so.
		 */
		const lastEnabledDicts = new Map();

		const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
		const asRecord = (value) => (isRecord(value) ? value : undefined);
		const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
		const messageOf = (error) => (error instanceof Error ? error.message : String(error));
		const imageDeclared = (list) => Array.isArray(list) && list.includes(IMAGE);
		const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

		/** Fold the RPC envelope into its value, or throw the reported failure. */
		function unwrap(response) {
			const result = asRecord(response) ? asRecord(response.result) : undefined;
			if (result === undefined) return response;
			if (result.ok === false) throw new Error(asRecord(result.error)?.message ?? "settings RPC 失败");
			return result.value;
		}

		/** The modality list one model currently declares, in this namespace's own field name. */
		function declaredOf(model, field) {
			const entry = asRecord(model);
			if (entry === undefined) return undefined;
			return field === "input" ? entry.input : entry.inputModalities;
		}

		/**
		 * Which of the three postures a model's `reasoningEfforts` is in, and the
		 * levels it holds when it is enabled.
		 *
		 * Absent, `false` and a dict are three different answers and the panel
		 * keeps them apart: absent means the catalogue decides, `false` means the
		 * model offers no choice, a dict means exactly those levels.
		 * @param model - the model entry.
		 * @returns `{ state, levels }` where state is `default`, `disabled` or
		 *   `enabled`, and levels are in canonical write order.
		 */
		function reasoningOf(model) {
			const own = asRecord(model)?.reasoningEfforts;
			if (own === undefined) return { state: "default", levels: [] };
			if (own === false) return { state: "disabled", levels: [] };
			const record = asRecord(own) ?? {};
			return { state: "enabled", levels: THINKING_LEVELS.filter((level) => hasOwn(record, level)) };
		}

		/** Three image postures, because "undeclared" is not "text-only". */
		function statusOf(declared) {
			if (imageDeclared(declared)) return { text: "读图", tone: "on" };
			if (Array.isArray(declared) && declared.length > 0) return { text: "仅文本（显式）", tone: "off" };
			return { text: "未声明", tone: "inherit" };
		}

		/**
		 * A clone of a levels dict in canonical write order, values untouched.
		 *
		 * This is the one place a dict is rebuilt, so every path that hands a dict
		 * back to the document — a fresh enable, a remembered restore, a single
		 * level toggle — keeps whatever wire spelling each level already carried.
		 * @param source - the levels as they stand.
		 * @returns a new dict with the same entries, canonically ordered.
		 */
		function orderLevels(source) {
			const record = asRecord(source) ?? {};
			const ordered = {};
			for (const level of THINKING_LEVELS) if (hasOwn(record, level)) ordered[level] = record[level];
			return ordered;
		}

		/** The default dict a fresh enable writes: every requested level under its own name. */
		function withDefaultSpellings(levels) {
			const source = {};
			for (const level of levels) source[level] = level === VALUELESS_LEVEL ? null : level;
			return orderLevels(source);
		}

		/**
		 * The dict one level toggle produces, in canonical key order.
		 *
		 * Existing keys keep whatever wire spelling they already carry — a model
		 * written as `high: "something-else"` stays that way; only a newly checked
		 * level acquires the default spelling.
		 * @param entry - the model entry as it is now.
		 * @param edit - `{ level, enabled }`.
		 * @returns the ordered levels dict, possibly empty.
		 */
		function levelsAfter(entry, edit) {
			const source = { ...orderLevels(asRecord(entry)?.reasoningEfforts) };
			if (edit.enabled) source[edit.level] = edit.level === VALUELESS_LEVEL ? null : edit.level;
			else delete source[edit.level];
			return orderLevels(source);
		}

		/** Drop a modality list that states no answer, so persisting it would only be noise. */
		function normalize(models) {
			return models.map((model) => {
				if (!isRecord(model)) return model;
				const next = { ...model };
				if (Array.isArray(next.input) && next.input.length === 0) delete next.input;
				if (Array.isArray(next.inputModalities) && next.inputModalities.length === 0) delete next.inputModalities;
				return next;
			});
		}

		/**
		 * The new models array for one edit. Entries are cloned verbatim so every
		 * field the user hand-wrote survives the whole-array write.
		 * @param row - the route row owning the model.
		 * @param field - `input` (pi-ai) or `inputModalities` (deepseek).
		 * @param index - model index inside the row.
		 * @param edit - one of `{ kind: "image", enabled }`,
		 *   `{ kind: "reasoning-on", levels }`, `{ kind: "reasoning-off" }`,
		 *   `{ kind: "reasoning-reset" }`, `{ kind: "reasoning-level", level, enabled }`.
		 * @returns the replacement array.
		 */
		function applyModelEdit(row, field, index, edit) {
			const models = clone(row.models);
			const entry = models[index];
			if (!isRecord(entry)) throw new Error("模型条目不可写");

			if (edit.kind === "reasoning-on") {
				/* `levels` is a whole dict — a remembered one is handed back with
				 * its spellings intact, and only a fresh enable carries defaults. */
				const levels = orderLevels(edit.levels);
				entry.reasoningEfforts = Object.keys(levels).length === 0 ? false : levels;
				return normalize(models);
			}
			if (edit.kind === "reasoning-off") {
				entry.reasoningEfforts = false;
				return normalize(models);
			}
			if (edit.kind === "reasoning-reset") {
				/* The only way back to 未声明: the key goes away, so the resolved
				 * level set is the catalogue's answer again. */
				delete entry.reasoningEfforts;
				return normalize(models);
			}
			if (edit.kind === "reasoning-level") {
				const levels = levelsAfter(entry, edit);
				/* No key left means "no choice", which the schema spells `false`;
				 * an empty object would state nothing at all. */
				entry.reasoningEfforts = Object.keys(levels).length === 0 ? false : levels;
				return normalize(models);
			}

			if (field === "input") {
				if (edit.enabled) entry.input = [...IMAGE_LIST];
				else delete entry.input;
			} else if (edit.enabled) {
				entry.inputModalities = [...IMAGE_LIST];
			} else {
				entry.inputModalities = [TEXT];
				delete entry.imagePixelBudget;
				delete entry.imageMaxBytes;
				delete entry.imageDetail;
			}
			return normalize(models);
		}

		/** Group the toggleable models of both adapter families out of one describe answer. */
		function collectGroups(namespaces) {
			const groups = [];
			const list = Array.isArray(namespaces) ? namespaces : [];

			const pi = list.find((view) => view?.ns === PI_NS);
			if (pi !== undefined) {
				const userProviders = asRecord(asRecord(pi.user)?.providers) ?? {};
				const valueProviders = asRecord(asRecord(pi.value)?.providers) ?? {};
				const routes = [...new Set([...Object.keys(valueProviders), ...Object.keys(userProviders)])].sort();
				const rows = [];
				for (const route of routes) {
					const value = asRecord(valueProviders[route]);
					const user = asRecord(userProviders[route]);
					const userModels = Array.isArray(user?.models) ? user.models : undefined;
					const valueModels = Array.isArray(value?.models) ? value.models : undefined;
					const models = userModels ?? valueModels;
					if (models === undefined || models.length === 0) continue;
					rows.push({
						route,
						models,
						fromUser: userModels !== undefined,
						baseURL: typeof value?.baseURL === "string" ? value.baseURL : undefined,
						api: typeof value?.api === "string" ? value.api : undefined
					});
				}
				if (rows.length > 0) {
					groups.push({
						ns: PI_NS,
						title: "pi-ai 路由 · llm-pi-ai.providers.<route>.models[].input / .reasoningEfforts",
						field: "input",
						/* The pi-ai model schema carries reasoningEfforts; the deepseek
						 * catalogue schema does not, so only this group renders it. */
						reasoning: true,
						pathOf: (route) => ["providers", route, "models"],
						rows,
						revision: pi.revision,
						writable: true
					});
				}
			}

			const deepseek = list.find((view) => view?.ns === DS_NS);
			if (deepseek !== undefined) {
				const userModels = Array.isArray(asRecord(deepseek.user)?.models) ? asRecord(deepseek.user).models : undefined;
				const valueModels = Array.isArray(asRecord(deepseek.value)?.models) ? asRecord(deepseek.value).models : undefined;
				const models = userModels ?? valueModels;
				if (models !== undefined && models.length > 0) {
					groups.push({
						ns: DS_NS,
						title: "DeepSeek 官方目录 · llm-deepseek.models[].inputModalities",
						field: "inputModalities",
						reasoning: false,
						pathOf: () => ["models"],
						rows: [{ route: "", models, fromUser: userModels !== undefined }],
						revision: deepseek.revision,
						writable: true
					});
				}
			}

			return groups;
		}

		const panelStyle = {
			display: "flex",
			flexDirection: "column",
			gap: "12px",
			maxWidth: "860px",
			color: "var(--dsw-alias-label-primary, #1f2328)"
		};
		const titleStyle = { margin: 0, fontSize: "16px", fontWeight: 500, lineHeight: "24px" };
		const introStyle = { margin: 0, fontSize: "13px", lineHeight: "20px", color: "var(--dsw-alias-label-tertiary, #6b7280)" };
		const failureStyle = { margin: 0, fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-state-error-primary, #c43333)" };
		/* The per-row answer: quiet when it worked, the host's own words when it did not. */
		const feedbackOkStyle = { margin: 0, fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-state-success-primary, #128a47)" };
		const feedbackErrorStyle = { margin: 0, fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-state-error-primary, #c43333)", whiteSpace: "pre-wrap" };
		const groupStyle = { display: "flex", flexDirection: "column", gap: "8px" };
		const groupTitleStyle = { margin: 0, fontSize: "13px", fontWeight: 600, lineHeight: "20px" };
		const cardStyle = {
			border: "1px solid var(--dsw-alias-border-l2, #e3e5e8)",
			borderRadius: "12px",
			padding: "10px 12px",
			display: "flex",
			flexDirection: "column",
			gap: "6px"
		};
		const routeStyle = { fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-label-tertiary, #6b7280)" };
		const modelRowStyle = {
			display: "flex",
			flexDirection: "column",
			gap: "4px",
			padding: "6px 0",
			borderTop: "1px solid var(--dsw-alias-border-l2, #e3e5e8)"
		};
		const modelHeadStyle = { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", fontSize: "13px", lineHeight: "22px" };
		/* One labelled strip per capability: the label column keeps the controls of
		 * every row aligned with each other. */
		const stripStyle = { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", paddingLeft: "2px" };
		const stripLabelStyle = {
			flex: "0 0 56px",
			fontSize: "12px",
			lineHeight: "18px",
			color: "var(--dsw-alias-label-tertiary, #6b7280)",
			whiteSpace: "nowrap"
		};
		const toggleStyle = {
			display: "inline-flex",
			alignItems: "center",
			gap: "4px",
			fontSize: "12px",
			lineHeight: "18px",
			cursor: "pointer",
			whiteSpace: "nowrap"
		};
		const moreButtonStyle = {
			boxSizing: "border-box",
			border: "none",
			background: "transparent",
			padding: "0 2px",
			font: "inherit",
			fontSize: "12px",
			lineHeight: "18px",
			color: "var(--dsw-alias-label-tertiary, #6b7280)",
			cursor: "pointer",
			textDecoration: "underline dotted"
		};
		const resetButtonStyle = {
			boxSizing: "border-box",
			border: "1px solid var(--dsw-alias-border-l3, #d0d3d7)",
			borderRadius: "10px",
			background: "transparent",
			padding: "0 8px",
			font: "inherit",
			fontSize: "11px",
			lineHeight: "18px",
			color: "var(--dsw-alias-label-secondary, #4b5563)",
			cursor: "pointer",
			whiteSpace: "nowrap"
		};
		const idStyle = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" };
		const nameStyle = { color: "var(--dsw-alias-label-tertiary, #6b7280)", fontSize: "12px" };
		const hintStyle = { fontSize: "11px", lineHeight: "16px", color: "var(--dsw-alias-label-tertiary, #9aa1a9)" };
		const inheritBadgeStyle = {
			fontSize: "10px",
			lineHeight: "14px",
			padding: "0 4px",
			border: "1px solid var(--dsw-alias-border-l3, #d0d3d7)",
			borderRadius: "4px",
			color: "var(--dsw-alias-label-tertiary, #9aa1a9)"
		};
		const buttonStyle = {
			boxSizing: "border-box",
			alignSelf: "flex-start",
			height: "32px",
			padding: "0 14px",
			border: "1px solid var(--dsw-alias-border-l3, #d0d3d7)",
			borderRadius: "16px",
			background: "transparent",
			color: "inherit",
			font: "inherit",
			cursor: "pointer"
		};

		function badgeStyle(tone) {
			const color = tone === "on"
				? "var(--dsw-alias-state-success-primary, #128a47)"
				: tone === "off" ? "var(--dsw-alias-label-secondary, #4b5563)" : "var(--dsw-alias-label-tertiary, #9aa1a9)";
			return { marginLeft: "auto", fontSize: "11px", lineHeight: "16px", color };
		}

		/** How long a success line stays on screen before it clears itself. */
		const FEEDBACK_TTL_MS = 6000;

		/** Appended when an image write replaced an inherited value with an explicit one. */
		const INHERIT_NOTE = "（当前继承默认，本次写入已变为显式覆写）";

		/**
		 * The settings path one toggle writes, spelled the way settings.yaml
		 * stores it — real route and real model index, never a sample.
		 * @param group - the namespace group.
		 * @param row - the route row owning the model.
		 * @param index - the model's index inside the route's models list.
		 * @param suffix - the field or key below the model entry.
		 * @returns the dotted path.
		 */
		function writePath(group, row, index, suffix) {
			const prefix = group.field === "input"
				? `${group.ns}.providers.${row.route}.models[${index}]`
				: `${group.ns}.models[${index}]`;
			return `${prefix}.${suffix}`;
		}

		/**
		 * The success line for one write: what was written or deleted, and where.
		 *
		 * Stating the path is the point — otherwise a checkbox that silently flips
		 * says nothing about whether the host accepted it — and the three
		 * reasoning outcomes read differently because they mean different things:
		 * a level set, an explicit "no choice", and a return to the catalogue.
		 * @param group - the namespace group.
		 * @param row - the route row owning the model.
		 * @param index - the model's index inside the route's models list.
		 * @param edit - the edit that was submitted.
		 * @param entry - the model entry as it was before the write.
		 * @returns the line.
		 */
		function successText(group, row, index, edit, entry) {
			if (edit.kind === "reasoning-reset") {
				return `已删除 ${writePath(group, row, index, "reasoningEfforts")}（回到内置目录默认）`;
			}
			if (edit.kind === "reasoning-off") {
				/* Switching off discards the dict, so say where the levels went:
				 * they are remembered for this page session only, which is what
				 * makes switching back on restore them — and what makes a reload
				 * lose them. */
				return `已写入 ${writePath(group, row, index, "reasoningEfforts")} = false（该模型不提供推理档位；原档位在本页会话内已记住，重载页面后需重新勾选）`;
			}
			if (edit.kind === "reasoning-on" || edit.kind === "reasoning-level") {
				const levels = Object.keys(edit.kind === "reasoning-on"
					? orderLevels(edit.levels)
					: levelsAfter(entry, edit));
				const path = writePath(group, row, index, "reasoningEfforts");
				return levels.length === 0
					? `已写入 ${path} = false（该模型不提供推理档位）`
					: `已写入 ${path} = {${levels.join(", ")}}`;
			}
			const field = group.field === "input" ? "input" : "inputModalities";
			return edit.enabled
				? `已写入 ${writePath(group, row, index, field)} = ["text","image"]`
				: `已写入 ${writePath(group, row, index, field)}（字段已删除，回落默认纯文本）`;
		}

		/**
		 * Whether an image toggle had been showing a value the model did not
		 * declare itself. That is the case worth naming, because the write turns
		 * an inherited value into an explicit override. Reasoning states are shown
		 * on the row itself, so they need no note here.
		 * @param group - the namespace group.
		 * @param entry - the model entry.
		 * @param edit - the edit that was submitted.
		 * @returns true when the shown value was inherited.
		 */
		function imageWasInherited(group, entry, edit) {
			if (edit.kind !== "image") return false;
			return statusOf(declaredOf(entry, group.field)).tone === "inherit";
		}

		/** The settings page body. Injected face: `{ api }`. */
		function CapabilitySection(props) {
			const api = props.api;
			const [state, setState] = react.useState({ status: "loading" });
			const [pending, setPending] = react.useState(undefined);
			const [failure, setFailure] = react.useState(undefined);
			/* Per row: keyed by `ns|route|index`, because the answer belongs to the
			 * row the user just clicked, not to the page. */
			const [feedback, setFeedback] = react.useState({});
			/* Which rows had 更多档位 opened by hand. A row absent from this map
			 * falls back to "open when the model already sets an extra level", so a
			 * configured xhigh/max is never hidden behind a collapsed summary. */
			const [expanded, setExpanded] = react.useState({});
			/* `feedbackTtlMs` is a test seam: the smoke test shortens it so the
			 * self-clearing success line can be asserted without waiting. */
			const feedbackTtlMs = typeof props.feedbackTtlMs === "number" ? props.feedbackTtlMs : FEEDBACK_TTL_MS;

			const load = react.useCallback(() => {
				setState({ status: "loading" });
				Promise.resolve()
					.then(() => api.settings.describe({}))
					.then((response) => {
						const view = asRecord(unwrap(response));
						setState({
							status: "ready",
							namespaces: Array.isArray(view?.namespaces) ? view.namespaces : [],
							writable: view?.writable !== false
						});
					})
					.catch((error) => setState({ status: "failed", message: messageOf(error) }));
			}, [api]);

			react.useEffect(() => {
				load();
			}, [load]);

			/** Replace one row's feedback line. */
			const putFeedback = (rowKey, entry) => {
				setFeedback((previous) => ({ ...previous, [rowKey]: entry }));
			};

			/** Clear one row's line — only if it is still the success it was set to. */
			const clearFeedback = (rowKey) => {
				setFeedback((previous) => {
					if (previous[rowKey]?.tone !== "ok") return previous;
					const next = { ...previous };
					delete next[rowKey];
					return next;
				});
			};

			const submit = (group, row, index, edit, label, entry) => {
				const rowKey = `${group.ns}|${row.route}|${String(index)}`;
				const key = `${rowKey}|${edit.kind === "image" ? "image"
					: edit.kind === "reasoning-level" ? `level:${edit.level}`
						: edit.kind}`;
				setPending(key);
				setFailure(undefined);
				putFeedback(rowKey, { tone: "pending", text: `${label}写入中…` });
				/* Returned so a caller (and the smoke test) can await the write. */
				return Promise.resolve()
					.then(() => {
						const models = applyModelEdit(row, group.field, index, edit);
						return api.settings.mutate({
							ns: group.ns,
							ops: [{ op: "set", path: group.pathOf(row.route), value: models }],
							expectedRevision: group.revision
						});
					})
					.then((response) => {
						const view = asRecord(unwrap(response));
						setState((previous) => previous.status !== "ready" ? previous : {
							...previous,
							namespaces: previous.namespaces.map((entry2) => (entry2?.ns === view?.ns ? view : entry2))
						});
						/* Remember the whole dict switching off gave up — spellings
						 * included — so switching back on hands it over unchanged
						 * instead of rebuilding it from level names. */
						if (edit.kind === "reasoning-off") {
							const given = orderLevels(asRecord(entry)?.reasoningEfforts);
							if (Object.keys(given).length > 0) lastEnabledDicts.set(rowKey, given);
						}
						if (edit.kind === "reasoning-on") lastEnabledDicts.set(rowKey, orderLevels(edit.levels));
						if (edit.kind === "reasoning-level") {
							const levels = levelsAfter(entry, edit);
							if (Object.keys(levels).length === 0) lastEnabledDicts.delete(rowKey);
							else lastEnabledDicts.set(rowKey, levels);
						}
						if (edit.kind === "reasoning-reset") lastEnabledDicts.delete(rowKey);
						putFeedback(rowKey, {
							tone: "ok",
							text: `${successText(group, row, index, edit, entry)}${imageWasInherited(group, entry, edit) ? INHERIT_NOTE : ""}`
						});
						const timer = setTimeout(() => clearFeedback(rowKey), feedbackTtlMs);
						if (typeof timer?.unref === "function") timer.unref();
					})
					.catch((error) => {
						/* The host's own words: a validation refusal names the route,
						 * the model and the field it would not take. "保存失败" would
						 * throw away the only part that says what to change. */
						putFeedback(rowKey, { tone: "error", text: `写入被拒绝，宿主原文：${messageOf(error)}` });
					})
					.then(() => setPending(undefined));
			};

			if (state.status === "loading") return e("div", { style: panelStyle }, e("p", { style: introStyle }, "读取设置中…"));
			if (state.status === "failed") {
				return e("div", { style: panelStyle },
					e("h2", { style: titleStyle }, "模型能力"),
					e("p", { style: failureStyle }, `读取失败：${state.message}`),
					e("button", { type: "button", style: buttonStyle, onClick: load }, "重试"));
			}

			const groups = collectGroups(state.namespaces);
			const disabled = pending !== undefined || state.writable === false;
			const children = [
				e("h2", { key: "title", style: titleStyle }, "模型能力"),
				e("p", { key: "intro", style: introStyle },
					"每个模型一行，改动即写入 settings.yaml。「输入」= 模态字段：pi-ai 路由写 models[].input，DeepSeek 官方目录写 models[].inputModalities；取消勾选删除字段。「推理档位」= 该模型是否提供推理档位选择（models[].reasoningEfforts）：未声明时由内置目录决定，目录里没有推理元数据的模型在聊天界面就不提供档位；打开开关即声明档位集合（默认 off/low/medium/high，可增删，minimal/xhigh/max 在「更多档位」里），关闭开关写 false 表示该模型不提供档位，两者都用「恢复默认」删掉该字段、交回内置目录。off 档位写空值，其余写档位名；原有的自定义取值不会被改写。"),
				e("button", { key: "refresh", type: "button", style: buttonStyle, disabled: pending !== undefined, onClick: load }, "重新读取设置")
			];
			if (failure !== undefined) children.push(e("p", { key: "failure", style: failureStyle }, failure));
			if (state.writable === false) children.push(e("p", { key: "readonly", style: failureStyle }, "当前设置提供方是只读的，无法写入。"));

			if (groups.length === 0) children.push(e("p", { key: "empty", style: introStyle }, "没有找到声明了 models 列表的 provider。"));

			for (const group of groups) {
				const routeCards = group.rows.map((row) => {
					const rows = row.models.map((model, index) => {
						const entry = asRecord(model);
						const declared = declaredOf(model, group.field);
						const status = statusOf(declared);
						const base = `${group.ns}|${row.route}|${String(index)}`;
						const modelId = String(entry?.id ?? "(未命名)");

						const imagePending = pending === `${base}|image`;
						const imageStrip = e("div", { key: `${base}|strip-image`, style: stripStyle },
							e("span", { style: stripLabelStyle }, "输入"),
							e("label", { style: toggleStyle },
								e("input", {
									type: "checkbox",
									"data-kind": "image",
									"data-model": modelId,
									"data-route": row.route,
									checked: imageDeclared(declared),
									disabled,
									onChange: (event) => submit(group, row, index, { kind: "image", enabled: event.target.checked }, "图片", entry)
								}),
								e("span", null, "图片"),
								imagePending ? e("span", { style: inheritBadgeStyle }, "写入中") : null));

						const strips = [imageStrip];

						if (group.reasoning === true) {
							const reasoning = reasoningOf(entry);
							const enabled = reasoning.state === "enabled";
							const extrasSet = MORE_LEVELS.some((level) => reasoning.levels.includes(level));
							const open = hasOwn(expanded, base) ? expanded[base] === true : extrasSet;
							const masterPending = pending === `${base}|reasoning-on` || pending === `${base}|reasoning-off`;
							const controls = [
								e("label", { key: `${base}|enable`, style: toggleStyle },
									e("input", {
										type: "checkbox",
										"data-kind": "reasoning-enabled",
										"data-model": modelId,
										"data-route": row.route,
										"data-state": reasoning.state,
										checked: enabled,
										disabled,
										onChange: (event) => {
											/* Both branches return the submit promise: a caller
											 * (and the smoke test) has to be able to await the
											 * write, and the switch-off arm records the level set
											 * the switch-on arm later restores. */
											if (!event.target.checked) {
												return submit(group, row, index, { kind: "reasoning-off" }, "推理档位", entry);
											}
											/* A model switched off earlier in this page
											 * session gets its dict back verbatim — the
											 * remembered one carries the spellings the user
											 * wrote. Anything else starts from the four
											 * common levels. */
											const remembered = lastEnabledDicts.get(base);
											const levels = reasoning.state === "disabled" && Object.keys(orderLevels(remembered)).length > 0
												? orderLevels(remembered)
												: withDefaultSpellings(DEFAULT_LEVELS);
											return submit(group, row, index, { kind: "reasoning-on", levels }, "推理档位", entry);
										}
									}),
									e("span", null, "启用"),
									masterPending ? e("span", { style: inheritBadgeStyle }, "写入中") : null)
							];

							if (enabled) {
								const levelBox = ({ level, label }) => {
									const levelPending = pending === `${base}|level:${level}`;
									return e("label", { key: `${base}|reason|${level}`, style: toggleStyle },
										e("input", {
											type: "checkbox",
											"data-kind": "reasoning-level",
											"data-level": level,
											"data-model": modelId,
											"data-route": row.route,
											checked: reasoning.levels.includes(level),
											disabled,
											onChange: (event) => submit(group, row, index, { kind: "reasoning-level", level, enabled: event.target.checked }, label, entry)
										}),
										e("span", null, label),
										levelPending ? e("span", { style: inheritBadgeStyle }, "写入中") : null);
								};
								for (const level of BASE_LEVELS) controls.push(levelBox(level));
								controls.push(e("button", {
									key: `${base}|more`,
									type: "button",
									"data-role": "more-levels",
									"data-model": modelId,
									"data-open": open ? "true" : "false",
									style: moreButtonStyle,
									disabled,
									onClick: () => setExpanded((previous) => ({ ...previous, [base]: !open }))
								}, open ? "收起档位 ▴" : "更多档位 ▾"));
								if (open) for (const level of MORE_LEVELS) controls.push(levelBox({ level, label: level }));
							}

							if (reasoning.state === "default") {
								controls.push(e("span", { key: `${base}|badge`, style: inheritBadgeStyle }, "默认"));
								controls.push(e("span", { key: `${base}|hint`, style: hintStyle },
									"由内置目录决定；目录里没有该模型的推理元数据时，聊天界面就不提供档位"));
							}
							if (reasoning.state === "disabled") {
								controls.push(e("span", { key: `${base}|hint`, style: hintStyle }, "已禁用：该模型不提供档位选择"));
							}
							if (reasoning.state !== "default") {
								const resetPending = pending === `${base}|reasoning-reset`;
								controls.push(e("button", {
									key: `${base}|reset`,
									type: "button",
									"data-role": "reasoning-reset",
									"data-model": modelId,
									style: resetButtonStyle,
									disabled,
									onClick: () => submit(group, row, index, { kind: "reasoning-reset" }, "恢复默认", entry)
								}, resetPending ? "恢复中…" : "恢复默认"));
							}

							strips.push(e("div", { key: `${base}|strip-reasoning`, style: stripStyle },
								e("span", { style: stripLabelStyle }, "推理档位"),
								...controls));
						}

						const rowFeedback = feedback[base];
						return e("div", { key: `${base}|row`, style: modelRowStyle },
							e("div", { style: modelHeadStyle },
								e("span", { style: idStyle }, modelId),
								entry?.name !== undefined && String(entry.name) !== modelId
									? e("span", { style: nameStyle }, String(entry.name)) : null,
								e("span", { style: badgeStyle(status.tone) }, status.text)),
							...strips,
							rowFeedback === undefined ? null : e("p", {
								key: `${base}|feedback`,
								"data-feedback": rowFeedback.tone,
								style: rowFeedback.tone === "error" ? feedbackErrorStyle : feedbackOkStyle
							}, rowFeedback.text));
					});
					return e("div", { key: `${group.ns}|${row.route}|card`, style: cardStyle },
						e("div", { style: routeStyle },
							`${row.route === "" ? group.ns : row.route}${row.api === undefined ? "" : ` · ${row.api}`}${row.baseURL === undefined ? "" : ` · ${row.baseURL}`}${row.fromUser ? "" : " · 目录继承（首次写入会物化到用户层）"}`),
						...rows);
				});
				children.push(e("div", { key: `${group.ns}|group`, style: groupStyle },
					e("h3", { style: groupTitleStyle }, group.title),
					...routeCards));
			}

			return e("div", { style: panelStyle }, ...children);
		}

		/**
		 * Required client services. `settings.section` is declared by the settings
		 * shell, so registration waits on that slot through `slots.inject()`.
		 */
		const inject = ["slots", "connection"];

		/**
		 * Register the panel as one Settings page.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			const connection = ctx.get("connection");
			const injected = () => ({ api: connection.api });
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "model-capability",
				order: 150,
				label: () => "模型能力",
				inject: injected
			}, CapabilitySection));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
