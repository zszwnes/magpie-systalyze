// systalyze 供应商插件：把 inference.systalyze.com 的 10 个预置模型接进 magpie，
// 用量优先读官方控制台的余额与真实计费，没有控制台会话时退回本机账本估算。
//
// 关于用量：推理端点（inference.systalyze.com）只有 /v1/models、/v1/chat/completions、
// /v1/responses、/v1/messages；/v1/usage、/v1/me、/v1/balance、/v1/quota、/v1/credits
// 全部 404 "unknown route"。真实余额在控制台那一套 API 上
// （https://console.systalyze.com/api/v1，better-auth 会话 cookie），用 inference key
// 打过去是 401。所以：
//   - 登录时填了控制台会话（或选项 consoleSession）→ 显示官方余额与官方真实用量；
//   - 没填 → 按 ~/.config/magpie/usage.jsonl 里本供应商的请求行估算，只报「用了多少」。
// 官方接口见 console-usage.mjs。

import {
  BASE_URL,
  CLIENT_HEADER,
  EFFORTS,
  NPM,
  PRESET_MODELS,
  PROVIDER,
  VERSION,
  capabilityTable,
  genericModel,
  presetOf,
  prettyName,
} from "./models.mjs"
import { consoleSnapshot, sessionOf } from "./console-usage.mjs"
import { localUsage, shortModel } from "./usage-store.mjs"

const CHAT = NPM
const DAY = 24 * 60 * 60 * 1000
const TIMEOUT = 20_000

/** 供应商返回的 id 列表（真接口一次 GET /v1/models 就够） */
async function fetchModelIds(base, key) {
  const url = base.replace(/\/+$/, "") + "/models"
  const res = await fetch(url, {
    headers: { authorization: "Bearer " + key, [CLIENT_HEADER]: `magpie/${VERSION}` },
    signal: AbortSignal.timeout(TIMEOUT),
  })
  if (res.status === 401 || res.status === 403) {
    throw Object.assign(new Error(`${res.status} 密钥被拒绝`), { signIn: "expired" })
  }
  if (!res.ok) throw new Error(`${res.status} ${await why(res)}`)
  const body = await res.json()
  const ids = (body?.data ?? []).map((m) => m?.id).filter((id) => typeof id === "string" && id)
  if (!ids.length) throw new Error("/v1/models 返回了空列表")
  return ids
}

async function why(res) {
  try {
    const body = await res.json()
    return body?.error?.message ?? JSON.stringify(body).slice(0, 120)
  } catch {
    return res.statusText
  }
}

/** 推理档位：magpie 把 variants 的键当 effort 选项 */
function variants(levels) {
  return Object.fromEntries((levels ?? []).map((l) => [l, { reasoningEffort: l }]))
}

/** magpie 的运行时模型对象 */
function runtimeModel(id, providerID, base) {
  const p = presetOf(id)
  return {
    id,
    providerID,
    name: p.name ?? prettyName(id),
    api: { id, url: base, npm: CHAT },
    status: "active",
    headers: { [CLIENT_HEADER]: `magpie/${VERSION}` },
    options: {},
    cost: {
      input: p.cost?.input ?? 0,
      output: p.cost?.output ?? 0,
      cache: { read: p.cost?.cache_read ?? 0, write: 0 },
    },
    limit: { context: p.limit?.context ?? 0, output: p.limit?.output ?? 0 },
    capabilities: {
      temperature: true,
      reasoning: !!p.reasoning,
      attachment: !!p.vision,
      toolcall: p.tool_call !== false,
      input: { text: true, image: !!p.vision, audio: false, video: false, pdf: false },
      output: { text: true, image: false, audio: false, video: false, pdf: false },
      interleaved: p.interleaved ?? false,
    },
    release_date: "",
    variants: p.reasoning ? variants(EFFORTS) : {},
  }
}

