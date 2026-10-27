# 变更记录 / Changelog

## 0.1.2

- 用量窗口不再带假的 `0%`：magpie 只在窗口有 `amount`/`limit` 时才画百分比，所以今日 / 近 7 天 / 近 30 天
  与分模型窗口现在只给 `display`（金币数、token、次数原样输出）。余额窗口保留真实百分比。
- 估算分支的 `amount` 也去掉了；预算（`budget`/`budgetDaily`）仍然是真正的百分比窗口。
- 新增 3 条断言：没有上限的窗口不得带 `amount`/`limit`。
- 网关 `/v1/magpie/quotas` 的窗口现在没有 `amount`，需要金额请读 `display` 或走官方余额窗口。

## 0.1.1

官方余额与真实计费 / Official balance and real billing.

- 新增 `console-usage.mjs`：用控制台会话 cookie（`__Secure-better-auth.session_token`）读
  `console.systalyze.com` 的 `/api/v1/me`、`/tenants/<tenant>/billing`、`/billing/grants`、
  `/projects/<project>/inference-usage`，得到官方余额、授信总额、今日 / 7 天 / 30 天真实调用与花费、
  分模型明细。60 秒缓存，会话过期（401）时报错可读。
- 登录多问一项：控制台 session cookie（可留空），存在账号的 `metadata.console`。三种粘贴形式都认：
  完整 cookie 头、只贴值、只贴 `name=value`。
- 新选项 `consoleSession`：直接给会话 cookie，优先级高于登录时存的那份。
- `auth.usage` 分两条路：有会话走官方数据（余额窗口 `unit: usd`、上限是授信总额，另有三个官方美元
  窗口 + 分模型窗口）；没会话走本地账本估算（行为与 0.1.0 一致）。官方接口失败时退回估算，并把原因写进
  `error`，不会中断。
- `localUsage` 与预算选项只管估算分支。
- `test/smoke.mjs` 增加 17 项 `console-usage.mjs` 断言（会话归一化、余额窗口、官方窗口、回退）。
- `e2e.sh` 支持 `SYSTALYZE_CONSEC`，登录时一并带上会话。

## 0.1.0

首个版本 / First release.

- 预置 Systalyze 的 10 个模型：上下文/输出上限、视觉、思考档位、每百万 token 参考价（`models.mjs`）。
- `config` 钩子注入 provider `systalyze`（`@ai-sdk/openai-compatible`，`https://inference.systalyze.com/v1`）。
- `auth`：账号登录（`stlzi_` key）、loader 注入 key 与 `x-systalyze-client` 头、用量窗口。
- `provider.models` 拉真实 `GET /v1/models`，失败退回预置表并打 `magpie.fellBack` 标记。
- 用量来自 magpie 自己的 `usage.jsonl`：今日 / 近 7 天 / 近 30 天 token、次数与估算花费；
  选项 `localUsage`、`perModel`、`budget`、`budgetDaily`。
- `test/smoke.mjs` 离线冒烟（31 项断言），`REAL_KEY` 存在时追加真接口校验。
