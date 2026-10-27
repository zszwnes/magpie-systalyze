// 本地用量账本：供应商没有任何用量接口（/v1/usage、/v1/me、/v1/balance、
// /v1/quota… 全部 404 "unknown route"；console.systalyze.com 是另一套登录态，
// inference key 打过去 401），所以额度只能从 magpie 自己的 usage.jsonl 里算。
//
// usage.jsonl 每行一次请求，本供应商的行形如：
//   {provider:"systalyze", host:"inference.systalyze.com", model:"zai-org/GLM-5.3-Flash",
//    in:438, out:309, cache_read:57088, cache_write:0, status:200, ms:7931, t:"2026-10-17T21:44:55.8+08:00"}
// 没有 credits 字段（那是内置订阅才写的），所以费用按 models.mjs 的价格表估算。

import { readFile, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

import { presetOf, prettyName } from "./models.mjs"

/** 认哪些行算本供应商：插件 id、被占用后改名的 id、用户手配时的 host 名 */
export const OWN_IDS = ["systalyze", "systalyze-plugin", "inference.systalyze.com"]
export const OWN_HOST = "inference.systalyze.com"

const DAY = 24 * 60 * 60 * 1000

/** usage.jsonl 的位置：magpie 配置目录优先，否则 ~/.config/magpie */
export function ledgerPath(directory) {
  return join(directory || join(homedir(), ".config", "magpie"), "usage.jsonl")
}

// 文件可能几 MB（本机 9000+ 行），按 size+mtime 缓存解析结果
let cache = { key: "", rows: [] }

export async function readRows(file) {
  let info
  try {
    info = await stat(file)
  } catch {
    return []
  }
  const key = `${file}:${info.size}:${info.mtimeMs}`
  if (cache.key === key) return cache.rows
  let text
  try {
    text = await readFile(file, "utf8")
  } catch {
    return []
  }
  const rows = []
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    let row
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (!mine(row)) continue
    const at = when(row.t)
    if (!at) continue
    rows.push({
      at,
      model: String(row.model || row.served || ""),
      in: num(row.in),
      out: num(row.out),
      cacheRead: num(row.cache_read),
      cacheWrite: num(row.cache_write),
      ms: num(row.ms),
      status: num(row.status),
      ep: String(row.ep || ""),
      // 探测产生的 model_list 行不算调用
      probe: row.kind === "model_list" || row.source === "probe" || !row.model,
    })
  }
  cache = { key, rows }
  return rows
}

function mine(row) {
  const p = String(row.provider || "")
  if (OWN_IDS.includes(p)) return true
  return String(row.host || "") === OWN_HOST
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** t 可能是 ISO 字符串，也可能是秒/毫秒时间戳 */
export function when(t) {
  if (typeof t === "number" && Number.isFinite(t)) return t < 1e12 ? t * 1000 : t
  if (typeof t === "string" && t) {
    const n = Date.parse(t)
    if (Number.isFinite(n)) return n
  }
  return 0
}

/** 一次请求的估算费用（美元） */
export function costOf(model, inTok, outTok, cacheRead) {
  const c = presetOf(model)?.cost ?? { input: 0, output: 0, cache_read: 0 }
  const at = (tokens, price) => (tokens * price) / 1e6
  return at(inTok, c.input) + at(outTok, c.output) + at(cacheRead, c.cache_read ?? 0)
}

/** 从 start 到 now 的汇总 */
export function summarize(rows, start, now) {
  const s = {
    calls: 0,
    errors: 0,
    in: 0,
    out: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    ms: 0,
    models: new Map(),
  }
  for (const r of rows) {
    if (r.probe || r.at < start || r.at > now) continue
    s.calls += 1
    if (r.status >= 400) s.errors += 1
    s.in += r.in
    s.out += r.out
    s.cacheRead += r.cacheRead
    s.cacheWrite += r.cacheWrite
    s.ms += r.ms
    const cost = costOf(r.model, r.in, r.out, r.cacheRead)
    s.cost += cost
    const m = s.models.get(r.model) ?? { id: r.model, calls: 0, in: 0, out: 0, cacheRead: 0, cost: 0 }
    m.calls += 1
    m.in += r.in
    m.out += r.out
    m.cacheRead += r.cacheRead
    m.cost += cost
    s.models.set(r.model, m)
  }
  return s
}

/** 今天零点（本地时区） */
export function startOfDay(now) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 本地午夜的下一个整点，作为窗口重置时间 */
export function nextMidnight(now) {
  const d = new Date(now)
  d.setHours(24, 0, 0, 0)
  return d.getTime()
}

/** 各窗口的起点：today / 7d / 30d，全部以现在为终点 */
export function windowsOf(now) {
  return [
    { key: "today", start: startOfDay(now), end: nextMidnight(now), span: 86400 },
    { key: "7d", start: startOfDay(now) - 6 * DAY, end: nextMidnight(now), span: 7 * 86400 },
    { key: "30d", start: startOfDay(now) - 29 * DAY, end: nextMidnight(now), span: 30 * 86400 },
  ]
}

/** 读整个账本并按窗口汇总，供 auth.usage 使用 */
export async function localUsage(directory, now = Date.now()) {
  const rows = await readRows(ledgerPath(directory))
  const out = {}
  for (const w of windowsOf(now)) out[w.key] = { ...w, ...summarize(rows, w.start, now) }
  // 全历史，只用来判断「有没有用过」
  out.all = summarize(rows, 0, now)
  return out
}

export function shortModel(id) {
  return prettyName(id) || "unknown"
}
