# 通用服务端房间（rooms.v1）

这是运行任意画布业务规则的机制，不限定球类、竞速、RPG、塔防或其他玩法。平台负责房间、连接、身份、定时调度和广播；**具体规则随画布发布**。客户端输入指令，服务端决定位置、伤害、碰撞、圈数、掉落或比分。没有玩家主机，某一位玩家离开不会停止其他玩家的计算。

## 选择接口

| 需求 | 接口 |
| --- | --- |
| 持久数据、重启后仍保留的记录 | `Wanwu.state` / `Wanwu.data` |
| 光标、临时提示、客户端之间转发 | 原有 `Wanwu.room.publish/subscribe` |
| 自动回收的共享 KV | `Wanwu.rooms`，不提供脚本或配置 `mode: "kv"` |
| 通用服务端逻辑、统一计算 | `Wanwu.rooms` + `wanwu.server.json` + JS 脚本 |

`Wanwu.room`（单数）旧广播接口保持兼容，**不会自动升级成服务端计算**。已有游戏要迁移规则、输入和渲染，不能只换接口名便声称改造完成。

## 随画布发布规则

网页包根目录加入 `wanwu.server.json`：

```json
{
  "version": 1,
  "mode": "script",
  "entry": "server/room.js",
  "tickRate": 30,
  "broadcastRate": 10,
  "maxPlayers": 16,
  "emptyTimeoutMs": 30000,
  "config": {"laps": 3, "maxSpeed": 20}
}
```

同时把配置和完整脚本列入 `canvas.mjs publish` 的 `files`，与 HTML/CSS/JS 一起提交。`entry` 是包内相对 `.js` 路径。后台在发布前独立验证初始化及一次 tick；语法、初始化或资源错误会拒绝发布，原画布继续可用。业务回调仍需自己做测试。更新成功会关闭旧版本房间，打开新页面进入新一代房间；不热迁移运行中的状态。配置只能通过发布修改，不能由进房客户端覆盖。

`server/room.js` 是普通同步 JavaScript，定义 `globalThis.Room`：

```js
globalThis.Room = {
  init(ctx) { return {players: {}, time: 0}; }, // 必填，返回 JSON 状态
  join(state, player, ctx) {
    state.players[player.id] = {x: 0, velocity: 0};
  },
  input(state, player, input, ctx) {
    // player 由服务端认证，绝不能信任 input.userId / input.playerId。
    if (input?.type !== 'move' || !Number.isFinite(input.velocity)) return;
    state.players[player.id].velocity = Math.max(-5, Math.min(5, input.velocity));
    return {accepted: true};
  },
  tick(state, ctx) {
    state.time += ctx.dt;
    for (const p of Object.values(state.players)) p.x += p.velocity * ctx.dt;
  },
  leave(state, player, ctx) { delete state.players[player.id]; },
  query(state, player, query, ctx) { return state.players[player.id]; },
  view(state, player, ctx) { return {players: state.players, time: state.time}; }
};
```

- `init` 的返回值成为房间内存状态；其他回调直接修改 state。`input` 返回值作为该次请求回执。
- `query` 和 `view` 收到状态副本，适合查询/按玩家裁剪可见状态。**没有 view 时所有状态对所有房间成员可见**，有隐藏信息的 RPG/牌类应显式实现 view、query。脚本资源可下载，不可在其中放密钥。
- `ctx`：`roomId`、`generation`、`tick`、服务器毫秒时间 `time`、固定步长秒 `dt`、发布时的 `config`、在线 `players[{id,userId}]`。
- `player.id` 是账号与本次页面客户端标识派生的成员 ID，`player.userId` 是认证账号。短暂重连使用相同 id；重新打开页面可能不同。每次重连会重新 leave/join，需保留玩家状态时由规则按 userId 设计重入策略，不能假定一个账号只有一个窗口。
- `ctx.emit(topic, data)` 广播事件；`ctx.send(playerId, topic, data)` 仅发给指定在线玩家。事件不离线重放，需要恢复的内容放 state。
- 回调必须同步；没有 Node、DOM、fetch、WebSocket、文件系统、数据库、宿主密钥、模块导入和 setTimeout。需要倒计时、刷怪、AI、碰撞或经济结算，用 state + tick 实现。可将需要的纯 JS 算法预先打包到一个入口文件，不能在运行时下载依赖。

## 网页接口

```js
const context = await Wanwu.ready;
if (!context.capabilities.includes('rooms.v1')) throw Error('请更新万物客户端');
Wanwu.rooms.subscribe(({generation, sequence, tick, time, state, players}) => {
  // generation 改变表示新房间，丢弃旧预测/序号。使用插值渲染服务器快照。
  render(state);
});
Wanwu.rooms.onStatus(({status, message}) => showConnection(status, message));
Wanwu.rooms.onEvent(({topic, data}) => showEffect(topic, data));
const joined = await Wanwu.rooms.join('match-001');
// joined: {room,generation,player,mode,tickRate,broadcastRate,state,players,...}
await Wanwu.rooms.input({type: 'move', velocity: 4});
const me = await Wanwu.rooms.query({type: 'self'});
await Wanwu.rooms.leave();
```