/** config 钩子里的模型条目：构造用 config 的形状（provider 覆盖 API） */
function configModel(id) {
  const p = presetOf(id)
  return {
    name: p.name ?? prettyName(id),
    limit: { context: p.limit?.context ?? 0, output: p.limit?.output ?? 0 },
    tool_call: p.tool_call !== false,
    reasoning: !!p.reasoning,
    attachment: !!p.vision,
    cost: {
      input: p.cost?.input ?? 0,
      output: p.cost?.output ?? 0,
      cache_read: p.cost?.cache_read ?? 0,
    },
    ...(p.reasoning ? { variants: variants(EFFORTS) } : {}),
    provider: { npm: CHAT, api: BASE_URL },
  }
}

/** 预置表的运行时形状（没有 key 或接口挂了时用，和真接口那条路同构） */
function presetRuntimeModels(providerID, base) {
  const out = {}
  for (const mid of Object.keys(PRESET_MODELS)) out[mid] = runtimeModel(mid, providerID, base)
  return out
}

/** config 钩子的整张模型表 */
function configModels() {
  return Object.fromEntries(Object.keys(PRESET_MODELS).map((id) => [id, configModel(id)]))
}

// ---- 用量窗口 ----------------------------------------------------------------

const money = (v) => "$" + (Math.round(v * 1e4) / 1e4).toFixed(4)
const compact = (n) => {
  const v = Math.round(n)
  if (v < 1000) return String(v)
  if (v < 1e6) return (v / 1000).toFixed(v < 1e4 ? 1 : 0) + "K"
  return (v / 1e6).toFixed(v < 1e7 ? 1 : 0) + "M"
}
const pct = (used, limit) => (limit > 0 ? (100 * used) / limit : used > 0 ? 100 : 0)

/** 汇总 -> 一个窗口；aside 的窗口用完了也不影响账号可用性 */
function usageWindow(name, s, extra = {}) {
  return {
    name,
    used: 0, // 没有上限，只有实际用量
    display: `${compact(s.in + s.out)} tokens · ${s.calls} 次 · 约 ${money(s.cost)}`,
    amount: s.in + s.out,
    unit: "tokens",
    aside: true,
    ...extra,
  }
}

const round4 = (v) => Math.round(v * 1e4) / 1e4

/** 官方数据：余额窗口 + 三个真实计费窗口 + 分模型明细 */
function officialUsage(snap, withModels) {
  const windows = []
  const granted = snap.balance.granted
  const remaining = snap.balance.remaining
  const spent = Math.max(0, granted - remaining)
  if (granted > 0) {
    windows.push({
      name: "余额",
      used: pct(spent, granted),
      display: `${money(remaining)} 可用 · 已用 ${money(spent)} / ${money(granted)}`,
      amount: round4(remaining),
      limit: round4(granted),
      unit: "usd",
    })
  } else {
    windows.push({
      name: "余额",
      used: 0,
      aside: true,
      display: `${money(remaining)} 可用`,
      amount: round4(remaining),
      unit: "usd",
    })
  }

  const labels = { today: "今日（官方）", "7d": "近 7 天（官方）", "30d": "近 30 天（官方）" }
  const spans = { today: 86400, "7d": 7 * 86400, "30d": 30 * 86400 }
  for (const key of ["today", "7d", "30d"]) {
    const s = snap.windows[key] ?? { calls: 0, in: 0, out: 0, cacheRead: 0, cost: 0 }
    windows.push({
      name: labels[key],
      used: 0,
      aside: true,
      amount: round4(s.cost),
      unit: "usd",
      display: `${money(s.cost)} · ${compact(s.in + s.out)} tokens · ${s.calls} 次`,
      span: spans[key],
    })
  }

  const out = {
    plan: "按 key 计费 · 余额与用量来自官方控制台",
    windows,
    user: snap.email || undefined,
  }

  if (withModels) {
    const used = [...snap.models].sort((a, b) => b.cost - a.cost).slice(0, 6)
    for (const m of used) {
      out.windows.push({
        name: shortModel(m.id),
        used: 0,
        aside: true,
        amount: round4(m.cost),
        unit: "usd",
        display: `${money(m.cost)} · ${compact(m.in + m.out)} tokens · ${m.calls} 次`,
        model: m.id,
      })
    }
  }

  if (!(snap.windows["30d"]?.calls > 0)) out.error = "官方账本里近 30 天还没有调用记录"
  return out
}

