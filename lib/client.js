/**
 * Model capability panel — browser half.
 *
 * Settings → 模型能力: one row per model. The row's left side names the model and
 * its declared image posture; the right side carries the toggles that write the
 * capability fields the runtime actually enforces:
 *
 *   · image input — `models[].input` for llm-pi-ai, `models[].inputModalities`
 *     for llm-deepseek;
 *   · strict JSON — the one compat switch this build offers, written under the
 *     key the route's own protocol takes (`supportsStrictMode` for the
 *     openai-* and bedrock protocols, `supportsStrictTools` for
 *     anthropic-messages); a protocol with no compat gate renders no switch,
 *     because the host refuses a field the protocol does not offer;
 *   · leftovers — any other boolean already sitting on a model's own `compat`,
 *     rendered under its raw key name so nothing configured is unreachable.
 *
 * Compat switches are written as explicit booleans: unchecking states "this
 * model does not support it" and does not delete the key — most of these
 * default to true in the catalogue, so a deleted key would read as true again.
 *
 * A toggle shows the value that is actually in force (`model.compat[key]` ??
 * route `compat[key]` ?? false); when the value comes from the route rather than
 * from the model's own entry, a light 默认 badge marks the difference. The panel
 * never writes route-level compat — that is a separate surface.
 *
 * Registered on the root `settings.section` slot, the same seat the official
 * Models page uses — this plugin deliberately does NOT inject into the official
 * model form, because the `settings.models.model.fields` extension point that
 * once allowed it was removed in dsh 0.1.1+.
 *
 * Writes go through `settings.mutate` with whole-array `set` ops: the host's
 * `applyPathOp` descends into plain objects only, so a path that crosses an array
 * element is not addressable and would replace the array instead. Entries are
 * cloned field by field, so hand-written `contextWindow` / `reasoningEfforts`
 * survive every write.
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
		 * The strict-JSON switch each protocol actually takes.
		 *
		 * pi-ai gates compat by protocol: a field offered by one protocol is
		 * refused by another, and the host rejects the write naming the route,
		 * the model and the field. So the panel labels one cross-protocol
		 * capability and writes whichever key this route's `api` accepts.
		 * `openai-responses`, `azure-openai-responses` and
		 * `openai-codex-responses` share pi-ai's OpenAIResponsesCompat, so all
		 * three take `supportsStrictMode`; `bedrock-converse-stream` has a
		 * smaller gate that offers only that same field.
		 */
		const STRICT_KEY_BY_API = {
			"openai-completions": "supportsStrictMode",
			"openai-responses": "supportsStrictMode",
			"azure-openai-responses": "supportsStrictMode",
			"openai-codex-responses": "supportsStrictMode",
			"bedrock-converse-stream": "supportsStrictMode",
			"anthropic-messages": "supportsStrictTools"
		};

		/** One label across protocols; only the key written underneath differs. */
		const STRICT_LABEL = "严格 JSON";

		const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
		const asRecord = (value) => (isRecord(value) ? value : undefined);
		const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
		const messageOf = (error) => (error instanceof Error ? error.message : String(error));
		const imageDeclared = (list) => Array.isArray(list) && list.includes(IMAGE);

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
		 * The strict-JSON toggle a route's protocol takes, or `undefined` when it
		 * takes none. An unconfigured or unrecognised `api` yields `undefined`:
		 * the panel then renders no strict toggle rather than a checkbox whose
		 * write the host is guaranteed to refuse.
		 * @param api - the route's resolved wire protocol, when it declares one.
		 * @returns the toggle spec, or `undefined`.
		 */
		function strictSpecFor(api) {
			const key = typeof api === "string" ? STRICT_KEY_BY_API[api] : undefined;
			return key === undefined ? undefined : { key, label: STRICT_LABEL };
		}

		/**
		 * Compat keys this model already carries that the panel would otherwise
		 * not render — an earlier build's switches, or keys written by hand.
		 *
		 * Nothing configured may become invisible: every boolean already on the
		 * entry stays reachable, under its raw key name, so it can be turned back
		 * off without editing settings.yaml.
		 * @param entry - the model entry.
		 * @param strictKey - the key already rendered as the strict toggle.
		 * @returns the leftover keys, in declaration order.
		 */
		function leftoverCompatKeys(entry, strictKey) {
			const own = asRecord(asRecord(entry)?.compat);
			if (own === undefined) return [];
			return Object.keys(own).filter((key) => typeof own[key] === "boolean" && key !== strictKey);
		}

		/**
		 * Every compat toggle one model row renders, in display order: the
		 * protocol's strict switch first, then the leftovers.
		 * @param row - the route row owning the model.
		 * @param entry - the model entry.
		 * @returns the toggle specs.
		 */
		function compatSpecsFor(row, entry) {
			const strict = strictSpecFor(row?.api);
			const specs = strict === undefined ? [] : [strict];
			for (const key of leftoverCompatKeys(entry, strict?.key)) specs.push({ key, label: key });
			return specs;
		}

		/** Three postures the panel distinguishes, because "undeclared" is not "text-only". */
		function statusOf(declared) {
			if (imageDeclared(declared)) return { text: "读图", tone: "on" };
			if (Array.isArray(declared) && declared.length > 0) return { text: "仅文本（显式）", tone: "off" };
			return { text: "未声明", tone: "inherit" };
		}

		/**
		 * The compat value in force for one model, and where it came from.
		 * @param row - the route row owning the model (carries the route's own compat).
		 * @param model - the model entry.
		 * @param key - the compat key to read.
		 * @returns `{ value, source }` where source is `model`, `route` or `unknown`.
		 */
		function compatState(row, model, key) {
			const own = asRecord(asRecord(model)?.compat);
			if (own !== undefined && typeof own[key] === "boolean") return { value: own[key], source: "model" };
			const route = asRecord(row?.compat);
			if (route !== undefined && typeof route[key] === "boolean") return { value: route[key], source: "route" };
			return { value: false, source: "unknown" };
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
		 * @param edit - `{ kind: "image", enabled }` or `{ kind: "compat", key, enabled }`.
		 * @returns the replacement array.
		 */
		function applyModelEdit(row, field, index, edit) {
			const models = clone(row.models);
			const entry = models[index];
			if (!isRecord(entry)) throw new Error("模型条目不可写");

			if (edit.kind === "compat") {
				const compat = isRecord(entry.compat) ? { ...entry.compat } : {};
				/* Explicit boolean, never a delete: these switches mostly default to
				 * true, so an absent key would read as "supported" again. */
				compat[edit.key] = edit.enabled === true;
				entry.compat = compat;
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
						api: typeof value?.api === "string" ? value.api : undefined,
						compat: asRecord(value?.compat)
					});
				}
				if (rows.length > 0) {
					groups.push({
						ns: PI_NS,
						title: "pi-ai 路由 · llm-pi-ai.providers.<route>.models[].input / .compat",
						field: "input",
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
		const noticeStyle = { margin: 0, fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-state-success-primary, #128a47)" };
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
		const toggleBarStyle = { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", paddingLeft: "2px" };
		const toggleStyle = {
			display: "inline-flex",
			alignItems: "center",
			gap: "4px",
			fontSize: "12px",
			lineHeight: "18px",
			cursor: "pointer",
			whiteSpace: "nowrap"
		};
		const idStyle = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" };
		const nameStyle = { color: "var(--dsw-alias-label-tertiary, #6b7280)", fontSize: "12px" };
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

		/** Appended when the write replaced an inherited value with an explicit one. */
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
		 * The success line for one write: what was written and where. Stating the
		 * path is the point — otherwise a checkbox that silently flips says
		 * nothing about whether the host accepted it.
		 * @param group - the namespace group.
		 * @param row - the route row owning the model.
		 * @param index - the model's index inside the route's models list.
		 * @param edit - the edit that was submitted.
		 * @returns the line.
		 */
		function successText(group, row, index, edit) {
			if (edit.kind === "compat") {
				return `已写入 ${writePath(group, row, index, `compat.${edit.key}`)} = ${edit.enabled === true}`;
			}
			const field = group.field === "input" ? "input" : "inputModalities";
			return edit.enabled
				? `已写入 ${writePath(group, row, index, field)} = ["text","image"]`
				: `已写入 ${writePath(group, row, index, field)}（字段已删除，回落默认纯文本）`;
		}

		/**
		 * Whether the toggle had been showing a value the model did not declare
		 * itself — a route or catalogue default. That is the case worth naming,
		 * because the write turns an inherited value into an explicit override.
		 * @param group - the namespace group.
		 * @param row - the route row owning the model.
		 * @param entry - the model entry.
		 * @param edit - the edit that was submitted.
		 * @returns true when the shown value was inherited.
		 */
		function isInherited(group, row, entry, edit) {
			if (edit.kind === "compat") return compatState(row, entry, edit.key).source !== "model";
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

			const submit = (group, row, index, edit, modelId, label, entry) => {
				const key = `${group.ns}|${row.route}|${String(index)}|${edit.kind === "compat" ? edit.key : "image"}`;
				const rowKey = `${group.ns}|${row.route}|${String(index)}`;
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
						const inherited = isInherited(group, row, entry, edit);
						putFeedback(rowKey, {
							tone: "ok",
							text: `${successText(group, row, index, edit)}${inherited ? INHERIT_NOTE : ""}`
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
					"每个模型一行，右侧勾选写入 settings.yaml。图片 = 模态字段（pi-ai 写 models[].input，DeepSeek 官方目录写 models[].inputModalities）。严格 JSON = compat 开关，按该路由的协议写对应的键：openai-completions / openai-responses / azure / codex / bedrock 写 supportsStrictMode，anthropic-messages 写 supportsStrictTools；只列出该协议真正接受的开关，否则会被宿主拒绝，所以协议没有 compat 的路由不会出现这个勾选框。取消勾选写显式 false，不是删字段（多数开关默认 true，删了会又变回支持）。模型 compat 里已有的其他键也会列出，用原始键名——配过的东西界面上一定能取消。标了「默认」的勾选状态来自供应商级 compat，不是该模型自己声明的。"),
				e("button", { key: "refresh", type: "button", style: buttonStyle, disabled: pending !== undefined, onClick: load }, "重新读取设置")
			];
			if (failure !== undefined) children.push(e("p", { key: "failure", style: failureStyle }, failure));
			if (state.writable === false) children.push(e("p", { key: "readonly", style: failureStyle }, "当前设置提供方是只读的，无法写入。"));

			if (groups.length === 0) children.push(e("p", { key: "empty", style: introStyle }, "没有找到声明了 models 列表的 provider。"));

			for (const group of groups) {
				const isPiAi = group.field === "input";
				const routeCards = group.rows.map((row) => {
					const rows = row.models.map((model, index) => {
						const entry = asRecord(model);
						const declared = declaredOf(model, group.field);
						const status = statusOf(declared);
						const base = `${group.ns}|${row.route}|${String(index)}`;
						const modelId = String(entry?.id ?? "(未命名)");

						const imagePending = pending === `${base}|image`;
						const toggles = [
							e("label", { key: `${base}|image`, style: toggleStyle },
								e("input", {
									type: "checkbox",
									"data-kind": "image",
									"data-model": modelId,
									"data-route": row.route,
									checked: imageDeclared(declared),
									disabled,
									onChange: (event) => submit(group, row, index, { kind: "image", enabled: event.target.checked }, modelId, "图片", entry)
								}),
								e("span", null, "图片"),
								imagePending ? e("span", { style: inheritBadgeStyle }, "写入中") : null)
						];

						if (isPiAi) {
							for (const spec of compatSpecsFor(row, entry)) {
								const info = compatState(row, entry, spec.key);
								const switchPending = pending === `${base}|${spec.key}`;
								toggles.push(e("label", { key: `${base}|${spec.key}`, style: toggleStyle },
									e("input", {
										type: "checkbox",
										"data-kind": "compat",
										"data-key": spec.key,
										"data-model": modelId,
										"data-route": row.route,
										checked: info.value,
										disabled,
										onChange: (event) => submit(group, row, index, { kind: "compat", key: spec.key, enabled: event.target.checked }, modelId, spec.label, entry)
									}),
									e("span", null, spec.label),
									info.source === "route" ? e("span", { style: inheritBadgeStyle }, "默认") : null,
									switchPending ? e("span", { style: inheritBadgeStyle }, "写入中") : null));
							}
						}

						const rowFeedback = feedback[base];
						return e("div", { key: `${base}|row`, style: modelRowStyle },
							e("div", { style: modelHeadStyle },
								e("span", { style: idStyle }, modelId),
								entry?.name !== undefined && String(entry.name) !== modelId
									? e("span", { style: nameStyle }, String(entry.name)) : null,
								e("span", { style: badgeStyle(status.tone) }, status.text)),
							e("div", { style: toggleBarStyle }, ...toggles),
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
