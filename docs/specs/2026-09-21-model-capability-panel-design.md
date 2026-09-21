# dsh-model-capability-panel 设计（2026-09-21）

## 背景

dsh 运行时可解析并强制每个模型的输入模态（`declaredInput(entry.input) ?? base?.input ?? DEFAULT_INPUT`，
投递图片时抛 `MODEL_DOES_NOT_SUPPORT_IMAGES`），但内置「设置 → 模型」表单不暴露该字段；
历史上供第三方插字段的 `settings.models.model.fields` 扩展点已在 dsh 0.1.1+ 被移除（官方
discussion #5702 提出需求但未实现）。因此中转/自建 provider 的模型只能手改 `settings.yaml`。

第一版（`dsh-model-modality-panel`）只做了图片模态勾选。用户反馈：一个模型右边应该有一排勾选框，
覆盖更多能力；且 `contextWindow`/`maxTokens` 内置 UI 已有，不应重复。

## 目标

- 设置页「模型能力」：每个模型一行，左边 `供应商 / 模型 id`，右边一排勾选框
- 勾选框 = 图片输入模态 + 8 个常用 compat 协议开关
- 全部经官方 `api.settings.mutate` 写入，带 revision 守卫
- 不覆盖内置 UI 已提供的字段（`contextWindow` / `maxTokens` / `name`）
- 不触碰用户手写的其他字段（`reasoningEfforts` 等）

## 非目标（YAGNI）

- 供应商（route）级 `compat` 默认值、`headers`、`transport`、超时、图片上限 → 下一版「供应商能力」
- `reasoningEfforts` 档位编辑（用户已手配，插件只保证不碰）
- `llm-deepseek` 家族的 compat（该 schema 无此概念，仅保留图片勾选）
- 数组元素按下标写入（宿主 `applyPathOp` 只下钻纯对象，做不到）

## 写入口径

| 操作 | 写入 |
|---|---|
| 勾选 compat | `models[i].compat.<key> = true` |
| 取消勾选 compat | `models[i].compat.<key> = false`（显式 false，**不删字段**） |
| 勾选图片 | `models[i].input = ["text","image"]` |
| 取消图片 | 删除 `models[i].input`（回落目录/默认，即纯文本） |

取消 compat 不删字段的理由：这批开关多数默认为 `true`（如 `supportsTemperature`、
`supportsReasoningEffort`），删字段会让"取消勾选"反而回到 `true`，与用户语义相反。
显式 `false` 才表达"这个模型不支持该项"。

## 生效值解析与「默认」徽标

每个勾选框显示**生效值**：`模型自身 compat[key] ?? 路由级 compat[key] ?? false`。

- 模型自身声明 → 勾选状态直接反映，无徽标
- 值来自路由级 `compat` → 同样反映勾选状态，但加浅色「默认」徽标，提示"改这里会写成模型级覆写"
- 两边都没声明 → 未勾选 + 「默认」徽标（真实值由内置目录决定，客户端不可见）

点击任何状态都会把该 key 写成模型级显式值（`true`/`false`），徽标随之消失。

## 暴露的开关（v0.3 定稿：2 个）

1. **图片输入**（所有协议的模型）
2. **严格 JSON** —— 跨协议同一标签，底层按该路由 `api` 写不同键：
   - `openai-completions` / `openai-responses` / `openai-codex-responses` / `azure-openai-responses` / `bedrock-converse-stream` → `compat.supportsStrictMode`
   - `anthropic-messages` → `compat.supportsStrictTools`
   - 该 api 不在上表 → 不渲染该开关

另有兜底：某模型若已设了**其他** `compat` 键（历史残留或手写），仍以原始键名为标题渲染成开关，
保证写成的东西界面上一定可见、可撤销。

### 为什么从 8 个砍到 2 个（v0.2 → v0.3）

初版按"常用程度"选了 8 个 compat 开关，但漏掉了一个硬事实：**compat 是按协议分家的**。
宿主校验会直接拒绝协议不认的键，用户在 `anthropic-messages` 路由上点「思考档位」即报错：

