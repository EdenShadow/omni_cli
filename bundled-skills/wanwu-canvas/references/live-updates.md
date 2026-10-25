# 多会话实时更新同一画布

已有画布可复用 ID。HTML 只发布一次，数据走持久状态接口；不要为了刷新数字反复 publish 网页。已有静态页面需先接入 `Wanwu.state.watch`，不会自动把任意 HTML 转成看板。只对用户指定的画布和工作流写入。默认每个生产会话 2–5 次/秒批量提交；先聚合更高频的源数据，不要逐笔刷新整个网页。

## 会话侧：持续更新

```js
import {connectCanvas} from '/绝对技能路径/scripts/live-client.mjs';
const canvas = await connectCanvas('完整画布 UUID'); // 自动发现当前授权运行时
const batch = canvas.prepare([
  {type:'merge',key:'agent.alpha',value:{status:'running',price:123.45}},
  {type:'increment',key:'totals',value:{events:1,volume:10}},
  {type:'append',key:'recent',value:[{id:'唯一业务事件ID',agent:'alpha',volume:10}],limit:100}
]);
await canvas.commit(batch); // 网络错误/429/5xx 有界退避，保持同一 requestId 和 sentAt
```

多个会话使用同一 canvas ID；每个会话写自己独立的 `agent.*` 键，共用统计使用 `increment`。不要把整个旧对象读出来再覆盖回去。`merge` 是顶层字段合并，两个会话写同一字段则最后提交者生效；需要冲突检测时带 `revision`。`set` 必须带 revision。`append` 必须显式指定保留条数 limit；它是有界近期列表，不是完整交易账本。

`prepare()` 返回可保存的请求信封。超时或进程恢复后，重发原信封，不重新生成 ID。响应丢失的重试不会重复累加；去重窗口为 24 小时，过期请求返回 410，不会被当成新操作重放。业务事件跨不同请求 ID 的重复提交需要生产者自行按业务 ID 去重。会话结束/撤权后会拒绝写入，不为后台脚本保留永久凭据。

## 非实时 / 一次性更新

```sh
node scripts/canvas.mjs update --canvas UUID --input /绝对路径/batch.json --request UUID
```

JSON 含 `sentAt`（创建请求时的 Unix 毫秒时间）、`operations` 数组，字段格式同上；重试复用 JSON 和 `--request`。也可通过已登录的项目成员 HTTP 接口 `POST /api/projects/:projectId/canvases/:canvasId/state-update` 提交同样的 JSON 加 requestId，沿用既有账号鉴权。不要将账号凭据或运行时文件放进 HTML。

## 画布侧：自动订阅与恢复

```js
await Wanwu.ready;
const stop = Wanwu.state.watch(['agent.alpha','agent.beta','totals','recent'], ({items}) => {
  const data = Object.fromEntries(items.map(s=>[s.key,s.value]));
  render(data); // 更新现有节点/图表，不重载页面
}, {onStatus(status,error) { /* syncing / live / reconnecting */ }});
// 卸载时 stop()
```

自动初次读取、监听变化、忽略旧版本、网络重连和页面恢复可见时补读。新客户端将同一段时间内的变更合并成最多 32 键的一次读取；服务端保留旧 `canvas-state` 通知，旧客户端仍可使用既有 state.subscribe / data.collection，但新 API 需新客户端及服务端。公开分享只读可观看变化，不获得新写入权限。

状态更新落 SQLite，同批全部成功或全部回滚，回执与更新同事务。来源 `sourceSessionId` 来自可信运行上下文（未导入的原生会话可能为空），不采信请求体中的自报身份。

## 瞬态信号

`canvas.signal('quotes', {...})` 或 `canvas.mjs signal --canvas UUID --input signal.json --request UUID`（JSON 含 topic/data）发布权限检查后的广播；网页 `Wanwu.room.subscribe` 接收。无离线重放，不用于账本。需要重开后恢复的数据必须先用 state 更新。已有 `Wanwu.rooms` 则是临时服务端内存房间，生命周期结束会回收，不等同于永久数据库。

## 容量与边界

- 原子批次最多 32 个不同键、64 KiB 输入，每个值最多 256 KiB、每张画布最多 1000 键。
- append 每批最多 200 项，保留上限 1000 项。增量数值为 JS 有限数，金额应用整数最小单位并自行控制精度。
- 同账号同项目每秒最多 60 次画布变更操作，多个会话共享限额。遇 429 聚合/退避，不绕过限额。
- 这是协作看板的近实时数据通道，不是微秒级撮合或下单系统。行情源、执行系统、完整审计账本仍由业务系统负责。
- 示例 [多会话汇总看板](../examples/live-dashboard/index.html) 仅消费数据，未接真实交易；`producer.mjs` 为有限次数模拟生产者，须用户指定目标才运行。