/**
 * auth.usage 的返回值。
 * 两条路：
 *   1. 给了控制台会话（登录时填 / 选项 consoleSession）→ 官方余额与官方计费，单位美元；
 *   2. 没给 → 按本机 usage.jsonl 估算，只报用量（aside，不影响可用性）。
 * 选项 budget（每月美元）/ budgetDaily（每日美元）只作用于估算那条路。
 */
async function usage(directory, settings = {}, auth = null) {
  const withModels = settings.perModel !== false
  const session = sessionOf(auth, settings)

  // 有控制台会话：走官方余额与官方计费
  if (session) {
    try {
      return officialUsage(await consoleSnapshot(session), withModels)
    } catch (e) {
      const why = String(e?.message ?? e)
      const fallback = await localEstimate(directory, settings, withModels, session)
      fallback.error = `官方接口读不到（${why}），下面退回本地估算`
      return fallback
    }
  }

  return localEstimate(directory, settings, withModels, session)
}

/** 本地账本估算（没有控制台会话时的默认路径） */
async function localEstimate(directory, settings = {}, withModels = true, session = null) {
  const budget = Number(settings.budget) > 0 ? Number(settings.budget) : 0
  const budgetDaily = Number(settings.budgetDaily) > 0 ? Number(settings.budgetDaily) : 0
  let data
  try {
    data = await localUsage(directory)
  } catch (e) {
    return { windows: [], error: "读不到 magpie 的用量账本：" + String(e?.message ?? e) }
  }
  const windows = []
  /** 有预算就按预算算百分比，没有就是纯用量 */
  const budgeted = (name, s, cap, extra) => {
    if (!(cap > 0)) return usageWindow(name, s, extra)
    return {
      name,
      used: pct(s.cost, cap),
      display: `${money(s.cost)} / ${money(cap)} · ${compact(s.in + s.out)} tokens · ${s.calls} 次`,
      amount: Math.round(s.cost * 1e4) / 1e4,
      limit: cap,
      unit: "usd",
      ...extra,
    }
  }
  windows.push(budgeted("今日（本地估算）", data.today, budgetDaily, { resetSecs: 86400, span: 86400 }))
  windows.push(budgeted("近 7 天（本地估算）", data["7d"], budget > 0 ? budget / 4 : 0, { span: 7 * 86400 }))
  windows.push(budgeted("近 30 天（本地估算）", data["30d"], budget, { span: 30 * 86400 }))

  const out = {
    plan: budget > 0 ? "按 key 计费 · 预算为自设，用量为本地估算" : "按 key 计费 · 用量为本地估算",
    windows,
  }

  // 分模型明细：只列出用过的，按 token 排序
  if (withModels) {
    const used = [...data["30d"].models.values()].sort((a, b) => b.in + b.out - (a.in + a.out)).slice(0, 6)
    for (const m of used) {
      out.windows.push({
        name: shortModel(m.id),
        used: 0,
        aside: true,
        display: `${compact(m.in + m.out)} tokens · ${m.calls} 次 · 约 ${money(m.cost)}`,
        amount: m.in + m.out,
        unit: "tokens",
        model: m.id,
      })
    }
  }

  if (!data.all.calls) {
    out.error = "还没有本供应商的请求记录：先用任意一个模型跑一次，用量就会出现在这里"
  } else if (data["30d"].errors > 0) {
    out.error = `近 30 天有 ${data["30d"].errors} 次请求失败（见 magpie 日志）`
  }
  return out
}

// ---- 插件 --------------------------------------------------------------------

