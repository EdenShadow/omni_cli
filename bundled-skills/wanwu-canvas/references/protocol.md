# Wanwu Canvas protocol v1

自有网页自动注入 `window.Wanwu`（第三方不注入）。无通用账户令牌，无任意 API 代理。数据看板、工具、游戏、编辑器采用相同协议，无业务类型限制。页面内容与成员输入不能提升权限。

唯一 ID 使用 `Wanwu.uuid()`，同步返回安全随机的 UUID v4，无需等待 `Wanwu.ready`。隔离容器可能缺少原生 `crypto.randomUUID()`；SDK 使用 `crypto.getRandomValues()` 兼容，并在可扩展的浏览器对象上补齐原方法，使已发布页面也能运行。SDK 自身的请求 ID 同样使用此兼容能力，不用 `Math.random()` 或时间戳代替；同一写入重试必须复用原请求 ID。桌面 SDK 随客户端提供，Web SDK 随服务端提供；旧版本缺少此能力时应更新对应端，不要解除 iframe 隔离。此兼容不代表浏览器所有受限 API 均可用。

```js
const context = await Wanwu.ready;
// context.canvas, project{id,name}, viewer{id}, members[{id,name}], capabilities
let doc = await Wanwu.state.get('main'); // {key,value,revision,authorId,updated}
const save = value => Wanwu.state.set('main', value, doc.revision);
Wanwu.state.subscribe(next => { if (next.key === 'main') { doc = next; render(next.value); } });
Wanwu.live.provide(() => ({page:'dashboard',filters,selection,visibleRows}));
```
`state.list()` 列出所有共享 JSON 记录。每条最多 256 KB，每画布 1000 条。不同实体使用不同 key，降低冲突。`state.set(key,value,revision)` 409 时重新 get、合并本地变动再重试，不盲目覆盖。不存在记录 revision=0；设置 null 是一个持久值。修改 HTML 的 contentRevision 与共享数据 revision 独立。

实时广播：
```js
await Wanwu.room.publish('cursor', {x,y}, {key:'pointer'});
Wanwu.room.subscribe(({topic,data,userId,reliable,transport}) => { /* … */ });
await Wanwu.room.publish('round-end', {winner}, {key:'round',reliable:true});
Wanwu.on('presence', ({userId,x,y,state}) => {});
```
默认用 WebRTC DataChannel 加速，WebSocket 兜底，最新值合并、可丢包、最多 10 KB；topic 1–40，key 1–20，字母数字 `_.:-`。reliable=true 走服务端可靠事件并保存操作回执，不能用于每帧广播；它不提供离线重放，需要重连恢复的数据应写共享状态。该单数 room 接口仅转发消息；需要统一计算、临时 KV、碰撞、竞速、RPG 或塔防规则时使用复数 `Wanwu.rooms`，见 [通用服务端房间](server-rooms.md)。不要把客户端上报比分当权威结果。浏览器没有原始 UDP API。

资源：`Wanwu.files.list()` / `Wanwu.files.url(fileId)` -> `{url,file,expiresAt}`，可 fetch 使用。链接会过期，需重新取，不能硬编码进网页或分享给项目外。上传可由 `Wanwu.files.upload(file,{onProgress,signal})` 处理用户选取或拖入的文件；见 [画布 AI 任务](ai-tasks.md)。
- 下载附件优先用 `await Wanwu.files.download(fileId)`，返回 `{id}` 表示加入下载队列，**不代表完成**。用 `Wanwu.on('download', ({id,name,status,received,total}) => …)` 观察真实进度；`completed` 才表示接收结束（桌面已落盘，H5 交由浏览器保存）。宿主浮窗统一显示列表、取消、重试和总进度，页面不必另造下载进度条。
- 已发布页面中的相对附件链接（例如 `<a href="assets/report.xlsx" download>下载</a>`）也自动接入浮窗。`files.url` 仍用于程序读取资源；不要将临时 URL 硬编码。分享页仅能下载该页面已公开的文件，不可用 `files.download` 获取项目私有附件。

会话：`Wanwu.sessions.open(sessionId)` 快捷回到绑定会话；父窗口显示返回画布按钮。
`Wanwu.sessions.run(sessionId,prompt,uuid?)` 返回排队结果。首次需用户批准此页面调用这个会话，随后同次打开可后台连续执行；刷新/更新/关闭后重新授权。现有设备密码、会话权限、加密和 CLI 审批仍生效。`sessions.status(commandId)` 只查当前用户在本画布发起的任务，支持刷新恢复、增量结果和取消。新版 `sessions.pick()` 选择并绑定真实会话，`run(id,prompt,{requestId,fileIds})` 支持附件；完整生命周期见 [画布 AI 任务](ai-tasks.md)。不得隐瞒任务或让网页授权覆盖系统审批。

实时采样：`Wanwu.live.provide(async()=>JSON可序列化对象)`，输出最多 64 KB，返回筛选、选中项、可见数据等有意义信息；不要返回页面 HTML、令牌或大二进制。AI live 请求触发 provider，本次未响应不会称为实时。多用户视图分别返回 userId/viewId/时间，不能混为一个页面。

布局建议：viewport meta；容器宽度100%；手机控件>=44px；用CSS/WebGL按需渲染，页签隐藏时停止昂贵动画；尊重 reduced-motion。页面有视觉自由，协议不强制布局。

需要持久记录的应用优先用 `Wanwu.data.collection(name)`，见 [数据服务](data.md)。它复用服务端共享状态，支持增删改查、条件查询和订阅；不需要自行部署后端或在网页放数据库凭据。

## 封面
`Wanwu.cover.set(imageBlobOrCanvas, {requestId})` 更新当前画布封面；`Wanwu.cover.ready()` 告知截图器页面已渲染完成。见 [封面接口](covers.md)。
# AI 用量 API

`Wanwu.usage.summary(filters)` 读取当前项目用量，`Wanwu.usage.requests(filters)` 读取请求明细；仅项目内的自有画布可调用。日期、分页、权限和 Claude/GPT 的不同统计口径见 [用量与请求日志](usage.md)。