一个页面同时加入一个房间；join 另一个会先离开旧房间。相同画布、内容版本、room 名的连接进入同一房间。不同画布/版本/房间完全隔离。room 名 1–64 字符，允许字母、数字、`_.:-`。有登录后互动权限的分享页和项目内页面可进入同一个房间；免登录只读分享不允许加入。已有账号/项目/分享权限撤销后连接会停止。

宿主负责心跳、断线重连和重发完整快照；不会自动重放不确定是否执行的输入。使用持续控制状态（如 steer/throttle）并周期发送，瞬时动作带自己定义的 actionId/序号并在规则中做去重。`input(data, {requestId})` 只在当前连接保留最近 64 个请求回执；不能作为跨重连的永久幂等保证。收到 error 展示可理解的提示，不要无限发送输入。

## 只需要临时 KV

无 `wanwu.server.json` 时默认 KV 模式。也可显式发布 `{ "version":1, "mode":"kv", "emptyTimeoutMs":30000 }`。

```js
await Wanwu.rooms.join('workshop');
const old = await Wanwu.rooms.get('count'); // {value:null, revision:0} 表示从未写入
const next = await Wanwu.rooms.increment('count', 1, old.revision);
if (next.conflict) { /* next 是最新值和 revision；重读/合并后再操作 */ }
await Wanwu.rooms.set('cursor.edited', {x: 10}, 0);
await Wanwu.rooms.remove('cursor.edited', 1); // 保留修订号墓碑，防止旧写入复活
const snapshot = await Wanwu.rooms.query(); // {values:{key:{value,revision}}}
```

KV get/set/remove/increment 按房间串行执行，写入必须传 revision，冲突返回 `{conflict:true,value,revision}`。**任意房间成员都可写 KV**；需要权限/业务校验时使用 script 模式（禁止客户端直接 set），在 input 校验。脚本模式 `query()` 由自己的 query 回调定义；未实现 query 时返回该玩家的 view。

## 生命周期与限制

- 第一个玩家连接时创建内存及脚本实例。10 秒一次心跳，35 秒无心跳移除玩家；无玩家后等待配置的空闲时间并释放整个实例。最后一人正常 leave 会立刻开始空闲倒计时。
- 当前为单后台实例内存房间；后台重启、画布更新/删除、脚本错误或全部玩家离开到期均会重置。不是永久世界、跨机分布式存储或无限在线服务器。多实例部署需先增加房间路由/协调。重要长期数据仍使用持久存储；本版本脚本不直接写数据库。
- tickRate 1–60（默认20），broadcastRate 1–60 且不超过 tickRate（默认20），最多32人/房间，空闲释放1–120秒（默认30秒）。固定 dt，过载不补发无限积压 tick；客户端按服务器 tick 对齐，不用自己时钟裁决。
- 配置16KB，脚本128KB；输入8KB、100条消息/秒/连接（含心跳），最多128条房间待处理任务；状态 JSON 约128K字符，QuickJS堆16MB、栈256KB、单次处理30ms、每秒脚本执行预算100ms。超限终止该房间，不能拖死主服务；失败房间暂缓30秒再重试。
- 一次输出最多512K字符且1MB编码字节，事件每次最多16条、每条4K字符。高人数、大状态时使用 view 缩小快照，降低广播频率。单房间广播限512KB/秒、服务合计4MB/秒；超额快照降频，事件超额或慢连接断开重连，不能无限积压。
- 默认总计24个活动房间、每画布6个、每账号8个连接/创建的活动房间；超限明确报错，不无限分配。KV最多256个key（含墓碑）。适合轻量多人逻辑，不能承诺高负载大型 MMO 的容量或可靠结算。

## 示例与验收

[通用房间示例](../examples/server-room/index.html) 带三个可替换规则：`rules/race.js` 车速/圈数；`rules/rpg.js` 冷却/伤害/奖励；`rules/tower-defense.js` 波次/建塔/范围碰撞。修改配置 entry 切换，宿主 API 无需改变。它们是机制演示，不是已完成的商业游戏。

至少验证：两个账号同房间、无主机依赖、输入身份/数值校验、旧输入去重、断线重连、无人回收、不同画布与房间隔离、错误/死循环限时停止、手机和桌面交互。RPG/塔防还需规则级测试。没有在真实画布里验证时，区分本地测试与线上可用，不称现有游戏已经迁移。

### 低延迟配置

轻量实时游戏可显式设置 `tickRate: 60, broadcastRate: 30`，小状态、低人数房间可试 `60/60`；已发布的显式频率保持不变。更高频率仍受脚本 CPU 和广播字节预算约束，不适合每帧发送大地图。服务端按固定广播截止时间推进，延迟后只发送当前快照，不补发旧快照；慢连接积压超过 64 KiB 时跳过可替换快照，可靠事件/回复保留原有保护。

在本地立即绘制自己的输入；远端状态用插值展示，最终以服务器裁决为准。输入预测/回滚须按游戏规则实现，通用接口不假设输入可重放。画笔预览使用 `Wanwu.collab.preview`，完成一笔后再 `commit`，不要每个鼠标事件写数据库或用普通 HTTP 广播。
