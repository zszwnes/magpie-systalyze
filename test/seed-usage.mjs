// Fills a magpie config directory's usage ledger with a few synthetic rows,
// so the usage windows show numbers in a fresh sandbox (magpie's own ledger is
// the only source this plugin has: the vendor has no quota endpoint).
//
//   node test/seed-usage.mjs /path/to/sandbox
//
// e2e.sh calls it when SEED=1. Never point it at your own magpie config.
import { mkdirSync, writeFileSync } from "node:fs"

const sb = process.argv[2]
if (!sb) {
  console.error("usage: node test/seed-usage.mjs <magpie config dir>")
  process.exit(2)
}

const now = Date.now()
const rows = [
  // today: a big one, with cache reads
  { t: new Date(now - 3600e3).toISOString(), provider: "systalyze", model: "zai-org/GLM-5.3-Flash", in: 12500, out: 3400, cache_read: 80000, status: 200, ms: 900 },
  // yesterday: the plugin alias id, which counts too
  { t: new Date(now - 86400e3).toISOString(), provider: "systalyze-plugin", model: "deepseek-ai/DeepSeek-V4.1-Flash-1017", in: 4300, out: 900, cache_read: 0, status: 200, ms: 700 },
  // three days ago: a failure, matched by host rather than provider
  { t: new Date(now - 3 * 86400e3).toISOString(), host: "inference.systalyze.com", model: "zai-org/GLM-5.3", in: 100, out: 0, status: 503, ms: 300 },
  // a probe row: must not be counted
  { t: now / 1000, kind: "model_list", provider: "systalyze", model: "" },
]

mkdirSync(sb + "/.config/magpie", { recursive: true })
writeFileSync(sb + "/.config/magpie/usage.jsonl", rows.map((r) => JSON.stringify(r)).join("\n") + "\n")
console.log("seeded " + rows.length + " rows in " + sb + "/.config/magpie/usage.jsonl")
