# 变更记录 / Changelog

## 0.1.0

首个版本 / First release.

- 预置 Systalyze 的 10 个模型：上下文/输出上限、视觉、思考档位、每百万 token 参考价（`models.mjs`）。
- `config` 钩子注入 provider `systalyze`（`@ai-sdk/openai-compatible`，`https://inference.systalyze.com/v1`）。
- `auth`：账号登录（`stlzi_` key）、loader 注入 key 与 `x-systalyze-client` 头、用量窗口。
- `provider.models` 拉真实 `GET /v1/models`，失败退回预置表并打 `magpie.fellBack` 标记。
- 用量来自 magpie 自己的 `usage.jsonl`：今日 / 近 7 天 / 近 30 天 token、次数与估算花费；
  选项 `localUsage`、`perModel`、`budget`、`budgetDaily`。
- `test/smoke.mjs` 离线冒烟（31 项断言），`REAL_KEY` 存在时追加真接口校验。
