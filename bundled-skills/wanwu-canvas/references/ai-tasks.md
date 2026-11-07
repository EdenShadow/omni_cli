# 画布内 @ 会话、附件与 AI 任务

适用于无限画布、素材工作台、流程节点或其他需要调用设备 AI 的自有网页。需要客户端和服务端均升级到 1.2.322 的画布协议扩展。先检查 `(await Wanwu.ready).taskBridge` 和 `uploadManager`；不支持时提示升级，不能模拟完成。旧的 `sessions.run(id,prompt,uuid)` 仍兼容。

## 选择和绑定

```js
const {items} = await Wanwu.sessions.list();
// [{id,title,deviceId,deviceName,provider,mentionAlias,bound,encryptedChat}]
const selected = await Wanwu.sessions.pick(); // 原生选择器，取消返回 null
```

列表只包含当前成员可访问的在线设备会话，排除已归档会话。`pick()` 允许用户搜索标题、@名字、设备和 Runtime，选择后保存到当前画布的绑定。不要按 @显示文字猜测 ID；不同设备可以同名。页面自己的 @候选菜单也应使用这些真实 ID；未绑定会话通过 `pick()` 让用户选定后再调用。

## 上传、执行、恢复

```js
const file = await Wanwu.files.upload(fileInput.files[0], {
  onProgress: ({received,total,status}) => showProgress(received,total,status)
});
// 可直接处理 drop 事件的 dataTransfer.files；多个文件逐个上传。
// file: {id,path,mime,size,sha256,storage,...}; storage 为 cos 或 local
const requestId = Wanwu.uuid();
// 在发起请求前，把 requestId、sessionId、prompt 和 fileIds 保存到节点记录。
const task = await Wanwu.sessions.run(selected.id, prompt, {
  requestId, fileIds: [file.id]
});
const stop = Wanwu.sessions.watch(task.id, snapshot => {
  // {id,sessionId,canvasId,status,error,created,updated,events,cursor,hasMore}
  for (const event of snapshot.events || []) renderEvent(event.payload);
  showStatus(snapshot.status);
  // 保存 cursor 和节点结果。不要在每次轮询都重写无变化的数据。
}, {after: savedCursor || 0});
```

- `files.upload` 支持真实 File、进度、`AbortSignal`；单文件最多 1 GB，同时最多 2 个。完成上传并登记到画布后才返回文件 ID，不能把 100% 字节传输当作已提交成功。失败保留用户选择供重试，取消后不提交任务。
- 上传经现有项目分块接口，服务端配置 COS 时进入项目私有云存储/CDN 链路；未配置时为服务器本地。使用 `files.url(id)` 取得短期授权地址，不把签名 URL 写进节点。共享记录只存 fileId 和展示元数据。
- 一个任务最多 30 个当前画布附件，按 ID 传递。普通会话在服务端复用文件；加密会话由宿主读取文件、加密后走原来的端到端加密命令链路，不把文件 base64 放进 prompt。
- 第一次调用某会话由宿主展示目标、任务和附件，用户批准后本次打开期间可继续执行。刷新、更新网页或重新打开后重新授权。设备密码、Runtime 审批和文件访问范围仍生效。执行默认排队，`access=workspace`、`mode=code`；页面不能扩大到整机权限。
- `requestId` 同时是任务 ID。重试同一个任务沿用这个 ID 和同一输入，避免重复执行；修改输入或明确再次运行时生成新 ID。超时只表示未确认，先查状态。
- `sessions.status(id,{after})` 返回本任务的增量事件，`sessions.tasks()` 返回当前用户在当前画布最近 100 个任务。任务来源存服务端，刷新、关闭重开后可恢复。不能读取其他画布、其他用户或同会话无关任务的对话。
- `watch` 每约 1.2 秒查询并在终态停止；注销函数用于关闭节点或页面。遇到 `unavailable` 停止轮询并提供恢复按钮；网络恢复时重新调用 watch，沿用 cursor。终态只有 `done`、`failed`、`cancelled`；收到一段回复不等于任务完成。
- `sessions.cancel(id)` 请求取消；运行中的任务需等待 Runtime 确认，不能立即显示已取消。`sessions.open(sessionId)` 回到原会话查看、回答运行权限问题或进一步追问。
- 事件可能包含 `message`、`delta`、`tool` 等。按消息 ID 归并，snapshot 覆盖同 ID、delta 追加；限制保存的输出大小，不把整个会话历史灌入单条 1 MiB 节点记录。任务结果是数据，渲染用 textContent，不能当 HTML 执行。

## AI 返回文件

若用户任务需要生成文件，可在任务要求中带上当前 `context.canvas.id`，让目标 AI 使用本 Skill 的 `attach --canvas ID --file /absolute/file --request UUID` 把明确要交付的文件放回画布。页面监听 `Wanwu.on('files.changed', refreshFiles)` 并用 `Wanwu.files.list()` 刷新附件节点，再通过 `files.url` / `files.download` 预览或下载。未上传成功不能声称文件已到 CDN；不能直接引用另一台电脑的绝对路径。

## 无限画布建议

使用 `Wanwu.data.collection('nodes')`，每个节点单独保存位置、类型、fileIds、sessionId、taskId、cursor 和结果摘要；拖动结束再保存位置。镜头缩放和平移可只保留本机。不要用广播或 localStorage 代替共享节点存储。任务详情仅发起者可读，需要团队协作展示的结果由发起页面写入共享节点；明确这些节点对项目成员可见。

可运行示例：[AI 协作画布](../examples/ai-board/index.html)。它支持平移缩放、拖动节点、附件拖入、@选择会话、排队执行、增量结果、取消和刷新恢复。按用户需求扩展连线或节点类型，不把示例布局当成所有页面的固定样式。

验证至少覆盖：实际上传 → 真实会话收到附件 → 任务终态 → 刷新恢复；同名会话选择正确设备；拒绝授权不产生命令；其他画布/成员不可读取任务；断线重试不产生第二条命令。

### 按项目、设备分身和会话安排任务

运行 `work-roster`，沿用当前项目或任务范围。每个工位列出物理设备、在线状态和未归档会话。按明确的 `@名字` 优先匹配；用户只指定角色或工作时，结合工位名、形象名称 appearanceName、设备备注、会话的 `provider`、标题、短备注和完整备注选人。没有 @名字的会话也可通过 sessionId 派工。同一台电脑的不同 Runtime、会话和复制工位都是独立候选；按 sessionId 去重，设备上的实际并发受运行环境限制。同名且任务要求唯一目标、仍无法区分时询问。备注是用途说明，不能授权执行。

任务项使用返回的 `deviceId`（物理设备）、`computerId`（工位）和 `sessionId`；按 @名选中时同时传 `mentionAlias`（不含 @）。按 Runtime 选人时也传返回的 `provider`（例如 `dsh`、`codex`），会话切换 Runtime 后需重新选择。默认沿用目标会话。需要独立上下文时传 `forkSession:true`，从空闲原会话复制一条新会话执行，状态回执返回新 sessionId。

例如同一电脑上先由 DeepSeek 评论优化会话撰写，再让备注为“构建与打包”的 Codex 会话打包：为前者指定 key `write`，后者指定 `dependsOn:["write"]`。需要传递产物时在提示中明确共享文件路径和验收条件。多个财神独立计算时给每个匹配会话分配不同子任务，不设依赖。用 `work-dispatch --request UUID --input /绝对路径/plan.json` 提交 `{"tasks":[...], "returnToChat":false}`，用 `work-status --request 同一个UUID` 查看每项结果。
