# 通用多人协作 / Wanwu.collab

用于多人画板、SVG 图形、流程图、节点编辑器、空间标注等。网页 SDK 和会话生产者共享同一协议，不限定数据字段或渲染技术。服务端和客户端都需要支持 `collaboration.v1`；旧端会明确提示升级，不能降级到泄露私有画布的项目全员广播。

## 三层模型

- **参与者**：服务端给出 `actor {id,userId,name,kind,sessionId,commandId}`。`name` 是任务发起人在项目里的昵称；同一人的不同运行任务有不同 actor ID。普通查看端按页面实例区分。不要从生成的 JSON 中自报昵称、账号或会话身份。
- **临时状态**：`awareness`（光标、选区、正在使用的工具）与 `preview(key,data)`（尚未提交的笔迹/拖动）。按键合并，8 秒无更新消失，离开后立即移除，不写数据库、不进聊天历史。不承诺逐帧必达。
- **持久对象**：`put / patch / remove` 以对象 ID、版本号提交。独立对象可并发写；同一对象用 CAS 检测冲突。原子批次、幂等回执、重连快照和单调版本更新复用服务端存储。

## 网页接入

订阅先于 join；join 返回当前快照，同时也通过 onObjects 分页发送首次对象。按 ID、revision 合并，不能把快照数组覆盖掉已经收到的新版本。

```js
const objects = new Map();
const stopObjects = Wanwu.collab.onObjects(({items}) => {
  for (const r of items) if (r.revision > (objects.get(r.id)?.revision || 0)) objects.set(r.id, r);
  render([...objects.values()].filter(r => !r.deleted));
});
const stopReset = Wanwu.collab.onReset(() => { objects.clear(); render([]); });
const joined = await Wanwu.collab.join('board');

// cursor 坐标由应用定义；SVG/缩放画板用 project 转成 surface 内的 CSS 像素。
const stopCursors = Wanwu.collab.mountCursors(surface, {project: point => worldToScreen(point)});
await Wanwu.collab.awareness({cursor:{x:120,y:80},tool:'pen'});
await Wanwu.collab.preview('stroke-uuid', {type:'path',points:[[120,80],[125,90]]});
const batch = Wanwu.collab.prepare([
  {type:'put',id:'stroke-uuid',revision:0,data:{type:'path',points:[[120,80],[125,90]],color:'#5964d8'}}
]);
await Wanwu.collab.commit(batch);
await Wanwu.collab.preview('stroke-uuid', null);
// 卸载：stopObjects(); stopReset(); stopCursors(); await Wanwu.collab.leave();
```

`onParticipants` 给出完整参与者列表；`onTransient` 给出 `{kind,key,data,seq,actor,expiresAt,expired?}`，用于自行渲染选区、拖动预览等；`onStatus` 给出 connecting/syncing/connected/reconnecting/error。公开分享页不开放此协作 API。已保存数据仍遵守原有画布分享设置。

`mountCursors` 为可选通用渲染器：显示可信项目昵称、AI 标识、稳定颜色；支持坐标投影、隐藏自己的光标、减少动态效果偏好。也可以自行渲染。发出 `awareness({cursor:null})` 隐藏光标。

## AI 会话：边操作边显示虚拟鼠标

```js
import {connectCanvas} from '/技能绝对路径/scripts/live-client.mjs';
const canvas = await connectCanvas('完整画布 UUID');
const doc = await canvas.collaborate({document:'board', onEvent(name,event) {
  // collab.objects / collab.participants / collab.transient / collab.status / collab.reset
}});
try {
  const id = crypto.randomUUID(), points=[];
  for (const point of plannedPoints) {
    points.push(point);
    doc.awareness({cursor:{x:point[0],y:point[1]},tool:'pen'});
    doc.preview(id,{type:'path',points,color:'#5964d8',strokeWidth:4});
    await new Promise(r=>setTimeout(r,80)); // 示例节奏；长笔迹要抽稀，预览不能超过 8 KiB
  }
  const batch=doc.prepare([{type:'put',id,revision:0,data:{type:'path',points,color:'#5964d8',strokeWidth:4}}]);
  await doc.commit(batch); // 超时/断线时保存原 batch，重连后重试同一个信封
  doc.preview(id,null);
} finally { doc.close(); }
```