```
llm-pi-ai: provider "aicodemirror-claude" model "claude-opus-5" sets compat "supportsReasoningEffort",
but its api is "anthropic-messages", which does not take it; that switch exists on openai-completions,
and "anthropic-messages" offers supportsEagerToolInputStreaming, supportsLongCacheRetention,
supportsCacheControlOnTools, supportsTemperature, forceAdaptiveThinking, allowEmptySignature,
supportsStrictTools
```

即 8 个里只有 1 个在任一给定协议上有效，其中 4 个（温度、严格工具、工具缓存控制、自适应思考）
只在 anthropic 上存在，2 个（思考档位、Store）只在 openai 系存在，2 个（严格模式、Developer 角色）
在 completions + responses 上存在。用户评估后认为其余开关属于"中转不兼容补救"或"省钱"类，
在其包月订阅主力线路上无用，最终只保留跨协议唯一的「严格 JSON」。

### 协议 → compat 字段全表（自 `dsh-llm-pi-ai` 的 `COMPAT_GATES`，仅供手改 yaml 参考）

| 协议 | offer（可写） |
|---|---|
| `openai-completions` | supportsStore、supportsDeveloperRole、supportsReasoningEffort、supportsUsageInStreaming、maxTokensField、requiresToolResultName、requiresAssistantAfterToolResult、requiresThinkingAsText、requiresReasoningContentOnAssistantMessages、thinkingFormat、chatTemplateKwargs、supportsStrictMode、cacheControlFormat、supportsLongCacheRetention |
| `openai-responses` / `azure-openai-responses` / `openai-codex-responses` | supportsDeveloperRole、supportsStrictMode、supportsLongCacheRetention |
| `anthropic-messages` | supportsEagerToolInputStreaming、supportsLongCacheRetention、supportsCacheControlOnTools、supportsTemperature、forceAdaptiveThinking、allowEmptySignature、supportsStrictTools |
| `bedrock-converse-stream` | supportsStrictMode |
| 其他 | 无 compat |

（`maxTokensField` / `thinkingFormat` / `cacheControlFormat` 为字符串型、`chatTemplateKwargs` 为对象型，
不适合做勾选框，故不纳入面板。）

### 未做的事（YAGNI）

- `contextWindow` / `maxTokens`：dsh 内置「设置 → 模型」已有，不重复实现
- `reasoningEfforts` 档位编辑：用户已手配，插件只保证不碰
- 供应商（route）级 `compat` 默认值、`headers`、`transport`、超时、图片上限：留待"供应商能力"下一版

## 写入机制

沿用第一版：整数组 `set`（宿主不能按元素寻址）+ 条目逐字段克隆，
因此 `reasoningEfforts` / `contextWindow` / `name` 等手写字段在写入后原样保留。
每次写入携带读取时的 `revision`，与官方编辑器同策略；冲突时宿主拒绝而非覆盖。

## 界面

```
设置 → 模型能力
opencode-go / glm-5.3-flash                     GLM-5.3-Flash
[图片] [思考档位] [温度] [严格工具] [严格模式] [缓存控制] [Store] [Developer 角色] [自适应思考]
                                                       ↑ 继承自路由默认时显示「默认」徽标
```

pi-ai 路由每个模型一行；`llm-deepseek` 家族仅图片勾选。

## 测试

`tests/smoke.mjs` 断言：
1. 注册项形状（`apply` / `inject` 导出）
2. compat 勾选 → `compat[key] = true`
3. compat 取消 → `compat[key] = false`（显式 false，非删字段）
4. 「默认」徽标判定：模型声明 vs 路由级继承 vs 双未声明
5. 图片勾选/取消两条路径（回归）
6. 未声明字段不被污染（`reasoningEfforts` 等原样保留）

## 验证边界

- 可验证：smoke 自测、`dsh --profile web --dump-config` 装配、YAML 解析、bundle 被 3080 服务
- 不可验证：浏览器实际渲染（需用户重启 dsh web 后目视确认）

## 发布

- 唯一源：`D:\Project\dsh-model-capability-panel`
- `scripts/publish_github.py`：提交 + 推送 + SHA 三方比对（只读注册表代理，不改 git 全局配置）
- `scripts/publish_local.py`：把本目录装成 dsh web profile 的 `link:` 依赖
- 注册表投稿：`Chendestiny__dsh-model-capability-panel.yml` → `data/plugins/` 同名文件
  （仓库需创建满 1 天，故 PR 次日提交）
