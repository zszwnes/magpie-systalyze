// 官方余额与官方用量：console.systalyze.com 的 better-auth 会话。
//
// 推理端点（inference.systalyze.com）没有余额接口：/v1/usage、/v1/credits、
// /v1/balance、/v1/me、/v1/dashboard/billing/credit_grants 全部 404，而且控制台
// 只认自己的登录态 —— 用 inference key 打 /api/v1/me 是 401（Bearer、x-api-key
// 都一样）。真实余额在另一套 API 上：https://console.systalyze.com/api/v1，
// 认证是会话 cookie __Secure-better-auth.session_token。
//
// 所以只有用户在登录时（或选项里）显式给了控制台会话，这里才去读官方数据；
// 没给的时候 index.mjs 用本机 usage.jsonl 估算，不需要外网。

export const CONSOLE_BASE = "https://console.systalyze.com/api/v1"
export const SESSION_COOKIE = "__Secure-better-auth.session_token"

const TIMEOUT = 8000
const TTL = 60_000
const DAY = 24 * 60 * 60 * 1000

/**
 * 接受三种粘贴形式：
 *   1. 完整 cookie 头：__Secure-better-auth.session_token=xxx; 其他=yyy
 *   2. 只贴 session_token 的值（79 字符左右，浏览器 DevTools 里那一串）
 *   3. 只贴 name=value（没有分号）
 * 返回可直接放进 cookie 头的字符串；空输入返回 ""。
 */
export function normalizeSession(raw) {
  if (typeof raw !== "string") return ""
  const s = raw.trim().replace(/^cookie:\s*/i, "")
  if (!s) return ""
  // 多行粘贴：合并成一行
  const one = s.split(/[\r\n]+/).map((x) => x.trim()).filter(Boolean).join("; ")
  if (!one) return ""
  if (one.includes("=")) return one
  return SESSION_COOKIE + "=" + one
}

/** 会话从哪来：选项 consoleSession 优先，其次是登录时存的 metadata */
export function sessionOf(auth, settings = {}) {
  const fromSettings = normalizeSession(settings?.consoleSession)
  if (fromSettings) return fromSettings
  const meta = auth?.metadata ?? {}
  return normalizeSession(meta.console ?? meta.consoleSession ?? meta.cookie)
}

function hash(s) {
  let h = 5381
  for (let i = 0; i < s.length; i += 1) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

// 同一个会话的同一路径 60 秒内只打一次：账号列表会反复问用量
const cache = new Map()

async function getJSON(path, session) {
  const key = hash(session) + " " + path
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit.value
  let res
  try {
    res = await fetch(CONSOLE_BASE + path, {
      headers: { cookie: session, accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT),
    })
  } catch (e) {
    throw new Error("连不上 console.systalyze.com（" + String(e?.message ?? e) + "）")
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error("控制台会话已过期或无效，请重新粘贴 cookie")
  }
  if (!res.ok) throw new Error("控制台返回 " + res.status)
  let body
  try {
    body = await res.json()
  } catch {
    throw new Error("控制台返回的不是 JSON")
  }
  if (body?.error) throw new Error("控制台错误：" + (body.error.message ?? body.error.code ?? "unknown"))
  const value = body?.data
  cache.set(key, { at: Date.now(), value })
  // 别让缓存无限长
  if (cache.size > 64) cache.delete(cache.keys().next().value)
  return value
}

const micro = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n / 1e6 : 0
}

function sumBuckets(list) {
  const s = { calls: 0, in: 0, out: 0, cacheRead: 0, cost: 0 }
  for (const b of list) {
    s.calls += Number(b?.requests) || 0
    s.in += Number(b?.promptTokens) || 0
    s.out += Number(b?.completionTokens) || 0
    s.cacheRead += Number(b?.promptCachedTokens) || 0
    s.cost += micro(b?.chargeMicroUsd)
  }
  return s
}

/** 本地时区的 YYYY-MM-DD，用来和 day 分桶的 group 比较 */
export function ymd(ms) {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, "0")
  return p(d.getFullYear()) + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate())
}

/**
 * 取一次官方快照。返回：
 *   { email, tenantId, projectId, balance:{remaining, granted},
 *     windows:{today, "7d", "30d"} }
 * 只取按天的分桶，不请求分模型明细。
 * 会话无效时抛错（调用方负责回退到本地估算）。
 */
export async function consoleSnapshot(session, now = Date.now()) {
  if (!session) throw new Error("没有控制台会话")
  const me = await getJSON("/me", session)
  const tenantId = me?.activeTenantId
  const projectId = me?.activeProjectId
  if (!tenantId || !projectId) throw new Error("控制台会话读不到 activeTenantId / activeProjectId")

  const from = new Date(now - 30 * DAY).toISOString()
  const to = new Date(now).toISOString()
  const usagePath = (groupBy) =>
    "/projects/" + projectId + "/inference-usage?groupBy=" + groupBy +
    "&from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to)

  // 只取按天的分桶：分模型明细不请求（卡片上不展示，少打一次接口）
  const [billing, grants, days] = await Promise.all([
    getJSON("/tenants/" + tenantId + "/billing", session),
    getJSON("/tenants/" + tenantId + "/billing/grants", session).catch(() => []),
    getJSON(usagePath("day"), session),
  ])

  const remaining = micro(billing?.balance?.availableMicroUsd ?? billing?.free?.remainingMicroUsd)
  let granted = 0
  for (const g of Array.isArray(grants) ? grants : []) granted += micro(g?.amountMicroUsd)
  if (!(granted > 0)) granted = micro(billing?.free?.creditMicroUsd)

  const buckets = Array.isArray(days?.buckets) ? days.buckets : []
  const today = ymd(now)
  const start7 = ymd(now - 6 * DAY)
  const pick = (fn) => sumBuckets(buckets.filter((b) => fn(String(b?.group ?? ""))))

  return {
    email: me?.email || "",
    tenantId,
    projectId,
    balance: { remaining, granted },
    windows: {
      today: pick((g) => g === today),
      "7d": pick((g) => g >= start7),
      "30d": sumBuckets(buckets),
    },
  }
}
