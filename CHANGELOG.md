# 变更记录 / Changelog

## 0.2.0

卡片收窄成两行 / The card is down to two rows.

- **用量卡片只有「余额」和「今日消耗」两行**，其余全部去掉：官方分支不再返回近 7 天 / 近 30 天窗口，
  估算分支也一样；分模型明细两边都不再返回（`console-usage.mjs` 也不再请求
  `inference-usage?groupBy=model`，少打一次接口）。7 天 / 30 天 / 分模型这些统计 magpie 自己会从账本算，
  插件不重复报。
- 账号行不再显示 plan（magpie 只要看到 `plan` 和 `user` 就在账号行后面渲染它）。
- 两行都是 `aside`：余额仍带真实百分比（上限 = 授信总额），今日消耗只给 `display`。
- 去掉选项 `perModel`、`moreWindows`、`budget`（月度预算不再生成任何窗口）；保留 `localUsage`、
  `budgetDaily`、`consoleSession`。
- `test/smoke.mjs` 改成断言「只有两行」：官方分支 `windows` 恰为 `余额,今日（官方）`，估算分支恰为
  `今日（本地估算）`，并且没有任何窗口带 `model`。

## 0.1.3

插件图标换成官网的 / Use the official mark.

- `magpie.icon` 从自绘的 SVG 换成 `console.systalyze.com/favicon.svg` 原图（161×161，内联
  `prefers-color-scheme` 暗色自适应），现在「发现」卡片与「已安装」行显示的是官方图形。
- 无代码改动。

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
