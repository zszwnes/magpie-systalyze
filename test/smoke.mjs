// 冒烟测试：不联网也能验证插件契约（hooks 形状、模型表、用量窗口）。
// 联网部分单独跑：REAL_KEY=stlzi_… node test/smoke.mjs
import { PRESET_MODELS, EFFORTS, BASE_URL, PROVIDER, VERSION } from "../models.mjs"
import { SystalyzePlugin, SystalyzeModels, _internal } from "../index.mjs"
import { windowsOf, costOf, summarize, when } from "../usage-store.mjs"

let failed = 0
const ok = (cond, msg) => {
  if (cond) console.log("  ok   " + msg)
  else {
    failed += 1
    console.log("  FAIL " + msg)
  }
}

console.log("models.mjs")
const ids = Object.keys(PRESET_MODELS)
ok(ids.length === 10, `10 个预置模型（实际 ${ids.length}）`)
ok(ids.every((id) => id.includes("/")), "id 都是 org/model 形式")
ok(ids.every((id) => PRESET_MODELS[id].limit.context > 0), "每个模型都有 context 上限")
ok(ids.every((id) => PRESET_MODELS[id].cost.input >= 0), "每个模型都有价格表")
ok(EFFORTS.join() === "low,medium,high", "推理档位为 low/medium/high")

console.log("index.mjs")
const hooks = await SystalyzePlugin({ client: {}, directory: "/tmp/magpie-none" }, {})
ok(typeof hooks.config === "function", "有 config 钩子")
ok(typeof hooks.auth.loader === "function", "有 auth.loader")
ok(typeof hooks.auth.usage === "function", "有 auth.usage")
ok(typeof hooks.provider.models === "function", "有 provider.models")
ok(typeof hooks["chat.headers"] === "function", "有 chat.headers")
ok(hooks.auth.provider === PROVIDER, "auth.provider 与供应商 id 一致")
ok(Object.keys(hooks).every((k) => ["config", "auth", "provider", "chat.headers"].includes(k)), "只返回 magpie 认识的钩子")

const cfg = hooks.config({})
const p = cfg.provider[PROVIDER]
ok(p.name === "Systalyze" && p.api === BASE_URL, "config 填入名称与基地址")
ok(Object.keys(p.models).length === 10, "config 填入 10 个模型")
ok(p.models[ids[0]].provider.npm === "@ai-sdk/openai-compatible", "模型走 chat completions")

// loader：有 key 时给 baseURL+apiKey，无 key 时给空对象
const l1 = await hooks.auth.loader(async () => ({ type: "api", key: "stlzi_test" }))
ok(l1.baseURL === BASE_URL && l1.apiKey === "stlzi_test", "loader 返回 baseURL 与 apiKey")
ok(l1.headers[_internal.CLIENT_HEADER].includes(VERSION), "loader 带客户端标识头")
const l2 = await hooks.auth.loader(async () => ({ type: "oauth", key: "x" }))
ok(Object.keys(l2).length === 0, "非 api 类型的账号 loader 返回空对象")

// chat.headers 只对本供应商生效
const out = { headers: {} }
await hooks["chat.headers"]({ model: { providerID: "other" } }, out)
ok(!out.headers[_internal.CLIENT_HEADER], "别的供应商不写头")
const out2 = { headers: {} }
await hooks["chat.headers"]({ model: { providerID: PROVIDER } }, out2)
ok(out2.headers[_internal.CLIENT_HEADER].includes(VERSION), "本供应商写客户端标识头")

// usage：目录不存在时应给出空窗口而不是抛错
const u = await hooks.auth.usage(async () => ({ type: "api", key: "stlzi_test" }))
ok(Array.isArray(u.windows) && u.windows.length >= 3, "usage 返回 3 个基础窗口")
ok(u.windows.every((w) => typeof w.name === "string" && typeof w.display === "string"), "窗口带 name/display")
ok(u.windows.every((w) => w.aside === true), "窗口是 aside（不限制使用）")

console.log("usage-store.mjs")
const now = Date.parse("2026-10-27T09:00:00+08:00")
const w = windowsOf(now)
ok(w.map((x) => x.key).join() === "today,7d,30d", "三个窗口 today/7d/30d")
ok(w[0].start <= now && now < w[0].end, "今天窗口覆盖 now")
ok(when("2026-10-27T09:00:00+08:00") === now, "ISO 时间能解析")
ok(when(1761526800) === 1761526800000, "秒级时间戳能解析")
ok(Math.round(costOf(ids[0], 1e6, 0, 0) * 100) / 100 === PRESET_MODELS[ids[0]].cost.input, "费用按百万 token 计算")
const rows = [
  { at: now, model: ids[0], in: 1000, out: 500, cacheRead: 0, cacheWrite: 0, ms: 10, status: 200, probe: false },
  { at: now, model: ids[0], in: 0, out: 0, cacheRead: 0, cacheWrite: 0, ms: 1, status: 500, probe: false },
  { at: now, model: "", in: 0, out: 0, cacheRead: 0, cacheWrite: 0, ms: 1, status: 200, probe: true },
]
const s = summarize(rows, w[0].start, now)
ok(s.calls === 2 && s.errors === 1, "统计调用与失败次数")
ok(s.probe === undefined, "不统计探测行")
ok(s.in === 1000 && s.out === 500, "统计 token")
ok(s.models.get(ids[0]).calls === 2, "按模型归集")

console.log("只读插件入口")
const m = await SystalyzeModels({ client: {} }, {})
ok(!m.auth && !!m.provider, "不注册账号、只给模型表")

if (process.env.REAL_KEY) {
  console.log("真接口")
  const real = await hooks.provider.models({ models: {} }, { auth: { type: "api", key: process.env.REAL_KEY } })
  ok(Object.keys(real).length > 0, `拿到 ${Object.keys(real).length} 个模型`)
  for (const [mid, mm] of Object.entries(real)) {
    ok(mm.limit.context > 0 && mm.api.npm === "@ai-sdk/openai-compatible", `${mid} 结构完整`)
  }
}

console.log(failed ? `\n${failed} 项失败` : "\n全部通过")
process.exit(failed ? 1 : 0)
