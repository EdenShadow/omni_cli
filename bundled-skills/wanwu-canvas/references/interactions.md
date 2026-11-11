# 自定义技能交互

用于用户需要自定义弹窗、多字段、多步填写、小游戏、摇签、相册选图、拍立得等交互。无需用户自己写代码：先理解目的，编写 HTML 和请求 JSON，再调用 `interact`；不把普通问答强制改成游戏。

先运行 `context`，确认 `capabilities.interactionInput`。不支持时明确需要更新执行端和服务端；不要反复尝试普通 Node 或假装已经弹出。只适用于正在执行的万物 AI 会话，Codex、Claude、DSH 共用此接口。

## 调用和展示区域

```sh
node scripts/canvas.mjs interact --request UUID --input /absolute/interaction.json
```

```json
{
  "version": 1,
  "title": "定制你的午餐",
  "display": "session",
  "size": "compact",
  "htmlFile": "lunch.html",
  "initialState": {"step": 1},
  "capabilities": {"files": true, "motion": false},
  "timeoutMs": 900000
}
```

- `session` 默认：只嵌入来源会话，不会因用户关闭会话而弹到全局。`global` 是明确选择的应用内弹窗，保留设备、会话归属；关闭只是收起，可继续。只在适合全局体验时使用。
- `compact` / `wide`，移动端自动适应；HTML 内部可用任意数量的字段、分步表单、标签页、游戏阶段。不要为每个字段开一个窗口。
- 一次任务最多 4 个独立待提交窗口、共 32 次请求。多个全局窗口依次展示；不同会话隔离。需要 AI 根据第一步结果再提问时，提交后继续调用新 UUID 的 `interact`。
- `htmlFile` 相对请求 JSON；也可传 `html`，二选一。UTF-8 HTML 最多 256 KB；超时 1–30 分钟，默认 15 分钟。同 UUID 重试相同请求恢复等待/结果，不能改页面再复用 UUID。
- 主动取消任务、注销或过期会结束交互。窗口草稿与照片只在当前客户端内存保留；重新加载应用后不保证恢复未提交的内容。

## 窗口 SDK

页面启动先 `const ui = await Wanwu.interaction.ready`。SDK 先于作者脚本安装。只在阶段/字段变化时保存 state，不逐帧回传游戏动画。

```js
// 把当前步骤与字段存给宿主；切换会话/收起后可恢复。
const state = ui.state.get();
ui.state.set({step: 2, meal: '面条'});

// 必须在点击事件里调用，原生相册/文件选择器；相机在支持的手机上可用。
const photos = await ui.files.pick({accept:'image/*', capture:'environment', multiple:false});
// 不传 capture 是相册/文件选择；capture:'user' 倾向前摄。
ui.files.get(); // 恢复本窗口已选择的原始 File[]
ui.files.set(photos); // 替换/清空当前选择，支持多个照片

// 自己设计开启体感的按钮，在点击事件中调用。
const permission = await ui.motion.requestPermission(); // granted / denied / unavailable
// iOS 可能另需一次宿主的临时授权点击；默认没有固定体感工具栏。
const off = ui.motion.subscribe(({alpha,beta,gamma,absolute}) => { /* 游戏响应 */ });
// 一定同时提供点击/拖动操作，不能把陀螺仪作为唯一入口。

await ui.submit({text:'请整理我的点餐需求', values:{meal:'面条', count:2}, files:photos});
// 成功后文字+原始附件已经送进同一会话，由当前 Runtime 接着处理。
// 失败会 reject，显示可重试提示并保留选择；不要自己再发一次普通消息。
// 成功后宿主结束窗口，分步确认和离场动画应在 submit 之前完成。
ui.close(); // 暂时收起，保留本客户端的步骤与照片，可从会话/提醒继续
ui.cancel(); // 结束交互，不产生新的 AI 输入
```

`values` / state 须为 JSON 对象，序列化最多 16 KB，最多 8 层。`text` 最多 12,000 字符，附件最多 30 个、单个 1 GB，沿用万物现有 NAS 优先/CDN 兜底与公网加密上传流程。提交自动沿用来源会话及当前模型/强度设置；客户端不接受页面指定别人的设备、会话或命令。

`interact` 等待用户提交/取消，返回 `submitted` 或 `cancelled`。`submitted` 的 `commandId` 是已发送的后续用户输入，包含真实附件；工具结果不重复打印用户隐私字段。看到 submitted 后继续处理该输入，不要又要求用户上传或重复拼装发送。

## 前端设计与运行边界

宿主仅提供会话内或全局显示区域，不添加固定标题、关闭、发送或附件工具栏。名称用于通知与无障碍识别。页面自己设计退出和提交动作并调用上述 API；始终放置清晰的退出入口。`wanwu-busy` 事件的 `detail` 是提交中的布尔状态，用于自定义加载动效。多步、多个字段或游戏均放在页面内部，避免把完整流程挤成默认问答表单。

HTML/CSS/JS 运行在独立沙箱，不能访问宿主 DOM、登录凭据、项目接口、shell、网络或其他窗口。所需库与素材内联；图片可使用 data/blob，照片用 `URL.createObjectURL(file)`。需真实网络数据或持久存储时由 AI 在交互前后通过技能获取，或创建正式画布。

宿主提供 `--bg`、`--card`、`--ink`、`--muted`、`--line`、`--accent` 和 `data-theme=light|dark`。避免固定页面宽度，保证 320px 可用、按钮至少 44px，尊重减少动态效果设置。文件选择在点击时发起；体感需要受支持设备、HTTPS/安全上下文和用户授权，部分浏览器不提供；始终有无体感方案。

参考完整示例：[摇签与多步表单](../examples/interactions/fortune.json)、[拍立得与照片附件](../examples/interactions/polaroid.json)。按用户主题改写文案、视觉和玩法，不原样套示例给所有需求。

## 交互之后生成画布

按万物画布技能正常发布，设置清晰名称与真实封面。回复 `[画布名称](canvas.openUri)`；会话会显示带封面、标题的原生画布卡片并在应用内打开。

发布 manifest 可设 `sharing:{"mode":"off"}`（默认关闭）、`public`（公开只读）、`account`（登录后使用）。技能可约定初始模式，但不要擅自把生辰、照片、地址等结果公开。创建时省略默认关闭；更新时省略保留当前分享设置。仅创建者/项目管理员能改分享。两个项目导入的画布及分享设置独立。
