# 项目 AI 用量与请求日志

仅在用户要求 token 看板、用量分析、请求分析或日报时读取本文件。只提供真实数据，不默认创建报表或定时任务。

## 网页 API

仅项目内的自有画布可调用。公开分享页（包括已登录的外部访客）不提供此接口。第三方画布不能使用万物 JS API。

```js
await Wanwu.ready;
const usage = await Wanwu.usage.summary({from:'2026-10-16', to:'2026-10-16'});
const page = await Wanwu.usage.requests({from:'2026-10-16', to:'2026-10-16', limit:50, includePrompt:true});
// 分页继续读取，不要只用第一页假装完整报告
const next = page.nextCursor
  ? await Wanwu.usage.requests({from:'2026-10-16', to:'2026-10-16', limit:50, includePrompt:true, cursor:page.nextCursor})
  : null;
```

对应成员 REST API（沿用当前登录授权，不把凭据写入网页）：

- `GET /api/projects/:projectId/ai-usage/summary`
- `GET /api/projects/:projectId/ai-usage/requests`

查询参数：`from`、`to` 为包含首尾的 `YYYY-MM-DD`；默认今天，时区固定 `Asia/Shanghai`，单次最多 93 天。可按 `userId`、`provider=wanwu|codex|claude|dsh`、`model` 筛选。明细支持 `limit=1..200`、`cursor`、`includePrompt=true`（默认不返回问题内容）。成员只能读取当前有设备访问权限的记录；改密码、退出项目后重新校验。

汇总返回 `totals` 和按日期/成员/运行器/模型分组的 `items`。`requests` 统计该日期范围新提交的请求数、已记录数、不可用数和共享轮次的追加请求数。tokens 按统计产生时间归日；跨天执行的请求可能两天都有用量，不能把每天的 measuredRequests 相加当唯一请求数。

## AI 会话或已授权的定时任务

先用 `context` 发现当前项目，检查 `capabilities.aiUsage`。筛选条件写到本地 JSON 文件（只含日期/筛选参数），调用：

```sh
node scripts/canvas.mjs usage-summary --input /absolute/filters.json
node scripts/canvas.mjs usage-requests --input /absolute/filters.json
```

JSON 可使用 `includePrompt: true`。若返回多个项目，按用户要求选项目；不要猜项目或复制授权文件。分页时将 `nextCursor` 写入下一次筛选文件。定时任务使用原有会话授权；本接口不会自动创建任务或发送群消息。

## 必须保留的统计口径

- 归属账号是**发起请求的万物成员**，不是运行电脑主人，也不是 ChatGPT/Claude 登录邮箱。范围仅为升级后的客户端通过万物执行的 AI 会话请求；独立 ChatGPT、Claude 应用里的活动及导入的旧历史不补算。
- 一条 request 是一次万物提交，内部可包含多次模型/工具往返；并非一条供应商 HTTP 请求。追加引导以 `usageCommandId` 指向原请求，整个共享轮次的 tokens 仅归原发起人一次，不虚构按人拆分。
- `inputTokens` 包含缓存读取和缓存写入，`outputTokens` 包含推理；`totalTokens = inputTokens + outputTokens`。`cacheReadInputTokens`、`cacheWriteInputTokens`、`reasoningOutputTokens` 都是子项，不能再次相加。
- Codex/GPT 用会话累计计数差值。恢复会话缺失基线或计数重置时只收集可识别的后续消耗，标 `quality=partial`；不要将其标成完整精确账单。
- Claude SDK 的 `result.usage` 是本轮主代理用量；包含多次主代理调用，但不包括子代理和辅助调用，`scope=claude-main-loop`。SDK 的 `modelUsage` 和费用可能包括恢复前历史，不能直接相加。当前不提供不可靠的全代理估算。
- DSH（`provider=dsh`）和内置万物 AI（`provider=wanwu`）使用本轮主代理逐次返回的用量，`scope=dsh-main-loop`。缓存输入计入 inputTokens；失败/重试仅在运行时确实报告用量时计入，缺少统计时标 partial，不把旧历史重复累计。不包含子代理或辅助调用。
- `model` 是运行时请求中显式选择的模型/别名；默认自动选择可能为 `null`，不猜实际路由后的模型。
- 明细 `usageStatus=unavailable` 时 tokens 为 `null`，可能是旧客户端、尚未上报或供应商没有给统计，不能当成 0。`shared-turn` 见原请求。进行中的统计是截至当前的用量；失败/取消但已产生的用量也保留。
- 请求明细仅返回脱敏后的用户输入（密码/key/sk- 等仍为 `***`）。端到端加密请求不生成服务端明文副本：`prompt=null, promptStatus=encrypted`。这个接口不复制 AI 回复。
- 用量是运行时自报统计，不是供应商账单，不含人民币/美元金额。效果评分、工作分类需按用户要求结合结果分析并标明推断，不由 token 数直接决定。

多人看板可在打开/重新可见时查询，运行中每 30–60 秒刷新；不要高频轮询。勿把私有请求日志复制到公开分享画布的持久状态，否则会绕过读取时的项目访问限制。
