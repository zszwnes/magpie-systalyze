[中文](./README.md)

<!-- banner -->

# magpie-systalyze

<a href="https://github.com/zwnes/magpie-systalyze"><img src="https://img.shields.io/badge/Star-on%20GitHub-f5c518?style=for-the-badge&logo=github" alt="Star on GitHub" height="48"></a>

[Systalyze](https://systalyze.com) (`https://inference.systalyze.com/v1`) as a provider in [magpie](https://github.com/yetone/magpie):
its 10 models ship with capabilities and prices, so one sign-in is enough to use them from magpie, Codex and OpenCode.
Usage is estimated from magpie's own ledger and shows on the account row, in `magpie quota`, and in the gateway's `/v1/magpie/quotas`.

- **Models**: all 10 of `GET /v1/models` are preset in `models.mjs`, with context and output limits, vision, reasoning, the `low`/`medium`/`high` effort levels, and a reference price per million tokens. At runtime the real endpoint still wins: new models appear on their own, and when the endpoint is down the preset table comes back.
- **API shape**: everything goes through `/v1/chat/completions` (`@ai-sdk/openai-compatible`). The vendor also serves `/v1/responses` and `/v1/messages`, but chat completions is the one shape that works for all 10 models, so there is no per-model API split.
- **Usage**: the vendor has no quota endpoint at all (see below), so usage comes from magpie's `usage.jsonl`: tokens summed per day / 7 days / 30 days, priced with the table in `models.mjs`. Set a budget in the options and the estimate turns into real percentage windows, which magpie's router steers around.

## Why usage is an estimate

The vendor exposes four endpoints: `/v1/models`, `/v1/chat/completions`, `/v1/responses`, `/v1/messages`.
All of the following answer 404 `{"error":{"message":"unknown route"}}`:

`/v1/usage`, `/v1/me`, `/v1/balance`, `/v1/credits`, `/v1/quota`, `/v1/subscription`,
`/v1/account`, `/v1/key`, `/v1/user`, `/v1/keys/me`, `/v1/limits/me`, `/v1/rate-limits`,
`/v1/whoami`, `/v1/profile`, `/v1/plan`, `/v1/stats`, `/v1/billing`, `/v1/spend`,
`/v1/dashboard/billing/*`, `/openapi.json`, `/docs`, `/swagger.json`.

No response header carries a quota or a balance either (only Cloudflare's). `console.systalyze.com` is **a separate
login system**: an inference key against its `/api/v1/me` gets `401 {"error":{"code":"API401"}}`, so the plugin can't read it.

That rules out magpie's built-in `balance=/v1/usage` for a custom provider. The plugin reads magpie's own ledger
(`~/.config/magpie/usage.jsonl`) instead: rows whose `provider` is `systalyze` / `systalyze-plugin`, or whose `host` is
`inference.systalyze.com`, summed per window; `kind:"model_list"` probe rows are skipped.

The upside: no extra permission, no network call, per machine. The cost: **other clients (curl, other tools) are not
counted here**, and the prices are estimates.

## Install

In the magpie app: **Plugins › Discover › Unofficial plugins · GitHub**, search `systalyze`.

Or from the command line (this repo carries the `magpie-plugin` topic):

```sh
magpie plugin add github:zwnes/magpie-systalyze
```

Or from a checkout:

```sh
magpie plugin add ./
```

## Sign in

```sh
magpie plugin login systalyze
```

It asks for an account name (optional) and then for the `stlzi_` key. Left empty, the account shows as `key …last4`.

```sh
magpie provider test systalyze  # one tiny real chat request
magpie quota systalyze          # the usage windows
magpie models | grep systalyze  # the models
```

## Models

All 10 models of `GET /v1/models` are preset in `models.mjs`; the fields come from probing the real endpoint:

| Model | context | output | vision | price $/M (in / out / cache read) |
|---|---|---|---|---|
| `deepseek-ai/DeepSeek-V4.1-Flash-1017` | 1,048,576 | 384,000 | ✓ | 0.30 / 1.20 / 0.006 |
| `deepseek-ai/DeepSeek-V4-Flash-0731` | 1,048,576 | 384,000 | — | 0.14 / 0.28 / 0.03 |
| `deepseek-ai/DeepSeek-V4-Pro-0813` | 1,048,576 | 384,000 | — | 1.32 / 3.96 / 0.13 |
| `zai-org/GLM-5.3` | 1,048,576 | 262,144 | — | 1.40 / 4.40 / 0.26 |
| `zai-org/GLM-5.3-Flash` | 1,048,576 | 262,144 | ✓ | 0.15 / 0.50 / 0.03 |
| `zai-org/GLM-5.2` | 1,048,576 | 262,144 | — | 1.40 / 4.40 / 0.26 |
| `moonshotai/Kimi-K3` | 1,048,576 | 131,072 | ✓ | 3.00 / 15.00 / 0.30 |
| `Qwen/Qwen3.8-27B` | 262,144 | 131,072 | ✓ | 0.40 / 3.00 / 0.04 |
| `google/gemma-4-26B-A4B-it` | 131,072 | 32,768 | ✓ | 0.13 / 0.40 / 0.05 |
| `meta-models/Muse-Glimmer-30B` | 131,072 | 32,768 | ✓ | 0.20 / 0.60 / 0.03 |

- All of them take tool calls and reason; the effort levels are `low` / `medium` / `high` (probing showed
  `reasoning_effort` also accepts `minimal`/`xhigh`/`max`, but the plugin keeps the common subset).
- The prices are **an estimate from public upstream list prices** — the vendor publishes none. Edit `cost` in
  `models.mjs` to change them.
- At runtime the real `GET /v1/models` list wins; a model it doesn't know gets `genericModel()`'s conservative
  defaults, and when the endpoint is down the preset table comes back with a `magpie.fellBack` mark so magpie
  doesn't cache it for long.

## Usage windows

By default there are three `aside` windows — **they show usage, they never stop you from using the key**:

| Window | Contents |
|---|---|
| Today | today's tokens, calls and estimated cost |
| Last 7 days | the same, over 7 days |
| Last 30 days | the same, over 30 days |

With `perModel` on (the default), the 6 most used models of the last 30 days are listed too, one window each.

Give a budget in the options and the matching windows become real percentage windows (`unit: usd`), and magpie's
router starts steering around an account that is over it:

```sh
magpie plugin options magpie-systalyze '{"budget":10,"budgetDaily":1}'
```

## Options

| Option | Default | Meaning |
|---|---|---|
| `localUsage` | `true` | Off: show no usage windows at all |
| `perModel` | `true` | Also list up to 6 models of the last 30 days |
| `budget` | `0` | Monthly budget in USD. `>0` turns the 30 day window into a percentage one, and 7 days uses a quarter of it |
| `budgetDaily` | `0` | Daily budget in USD. `>0` turns the today window into a percentage one |

## Layout

| File | What it does |
|---|---|
| `index.mjs` | The plugin: `config` / `auth`(methods, loader, usage) / `provider.models` / `chat.headers`; helpers hang off `_internal` (every function an entry file exports is called as a plugin) |
| `models.mjs` | The preset capabilities and prices of the 10 models |
| `usage-store.mjs` | Reads `usage.jsonl`, sums per window, prices it (parsed rows cached by size+mtime) |
| `test/smoke.mjs` | Offline smoke test; `REAL_KEY=stlzi_… node test/smoke.mjs` adds a check against the real endpoint |
| `test/seed-usage.mjs` | Puts a few synthetic rows in a sandbox's `usage.jsonl`, so the windows have numbers |
| `e2e.sh` | Manual check: this checkout in a real magpie, in a sandbox |

## Development

```sh
npm test                          # offline smoke test, no network, no key
REAL_KEY=stlzi_… npm test         # adds a check against the real endpoint (10 models)
```

Manual check with a real magpie (sandbox in `.e2e/`, your own config untouched):

```sh
SYSTALYZE_KEY=stlzi_… ./e2e.sh          # add the plugin, sign in, list models, one real request
SEED=1 SYSTALYZE_KEY=stlzi_… ./e2e.sh   # also puts a few synthetic rows in the sandbox ledger
```

A sandbox ledger starts empty, so without `SEED=1` all three windows read `0 tokens · 0 calls`.

Release steps: [RELEASE.md](./RELEASE.md).

## Known behaviour

- When a provider the user configured by hand already has the id, magpie renames the plugin's provider to
  `systalyze-plugin`; the usage sum counts both ids and the host name.
- Occasional `503 {"error":{"message":"the model \`X\` is unavailable"}}` (seen once each on GLM-5.3 and Kimi-K3) —
  retry. An invalid `reasoning_effort` also shows up as a 503 rather than a 400.
- The reasoning field isn't uniform: `deepseek-*` uses `message.reasoning_content`, the rest use
  `message.reasoning`; the gateway converts, and the plugin declares `interleaved.field` per model.
- Failed requests (`status >= 400`) count as calls and are reported in the windows' `error`, but cost nothing.

## License

MIT