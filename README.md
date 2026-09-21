# dsh-model-capability-panel

A DeepSeek Harness (`dsh`) settings panel for **per-model capability overrides**: one row per model with a
checkbox strip for image input modality plus the compat protocol switches, so relay and custom-provider
models can be configured without hand-editing `settings.yaml`.

[中文说明](#中文) · [English](#english)

---

## English

### What it does

Settings → **Model capabilities** (`模型能力`): one row per model — `route / model-id` on the left, the
controls on the right:

| Control | Writes |
|---|---|
| Image input | `models[].input = ["text","image"]` (unchecked: deletes `input`) |
| Reasoning levels | `models[].reasoningEfforts = { off: null, low: "low", medium: "medium", high: "high", … }` |

**Reasoning levels** are the levels the model *offers* in the effort picker — dsh refuses an effort the
model never declared (`provider "…" model "…" does not support reasoning effort "high"`). Seven levels
exist: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. The panel shows `off/low/medium/high`
inline and folds `minimal/xhigh/max` behind **more levels** (auto-expanded when one of them is already
set). Unchecking every level writes `reasoningEfforts: false`, meaning "this model offers no effort
picker". A level already carrying a custom wire spelling keeps that string untouched — only newly checked
levels are written as the level's own name (`off` is written as `null`, the shape `off:` in YAML).

Each write reports back: a pending state on the row, then the exact path it wrote
(`llm-pi-ai.providers.<route>.models[i].reasoningEfforts = {off, low, medium, high}`), or the host's
rejection message verbatim.

#### What is deliberately not here

- **Other input modalities don't exist.** Both `llm-pi-ai` and `llm-deepseek` declare exactly
  `["text", "image"]`; audio/video/pdf appear only as *catalog metadata* about a model, never as a
  configurable field. `image` is the only second modality a model entry can declare.
- **`compat` protocol switches were removed.** They are protocol-scoped — a key valid on
  `openai-completions` is rejected outright on `anthropic-messages`:

  ```
  llm-pi-ai: provider "…" model "…" sets compat "supportsReasoningEffort", but its api is
  "anthropic-messages", which does not take it; that switch exists on openai-completions, and
  "anthropic-messages" offers supportsEagerToolInputStreaming, supportsLongCacheRetention, …
  ```

  The complete protocol→field table is kept in `docs/specs/` for the times you do need one — hand-edit
  `settings.yaml` and the host will tell you immediately if the route's protocol cannot take it.
- **`contextWindow` / `maxTokens` / `name`** — the built-in Settings → Models form already edits them.
- **`reasoning`** (route-level default level) and route-level `compat` — a later "provider capabilities"
  scope.

For the `llm-deepseek` family only the image toggle applies.

For the `llm-deepseek` family only the image toggle applies (that schema has no `compat`).

The dsh runtime already resolves and enforces a per-model input modality
(`declaredInput(entry.input) ?? base?.input ?? DEFAULT_INPUT`, with
`MODEL_DOES_NOT_SUPPORT_IMAGES` raised on delivery), but the built-in
Settings → Models form does not expose the field, and the historical
`settings.models.model.fields` extension point was removed in dsh 0.1.1+.
So for relay/self-hosted providers — which are not in the built-in catalog —
marking a model as vision-capable means hand-editing `llm-pi-ai.providers.<route>.models[].input`.

This plugin adds a standalone **Settings → Model image input** page that writes
the same field through the official `api.settings.mutate` path.

### What it writes

| Family | Namespace | Field | Path |
|---|---|---|---|
| pi-ai custom routes | `llm-pi-ai` | `input` | `providers.<route>.models[].input` |
| DeepSeek official catalog | `llm-deepseek` | `inputModalities` | `models[].inputModalities` |

- Checked → `["text","image"]`
- Unchecked → pi-ai deletes `input` (undeclared; the runtime falls back to the
  catalog/default, i.e. text-only); DeepSeek writes `["text"]` back and clears
  `imagePixelBudget` / `imageMaxBytes` / `imageDetail`, which `llm-deepseek`
  rejects when the model is not image-capable
- Writes use a **whole-array `set`** through `settings.mutate`: the host's
  `applyPathOp` descends into plain objects only and cannot address array
  elements, so per-index edits would silently replace the whole array. Entries
  are cloned field by field, so hand-written `contextWindow`,
  `reasoningEfforts`, `name`, etc. survive the write

### Install

```sh
dsh plugin --profile web add https://github.com/Chendestiny/dsh-model-modality-panel
```

After installing, **restart dsh web** — the client plugin set is assembled at
startup (only bundle contents are hot-reloaded). Then refresh the page: Settings
gains a **Model image input** page. The client bundle is served by
`dsh-client-modules` at `/plugins/dsh-model-modality-panel/client.js`.

### Uninstall

```sh
dsh plugin --profile web remove dsh-model-modality-panel
```

Then restart dsh web.

### Self-test

```sh
node tests/smoke.mjs
```

Drives the client component with a React stub and asserts the registration
shape, the `mutate` payloads for both the check and uncheck paths, that
undeclared entries are not polluted, and that the DeepSeek family clears the
image-budget fields on uncheck.

---

## 中文

DSH 设置面板插件：在 **设置 → 模型读图** 里勾选/取消每个模型的「图片输入」模态，免去手改
`settings.yaml`（官方 discussion [#5702](https://github.com/deepseek-ai/deepseek-harness/discussions/5702)
尚未把该字段做进内置模型表单；`settings.models.model.fields` 扩展点已在 dsh 0.1.1+ 移除，
所以本插件走独立的 `settings.section` 设置页）。

### 写什么

| 家族 | 命名空间 | 字段 | 路径 |
|---|---|---|---|
| pi-ai 自定义路由 | `llm-pi-ai` | `input` | `providers.<route>.models[].input` |
| DeepSeek 官方目录 | `llm-deepseek` | `inputModalities` | `models[].inputModalities` |

- 勾选 → `["text","image"]`
- 取消 → pi-ai 删除 `input`（= 不声明，运行时回落目录/默认纯文本）；DeepSeek 写回 `["text"]`
  并一并清掉 `imagePixelBudget` / `imageMaxBytes` / `imageDetail`（`llm-deepseek` 在
  `!hasImage` 时存在这些字段会直接抛错）
- 写入走 `settings.mutate` 的**整数组 set**：宿主 `applyPathOp` 只下钻纯对象、不索引数组，
  按元素下标寻址会变成整数组替换，所以这里显式重写整条 `models` 数组，条目逐字段克隆，
  你手写的 `contextWindow` / `reasoningEfforts` 等一律原样保留

### 安装

```powershell
dsh plugin --profile web add https://github.com/Chendestiny/dsh-model-modality-panel
```

装完**必须重启 dsh web**（客户端插件集合变化只在启动时装配；bundle 内容变化才有 HMR），
重启后刷新页面：设置面板会多出「模型读图」一页。

### 卸载

```powershell
dsh plugin --profile web remove dsh-model-modality-panel
```

再重启 dsh web 即可。

### 自测

```powershell
node tests/smoke.mjs
```

### 本仓库的两个发布脚本

```powershell
python scripts\publish_github.py --message "feat: ..."   # 提交并推送到 GitHub（含 SHA 三方比对验证）
python scripts\publish_local.py                          # 把本目录作为 link 安装进 dsh web profile
```

`D:\Project\dsh-model-modality-panel` 是唯一源；本地安装通过 `link:` 指向本目录，
所以改完代码跑一次 `publish_local.py`（必要时重启 dsh web）即生效。

## License

MIT © 2026 Chendestiny
