[English](./README.en.md)

<!-- banner -->

# magpie-systalyze

<a href="https://github.com/zwnes/magpie-systalyze"><img src="https://img.shields.io/badge/Star-on%20GitHub-f5c518?style=for-the-badge&logo=github" alt="Star on GitHub" height="48"></a>

把 [Systalyze](https://systalyze.com)（`https://inference.systalyze.com/v1`）接成 [magpie](https://github.com/yetone/magpie) 的 provider：
它服务的 10 个模型全部预置好能力表和价格，登录一次就能在 magpie、Codex、OpenCode 里用；
用量按本机 magpie 的账本估算，显示在账号行、`magpie quota` 和网关的 `/v1/magpie/quotas` 上。

- **模型**：`GET /v1/models` 列出的 10 个模型全部预置（`models.mjs`），带上下文/输出上限、是否视觉、是否思考、思考档位 `low`/`medium`/`high` 和每百万 token 的参考价。运行时仍以真实接口为准：新上线的模型自动出现，接口挂了退回预置表。
- **接口形状**：全部走 `/v1/chat/completions`（`@ai-sdk/openai-compatible`）。供应商另有两种形状 `/v1/responses`、`/v1/messages` 也可用，但 chat 对 10 个模型都稳，不需要按模型分 API。
- **用量**：供应商没有任何额度接口（见下），所以用量来自 magpie 自己的 `usage.jsonl`：按今天 / 7 天 / 30 天汇总 token，乘 `models.mjs` 的价格估算花费。可以在选项里设预算，把估算变成真正的额度窗口，用超了路由会绕开。

## 为什么用量是估算

供应商只暴露四个接口：`/v1/models`、`/v1/chat/completions`、`/v1/responses`、`/v1/messages`。
下面这些全部 404 `{"error":{"message":"unknown route"}}`：

`/v1/usage`、`/v1/me`、`/v1/balance`、`/v1/credits`、`/v1/quota`、`/v1/subscription`、
`/v1/account`、`/v1/key`、`/v1/user`、`/v1/keys/me`、`/v1/limits/me`、`/v1/rate-limits`、
`/v1/whoami`、`/v1/profile`、`/v1/plan`、`/v1/stats`、`/v1/billing`、`/v1/spend`、
`/v1/dashboard/billing/*`、`/openapi.json`、`/docs`、`/swagger.json`。

响应头里也没有配额/余额字段（只有 Cloudflare 的头）。控制台 `console.systalyze.com` 是**另一套登录体系**：
拿 inference key 打它的 `/api/v1/me` 得到 `401 {"error":{"code":"API401"}}`，插件读不到。

所以 magpie 给自定义 provider 配 `balance=/v1/usage` 这条路在这里不成立。本插件改为读 magpie 自己的账本
（`~/.config/magpie/usage.jsonl`）：筛出 `provider` 为 `systalyze` / `systalyze-plugin`、或 `host` 为
`inference.systalyze.com` 的行，按窗口汇总；探测产生的 `kind:"model_list"` 行会被排除。

好处是不需要额外权限、不联网、每台机器只看自己；代价是**别的客户端（curl、别的工具）的用量不在这里**，且价格是估算。

## 安装

在 magpie 应用里：**插件 › 发现 › 非官方插件 · GitHub**，搜 `systalyze`。

或者用命令行（本仓库打了 `magpie-plugin` topic）：

```sh
magpie plugin add github:zwnes/magpie-systalyze
```

也可以在本仓库目录里：

```sh
magpie plugin add ./
```

## 登录

```sh
magpie plugin login systalyze
```

问一项：账号备注名（可留空），然后粘贴 `stlzi_` 开头的 key。留空时账号显示为 `key …末四位`。

```sh
magpie provider test systalyze  # 冒烟：一次真实的 chat 请求
magpie quota systalyze          # 看用量窗口
magpie models | grep systalyze  # 看模型
```

## 模型

`GET /v1/models` 的 10 个模型全部预置（`models.mjs`），字段来自真实接口探测：

| 模型 | context | 输出上限 | 视觉 | 价格 $/M（入 / 出 / 缓存读） |
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

- 全部支持工具调用和推理；推理档位是 `low` / `medium` / `high`（实测 `reasoning_effort` 也接受
  `minimal`/`xhigh`/`max`，但为保守取公共子集）。
- 价格是**上游公开报价的估算**——供应商不公布价格。改 `models.mjs` 的 `cost` 即改费率。
- 运行时以 `GET /v1/models` 的真实列表为准；新模型按 `genericModel()` 给保守默认值，接口挂了就退回预置表
  并打上 `magpie.fellBack` 标记，让 magpie 不要缓存太久。

## 用量窗口

默认是三个 `aside` 窗口——**只展示用量，不限制你能不能用**：

| 窗口 | 内容 |
|---|---|
| 今日 | 今天的 token 数、调用次数、估算花费 |
| 近 7 天 | 同上，7 天 |
| 近 30 天 | 同上，30 天 |

`perModel` 打开时（默认开），还会列出近 30 天用过的前 6 个模型，各一条。

在选项里给了预算，对应窗口就变成真正的百分比窗口（`unit: usd`），用超了 magpie 会绕开这个账号：

```sh
magpie plugin options magpie-systalyze '{"budget":10,"budgetDaily":1}'
```

## 选项

| 选项 | 默认 | 说明 |
|---|---|---|
| `localUsage` | `true` | 关掉就不显示任何用量窗口 |
| `perModel` | `true` | 近 30 天里按模型再列最多 6 条 |
| `budget` | `0` | 月度预算（美元）。`>0` 时 30 天窗口变成百分比窗口，7 天按预算的 1/4 |
| `budgetDaily` | `0` | 每日预算（美元）。`>0` 时今日窗口变成百分比窗口 |

## 插件结构

| 文件 | 作用 |
|---|---|
| `index.mjs` | 插件入口：`config` / `auth`(methods, loader, usage) / `provider.models` / `chat.headers`；辅助函数挂在 `_internal` 上（入口文件导出的每个函数都会被当插件调用） |
| `models.mjs` | 10 个模型的预置能力与价格表 |
| `usage-store.mjs` | 读 `usage.jsonl`、按窗口汇总、算钱（按 size+mtime 缓存解析结果） |
| `test/smoke.mjs` | 离线冒烟；`REAL_KEY=stlzi_… node test/smoke.mjs` 追加真接口校验 |
| `test/seed-usage.mjs` | 往沙箱的 `usage.jsonl` 塞几条合成用量，好让窗口有数字 |
| `e2e.sh` | 手动验证：在沙箱里跑真实 magpie |

## 开发与测试

```sh
npm test                          # 离线冒烟，不需要网络和 key
REAL_KEY=stlzi_… npm test         # 追加真接口校验（10 个模型）
```

用真实 magpie 手动验证（沙箱在 `.e2e/`，不碰你自己的 magpie 配置）：

```sh
SYSTALYZE_KEY=stlzi_… ./e2e.sh          # 装插件、登录、看模型、跑一次真实请求
SEED=1 SYSTALYZE_KEY=stlzi_… ./e2e.sh   # 另往沙箱账本里塞几条合成用量，看窗口动起来
```

沙箱里的账本是空的，所以不塞 `SEED=1` 时三个窗口都是 `0 tokens · 0 次`。

发版流程见 [RELEASE.md](./RELEASE.md)。

## 已知行为

- 供应商 id 与用户手配的 provider 同名时，magpie 会把插件供应商改名成 `systalyze-plugin`；
  用量统计已把两个 id 和 host 名都算进来。
- 偶发 `503 {"error":{"message":"the model \`X\` is unavailable"}}`（GLM-5.3、Kimi-K3 各见过一次），
  重试即可；非法 `reasoning_effort` 值也表现为 503 而不是 400。
- 推理内容字段不统一：`deepseek-*` 用 `message.reasoning_content`，其余用 `message.reasoning`；
  网关会转换，插件按模型分别声明 `interleaved.field`。
- 失败请求（`status >= 400`）也计入次数并在窗口的 `error` 里提示，但不产生费用。

## 许可证

MIT