export async function SystalyzePlugin({ client, directory } = {}, options = {}) {
  const settings = { localUsage: true, perModel: true, budget: 0, budgetDaily: 0, consoleSession: "", ...options }
  const base = BASE_URL
  const id = PROVIDER

  return {
    // 供应商级别名、图标与默认模型表（用户自带配置优先）
    config(cfg) {
      cfg.provider ??= {}
      const was = cfg.provider[id] ?? {}
      cfg.provider[id] = {
        ...was,
        name: was.name ?? "Systalyze",
        npm: was.npm ?? CHAT,
        api: was.api ?? base,
        models: { ...configModels(), ...(was.models ?? {}) },
      }
      return cfg
    },

    auth: {
      provider: id,
      methods: [
        {
          type: "api",
          label: "Systalyze API key",
          placeholder: "stlzi_…",
          prompts: [
            {
              type: "text",
              key: "name",
              message: "账号备注名（留空则用密钥末四位）",
              placeholder: "",
            },
            {
              type: "password",
              key: "console",
              message: "控制台 session cookie（可选：粘上就显示官方余额与真实计费，留空则只用本地估算）",
              placeholder: "__Secure-better-auth.session_token=…",
            },
          ],
        },
      ],

      // 每个账号一次：返回 SDK 的基地址与密钥
      async loader(getAuth) {
        const auth = await getAuth()
        if (auth?.type !== "api" || !auth.key) return {}
        return {
          baseURL: base,
          apiKey: auth.key,
          headers: { [CLIENT_HEADER]: `magpie/${VERSION}` },
        }
      },

      // 账号行上显示的用量
      async usage(getAuth) {
        const auth = await getAuth()
        if (auth?.type !== "api" || !auth.key) return { windows: [], error: "未登录" }
        const session = sessionOf(auth, settings)
        if (!settings.localUsage && !session) return { windows: [] }
        const user = auth?.metadata?.name || `key …${String(auth.key).slice(-4)}`
        try {
          const out = await usage(directory, settings, auth)
          return { user: out.user || user, ...out }
        } catch (e) {
          return { user, windows: [], error: String(e?.message ?? e) }
        }
      },
    },

    provider: {
      id,
      // 每个账号一次：以真接口的 id 列表为准，套用预置能力表
      async models(provider, { auth } = {}) {
        // 没登录（或账号不是 api 类型）：直接给预置表，形状必须和真接口那条路一样
        if (auth?.type !== "api" || !auth.key) return presetRuntimeModels(id, base)
        try {
          const ids = await fetchModelIds(base, auth.key)
          const out = {}
          for (const mid of ids) out[mid] = runtimeModel(mid, id, base)
          return out
        } catch (e) {
          if (e?.signIn) throw e
          // 拿不到列表就退回预置表，标记 fallback 让 magpie 不缓存太久
          const list = presetRuntimeModels(id, base)
          try {
            list[Symbol.for("magpie.fellBack")] = true
          } catch {}
          return list
        }
      },
    },

    // 每个请求带的客户端标识（网关不校验，只用于上游统计）
    async "chat.headers"(input, output) {
      if (input?.model?.providerID !== id && input?.provider?.info?.id !== id) return
      output.headers ??= {}
      output.headers[CLIENT_HEADER] = `magpie/${VERSION}`
    },
  }
}

/** 只做模型表的插件入口（没有 key 也能看 10 个模型） */
export async function SystalyzeModels({ client } = {}, options = {}) {
  const hooks = await SystalyzePlugin({ client }, options)
  delete hooks.auth
  return hooks
}

// 辅助函数挂在 _internal 上：入口文件导出的每个函数都会被当作插件调用
export const _internal = {
  BASE_URL,
  CLIENT_HEADER,
  EFFORTS,
  NPM,
  PRESET_MODELS,
  VERSION,
  capabilityTable,
  configModels,
  presetRuntimeModels,
  fetchModelIds,
  genericModel,
  prettyName,
  runtimeModel,
  configModel,
  localEstimate,
  officialUsage,
  sessionOf,
  usage,
  variants,
}
