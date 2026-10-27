// 预置模型：由供应商 GET /v1/models 与逐模型探测（tool_call、图片输入、
// max_tokens 上限、能接受的 reasoning_effort）整理而来。
// context/output 单位为 token；cost 为每百万 token 的美元参考价（供应商不公布
// 价格，取上游公开报价的平均水平，仅用于本地费用估算）。
//
// 探测结论（2026-10，真实 key 实测）：
//   - GET /v1/models 返回 10 个模型，字段只有 id/object/created/owned_by。
//   - 三种 API 形状都可用（/chat/completions、/responses、/messages），
//     插件统一走 chat completions（@ai-sdk/openai-compatible）最稳。
//   - 视觉输入：DeepSeek-V4.1-Flash、GLM-5.3-Flash、Kimi-K3、Qwen3.8-27B、
//     gemma-4-26B、Muse-Glimmer-30B 支持；V4-Flash、V4-Pro、GLM-5.2 拒绝图片。
//   - 全部模型支持工具调用；stream + include_usage 正常。
//   - reasoning 字段不统一：deepseek-* 用 message.reasoning_content，
//     其余用 message.reasoning。
//   - reasoning_effort 接受 minimal/low/medium/high/xhigh/max，非法值表现为
//     503 "the model `X` is unavailable"（不是 400）。
//   - 偶发 503 unavailable（GLM-5.3、Kimi-K3 各见过一次），可重试。

export const PROVIDER = "systalyze"
export const BASE_URL = "https://inference.systalyze.com/v1"
export const VERSION = "0.1.0"
export const CLIENT_HEADER = "x-systalyze-client"

/** 网关统一给 magpie 的 API：chat completions */
export const NPM = "@ai-sdk/openai-compatible"

/** 所有模型都接受的推理档位（实测；取最保守的公共子集） */
export const EFFORTS = ["low", "medium", "high"]

/** id -> 预设模型 */
export const PRESET_MODELS = {
  "deepseek-ai/DeepSeek-V4.1-Flash-1017": {
    name: "DeepSeek V4.1 Flash 1017",
    limit: { context: 1048576, output: 384000 },
    reasoning: true,
    tool_call: true,
    vision: true,
    interleaved: { field: "reasoning_content" },
    cost: { input: 0.3, output: 1.2, cache_read: 0.006 },
  },
  "deepseek-ai/DeepSeek-V4-Flash-0731": {
    name: "DeepSeek V4 Flash 0731",
    limit: { context: 1048576, output: 384000 },
    reasoning: true,
    tool_call: true,
    vision: false,
    interleaved: { field: "reasoning_content" },
    cost: { input: 0.14, output: 0.28, cache_read: 0.03 },
  },
  "deepseek-ai/DeepSeek-V4-Pro-0813": {
    name: "DeepSeek V4 Pro 0813",
    limit: { context: 1048576, output: 384000 },
    reasoning: true,
    tool_call: true,
    vision: false,
    interleaved: { field: "reasoning_content" },
    cost: { input: 1.32, output: 3.96, cache_read: 0.13 },
  },
  "zai-org/GLM-5.3": {
    name: "GLM-5.3",
    limit: { context: 1048576, output: 262144 },
    reasoning: true,
    tool_call: true,
    vision: false,
    cost: { input: 1.4, output: 4.4, cache_read: 0.26 },
  },
  "zai-org/GLM-5.3-Flash": {
    name: "GLM-5.3-Flash",
    limit: { context: 1048576, output: 262144 },
    reasoning: true,
    tool_call: true,
    vision: true,
    cost: { input: 0.15, output: 0.5, cache_read: 0.03 },
  },
  "zai-org/GLM-5.2": {
    name: "GLM-5.2",
    limit: { context: 1048576, output: 262144 },
    reasoning: true,
    tool_call: true,
    vision: false,
    cost: { input: 1.4, output: 4.4, cache_read: 0.26 },
  },
  "moonshotai/Kimi-K3": {
    name: "Kimi K3",
    limit: { context: 1048576, output: 131072 },
    reasoning: true,
    tool_call: true,
    vision: true,
    cost: { input: 3, output: 15, cache_read: 0.3 },
  },
  "Qwen/Qwen3.8-27B": {
    name: "Qwen3.8 27B",
    limit: { context: 262144, output: 131072 },
    reasoning: true,
    tool_call: true,
    vision: true,
    cost: { input: 0.4, output: 3, cache_read: 0.04 },
  },
  "google/gemma-4-26B-A4B-it": {
    name: "Gemma 4 26B A4B IT",
    limit: { context: 131072, output: 32768 },
    reasoning: true,
    tool_call: true,
    vision: true,
    cost: { input: 0.13, output: 0.4, cache_read: 0.05 },
  },
  "meta-models/Muse-Glimmer-30B": {
    name: "Muse Glimmer 30B",
    limit: { context: 131072, output: 32768 },
    reasoning: true,
    tool_call: true,
    vision: true,
    cost: { input: 0.2, output: 0.6, cache_read: 0.03 },
  },
}

/** 供应商返回了预设之外的新模型时，按 id 拼一个能用的条目 */
export function genericModel(id) {
  return {
    name: prettyName(id),
    limit: { context: 131072, output: 32768 },
    reasoning: true,
    tool_call: true,
    vision: false,
    cost: { input: 0, output: 0, cache_read: 0 },
  }
}

export function presetOf(id) {
  return PRESET_MODELS[id] ?? genericModel(id)
}

export function prettyName(id) {
  if (!id) return "unknown"
  const short = String(id).split("/").pop() ?? String(id)
  return short
}

/** 每个模型的支持情况表（README / 测试用） */
export function capabilityTable() {
  return Object.entries(PRESET_MODELS).map(([id, m]) => ({
    id,
    name: m.name,
    context: m.limit.context,
    output: m.limit.output,
    vision: !!m.vision,
    reasoning: !!m.reasoning,
    tool_call: !!m.tool_call,
    cost: { ...m.cost },
  }))
}

/** config 钩子用的模型表：深拷贝，避免调用方改动预设 */
export function presetModels() {
  const out = {}
  for (const [id, m] of Object.entries(PRESET_MODELS)) out[id] = clone(m)
  return out
}

export function clone(v) {
  return typeof structuredClone === "function" ? structuredClone(v) : JSON.parse(JSON.stringify(v))
}