每个会话独立连接同一画布/文档即可。同一运行任务在同一文档只保留一条连接，再连接会替换旧连接。身份来自任务授权，不能通过 URL/请求体冒充。任务结束、撤权、画布内容版本变更会关闭连接；不会为脚本发永久账户密钥。把 API 放进实际绘制循环才有真实光标，任意旧 HTML 或一次性 SVG 字符串不会自动生成鼠标轨迹。

## 非实时接口

同样的数据协议可一次性读取/提交，不需要保持 WebSocket：

```js
const page = await canvas.snapshot({document:'board',cursor:''}); // page.items / page.cursor
await canvas.commitObjects(batch,{document:'board'});
```

```sh
node scripts/canvas.mjs collab-snapshot --canvas UUID --document board
node scripts/canvas.mjs collab-commit --canvas UUID --document board --input /绝对路径/batch.json --request UUID
```

JSON 包含 `sentAt`、`operations`；重试复用原文件和 request ID。已登录成员 HTTP API 为 `GET/POST /api/projects/:projectId/canvases/:canvasId/collaboration`，POST `{document,batch}`。写入会通知已经连接的网页和 AI。

## 冲突、恢复与容量

画板性能设计同时遵循 [数据服务的加载与交互要求](data.md#加载与交互性能)：本地立即响应撤销/绘制，后台有序提交并处理失败；首次快照分帧渲染，历史归档为附件，事件按对象版本增量合并。已有 state/data 画板不能直接换成 collab 后丢弃旧笔迹；先读取并设计有版本标识的迁移。

- 对象格式任意 JSON object。`put` 替换整个对象；`patch` 顶层字段合并；`remove` 写入删除标记。都必须带当前 revision，新对象为 0。返回 409 时重新读取/合并、生成新请求；不要机械覆盖。恢复删除对象必须显式 put。
- 每笔笔迹/图形独立对象；多人改同一对象会检测冲突。这不是自动合并任意文本或同一 SVG 路径的 CRDT，也不提供离线分叉编辑的自动合并。
- 同一请求 ID + 相同信封 24 小时内幂等。网络结果未知时复用原信封，不生成新 ID 重发。瞬态预览不自动补发旧帧；重连自动补快照并继续新帧。
- 文档名 1–24 位字母、数字、下划线、连字符；对象 ID 1–60 位。不要直接使用任意用户输入作为 ID。`collab.<document>.<id>` 是保留存储前缀，不用旧 state API 绕过对象规则。
- 每批最多 32 对象、64 KB 信封；同账号同项目每秒 60 次持久变更（多个会话共用）。每画布 1000 共享键，包含删除标记、其他 state/data 键。复杂画板要分块/归档，不逐点创建持久对象。
- 每条预览 8 KiB、每连接 64 个活跃临时键，客户端首帧立即发送，其余合并为最新值，连接总预算 60 条/秒（最多 2 条突发）；服务端空闲时立即广播，连续更新最多等待 16 ms 合并窗口。拥堵超过 1 秒的未发预览丢弃，断线不重放轨迹。长笔迹抽稀或按段预览，最终提交完整对象；高频行情/轨迹先聚合。
- 每文档最多 128 参与者、每账号 64 连接，单进程最多 256 活跃文档。快照按 32 对象/约 256 KiB 分页。慢接收者断开后补快照，不无限堆积。限额是防护上限，不代表公网并发性能承诺。
- 当前实时服务运行在单个应用进程。多实例部署需要按画布路由到同一实例或加入共享消息总线，不能把不同实例间实时广播当作现成能力。
- 示例 [多人共绘](../examples/collaborative-board/index.html) 包含笔刷、荧光笔、矩形、椭圆、橡皮、SVG 导出、多人光标和中英文/窄屏样式。仅在用户指定项目与用途后发布；不默认创建真实团队数据。
