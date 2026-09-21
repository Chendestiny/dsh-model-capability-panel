# dsh-model-capability-panel

A DeepSeek Harness (`dsh`) settings panel for **per-model capability overrides**: one row per model with a
checkbox strip for image input modality plus the compat protocol switches, so relay and custom-provider
models can be configured without hand-editing `settings.yaml`.

[中文说明](#中文) · [English](#english)

---

## English

### What it does

Settings → **Model capabilities** (`模型能力`): one row per model — `route / model-id` on the left, a
checkbox strip on the right:

| Toggle | Writes |
|---|---|
| Image input | `models[].input = ["text","image"]` (unchecked: deletes `input`) |
| Reasoning effort | `models[].compat.supportsReasoningEffort = true\|false` |
| Temperature | `models[].compat.supportsTemperature` |
| Strict tools | `models[].compat.supportsStrictTools` |
| Strict mode | `models[].compat.supportsStrictMode` |
| Cache control on tools | `models[].compat.supportsCacheControlOnTools` |
| Store | `models[].compat.supportsStore` |
| Developer role | `models[].compat.supportsDeveloperRole` |
| Adaptive thinking | `models[].compat.forceAdaptiveThinking` |

Unchecking a compat switch writes an explicit `false` (not a deleted key) — most of these default to
`true`, so deleting the key would silently flip the checkbox back on.

Effective value = `model.compat[key] ?? route.compat[key] ?? false`. When the value comes from the route
default instead of the model entry, the row shows a faint **default** badge; clicking either way writes an
explicit model-level override.

`contextWindow` / `maxTokens` / `name` are deliberately **not** duplicated here — the built-in
Settings → Models form already edits them.

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
