/**
 * Model modality panel — browser half.
 *
 * Settings → 模型读图: one checkbox per model, writing the modality field the
 * runtime already enforces (`models[].input` for llm-pi-ai, `models[].inputModalities`
 * for llm-deepseek). Registered on the root `settings.section` slot, the same seat
 * the official Models page uses — this plugin deliberately does NOT inject into the
 * official model form, because the `settings.models.model.fields` extension point
 * that once allowed it was removed in dsh 0.1.1+.
 *
 * Writes go through `settings.mutate` with whole-array `set` ops: the host's
 * `applyPathOp` descends into plain objects only, so a path that crosses an array
 * element is not addressable and would replace the array instead.
 *
 * @module dsh-model-modality-panel/client
 */
window.__ModuleLoader__.load({
	id: "dsh-model-modality-panel",
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

		/** Three postures the panel distinguishes, because "undeclared" is not "text-only". */
		function statusOf(declared) {
			if (imageDeclared(declared)) return { text: "读图", tone: "on" };
			if (Array.isArray(declared) && declared.length > 0) return { text: "仅文本（显式）", tone: "off" };
			return { text: "未声明", tone: "inherit" };
		}

		/**
		 * The new models array for one toggle. Entries are cloned verbatim so every
		 * field the user hand-wrote survives the whole-array write.
		 * @param row - the route row owning the model.
		 * @param field - `input` (pi-ai) or `inputModalities` (deepseek).
		 * @param index - model index inside the row.
		 * @param enabled - whether image input should be declared.
		 * @returns the replacement array.
		 */
		function buildModels(row, field, index, enabled) {
			const models = clone(row.models);
			const entry = models[index];
			if (!isRecord(entry)) throw new Error("模型条目不可写");
			if (field === "input") {
				if (enabled) entry.input = [...IMAGE_LIST];
				else delete entry.input;
			} else if (enabled) {
				entry.inputModalities = [...IMAGE_LIST];
			} else {
				entry.inputModalities = [TEXT];
				delete entry.imagePixelBudget;
				delete entry.imageMaxBytes;
				delete entry.imageDetail;
			}
			return models.map((model) => {
				if (!isRecord(model)) return model;
				const next = { ...model };
				/* An empty list states no answer, so persisting it would only be noise. */
				if (Array.isArray(next.input) && next.input.length === 0) delete next.input;
				return next;
			});
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
						title: "pi-ai 路由 · llm-pi-ai.providers.<route>.models[].input",
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
			maxWidth: "760px",
			color: "var(--dsw-alias-label-primary, #1f2328)"
		};
		const titleStyle = { margin: 0, fontSize: "16px", fontWeight: 500, lineHeight: "24px" };
		const introStyle = { margin: 0, fontSize: "13px", lineHeight: "20px", color: "var(--dsw-alias-label-tertiary, #6b7280)" };
		const noticeStyle = { margin: 0, fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-state-success-primary, #128a47)" };
		const failureStyle = { margin: 0, fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-state-error-primary, #c43333)" };
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
		const rowStyle = {
			display: "flex",
			alignItems: "center",
			gap: "8px",
			fontSize: "13px",
			lineHeight: "22px",
			cursor: "pointer"
		};
		const idStyle = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" };
		const nameStyle = { color: "var(--dsw-alias-label-tertiary, #6b7280)", fontSize: "12px" };
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

		/** The settings page body. Injected face: `{ api }`. */
		function ModalitySection(props) {
			const api = props.api;
			const [state, setState] = react.useState({ status: "loading" });
			const [pending, setPending] = react.useState(undefined);
			const [failure, setFailure] = react.useState(undefined);
			const [notice, setNotice] = react.useState(undefined);

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

			const toggle = (group, row, index, enabled, modelId) => {
				const key = `${group.ns}|${row.route}|${String(index)}`;
				setPending(key);
				setFailure(undefined);
				setNotice(undefined);
				Promise.resolve()
					.then(() => {
						const models = buildModels(row, group.field, index, enabled);
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
							namespaces: previous.namespaces.map((entry) => (entry?.ns === view?.ns ? view : entry))
						});
						setNotice(`${group.ns} · ${row.route === "" ? "models" : row.route} · ${modelId}：已${enabled ? "开启" : "关闭"}读图`);
					})
					.catch((error) => {
						setFailure(messageOf(error));
						load();
					})
					.then(() => setPending(undefined));
			};

			if (state.status === "loading") return e("div", { style: panelStyle }, e("p", { style: introStyle }, "读取设置中…"));
			if (state.status === "failed") {
				return e("div", { style: panelStyle },
					e("h2", { style: titleStyle }, "模型读图"),
					e("p", { style: failureStyle }, `读取失败：${state.message}`),
					e("button", { type: "button", style: buttonStyle, onClick: load }, "重试"));
			}

			const groups = collectGroups(state.namespaces);
			const disabled = pending !== undefined || state.writable === false;
			const children = [
				e("h2", { key: "title", style: titleStyle }, "模型读图"),
				e("p", { key: "intro", style: introStyle },
					"勾选后写入 settings.yaml 的模型模态字段（pi-ai 写 models[].input，DeepSeek 官方目录写 models[].inputModalities）。立即生效；取消勾选等于不声明，让运行时回落到目录/默认的纯文本。"),
				e("button", { key: "refresh", type: "button", style: buttonStyle, disabled: pending !== undefined, onClick: load }, "重新读取设置")
			];
			if (failure !== undefined) children.push(e("p", { key: "failure", style: failureStyle }, failure));
			if (notice !== undefined) children.push(e("p", { key: "notice", style: noticeStyle }, notice));
			if (state.writable === false) children.push(e("p", { key: "readonly", style: failureStyle }, "当前设置提供方是只读的，无法写入。"));

			if (groups.length === 0) children.push(e("p", { key: "empty", style: introStyle }, "没有找到声明了 models 列表的 provider。"));

			for (const group of groups) {
				const routeCards = group.rows.map((row) => {
					const rows = row.models.map((model, index) => {
						const declared = declaredOf(model, group.field);
						const status = statusOf(declared);
						const key = `${group.ns}|${row.route}|${String(index)}`;
						const modelId = String(asRecord(model)?.id ?? "(未命名)");
						return e("label", { key: `${key}|${modelId}`, style: rowStyle },
							e("input", {
								type: "checkbox",
								checked: imageDeclared(declared),
								disabled,
								onChange: (event) => toggle(group, row, index, event.target.checked, modelId)
							}),
							e("span", { style: idStyle }, modelId),
							asRecord(model)?.name !== undefined && String(asRecord(model).name) !== modelId
								? e("span", { style: nameStyle }, String(asRecord(model).name)) : null,
							pending === key ? e("span", { style: badgeStyle("off") }, "写入中…") : null,
							e("span", { style: badgeStyle(status.tone) }, status.text));
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
				id: "model-modality",
				order: 150,
				label: () => "模型读图",
				inject: injected
			}, ModalitySection));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
