# 技能附带项目界面扩展

用户要求通过技能修改项目界面、增加协作按钮或表单时，在该技能根目录创建 `wanwu.ui.json`，随技能正常预览、发布。无需修改万物源码，也不要注入 DOM、脚本、样式或安装浏览器插件。

先 `context --include skills` 确认目标项目、技能当前版本和 `capabilities.skillUi`。没有此能力时说明需更新服务端和客户端，不宣称扩展已生效。普通技能不需要这个文件；编辑已有技能的其他功能时保留原有扩展。

## 允许的扩展范围

| 定义 | 支持内容 |
| --- | --- |
| `buttons[].slot` | `project.toolbar` 项目顶栏、`chat.toolbar` 团队聊天标题栏、`chat.composer.actions` IM 输入框语音按钮旁、`canvas.toolbar` 画布看板/画布库、`skills.toolbar` 技能看板/技能库 |
| `hooks[].target` | `chat.title` 聊天标题、`chat.placeholder` 聊天输入提示、`canvas.title` 画布标题、`skills.title` 技能标题；只替换文字 |
| 面板字段 | `text`、`textarea`、`select`；可以标记 `required` |
| 动作 | 打开自带面板、打开项目画布、打开技能详情、跳转项目内页面、将模板填入团队聊天、打开原生 @ 选择器/附件选择/表情面板/聚焦输入框 |

不能替换登录、权限、成员管理、项目切换、发送按钮、原生窗口按钮或任意 CSS 选择器。界面由宿主渲染，跟随亮暗色。需要任意网页交互或调用 AI 的复杂应用时，创建万物画布，用 `open-canvas` 打开它，沿用画布 SDK 的会话、附件和数据接口。

## 可发布示例：团队日报入口

以下 JSON 放入名为 `team-daily` 的技能。该技能还需要正常的 `SKILL.md` 等文件。

```json
{
  "schemaVersion": 1,
  "skill": "team-daily",
  "buttons": [
    {"id":"daily","slot":"project.toolbar","label":"写日报","icon":"clipboard","action":"show-daily"}
  ],
  "hooks": [
    {"target":"chat.title","text":"团队协作"}
  ],
  "panels": [
    {
      "id":"daily-form",
      "title":"写一份团队日报",
      "description":"填写今天的进展，交给 Bot 整理。",
      "fields":[
        {"id":"progress","label":"今日进展","type":"textarea","required":true},
        {"id":"format","label":"输出格式","type":"select","required":true,"options":["简短要点","详细报告"]}
      ],
      "buttons":[{"id":"draft","label":"交给 Bot 整理","icon":"sparkles","action":"compose-daily"}]
    }
  ],
  "actions": [
    {"id":"show-daily","type":"open-panel","panelId":"daily-form"},
    {"id":"compose-daily","type":"compose-chat","text":"@Bot 请为 {{project.name}} 整理 {{user.name}} 的日报，格式：{{field.format}}。今日进展：{{field.progress}}"}
  ]
}
```

模板仅支持 `{{project.name}}`、`{{user.name}}` 和当前面板声明的 `{{field.ID}}`。生成的消息是草稿，成员检查后手动发送；不会在安装、加载或点击打开面板时自动发消息、调用付费 AI 或执行命令。草稿会追加到现有输入，不覆盖原稿。

其他动作格式：

```json
{"id":"dashboard","type":"open-canvas","canvasId":"实际的画布 UUID"}
{"id":"help","type":"open-skill","skill":"team-daily"}
{"id":"todo","type":"navigate","page":"todos"}
```

`navigate.page` 仅为 `chat`、`canvases`、`skills`、`announcement`、`todos`。`open-skill` 省略 `skill` 时打开自身。画布 ID 从当前授权项目中读取，不能编造，也不会绕过画布的密码或成员权限。图标枚举：`puzzle`、`sparkles`、`clipboard`、`calendar`、`chart`、`message`、`canvas`、`play`、`at`、`bot`、`paperclip`、`smile`。

文件最多 64 KB。每技能最多 12 个入口按钮、4 个文字替换、6 个面板、24 个动作；每面板最多 12 个字段、8 个按钮。ID 以小写字母开头，仅含小写字母、数字、连字符，最多 64 字符。按钮/字段标题最多 80 字，替换文字最多 120 字，消息模板最多 4000 字；字段输入最多 2000 字。选择字段必须提供 1–30 个选项。动作与面板引用必须存在，同类 ID 不重复，不接受未定义属性。

## 输入框旁的原生交互

先核对 `capabilities.skillUi.slots` 包含 `chat.composer.actions`，且 `composerCommands` 包含所需命令。旧客户端也需升级才能显示新插槽；不能仅根据服务端能力宣称所有成员已生效。

例如名为 `team-bot-shortcut` 的技能可以直接在语音按钮旁放置 @Bot 按钮：

```json
{
  "schemaVersion": 1,
  "skill": "team-bot-shortcut",
  "buttons": [{"id":"mention","slot":"chat.composer.actions","label":"呼出 @Bot","icon":"at","action":"mention-bot"}],
  "actions": [{"id":"mention-bot","type":"chat-input","command":"mentions","filter":"bot"}]
}
```

`chat-input.command` 支持：

- `mentions`：打开原生 @ 菜单，`filter` 为 `all`（默认，含成员、会话、附件）、`bot`、`member` 或 `session`。打开或取消不会改草稿，选中后在光标/选区位置插入引用；Bot 保留“继续 / 新会话”能力。
- `attachments`：打开本地文件选择器，沿用 IM 附件上传和大小限制。
- `emoji`：打开原生表情面板。
- `focus`：切回团队聊天并聚焦输入框。

除 mentions 外不可设置 filter。这些动作也可绑定标题栏、项目顶栏按钮或扩展面板按钮，会先切回团队聊天。录音或发送中会提示稍后重试，不会强行切换输入状态。不会自动发送消息或启动任务。

输入框插槽以紧凑图标显示，保留标题与无障碍名称。只直接显示第一个入口，其余收入“更多扩展”，避免多个技能挤占输入区。删除/更新技能或切换项目会关闭由该技能打开的提及/表情菜单，保留用户草稿。

## 生效、回退与清理

发布并选用技能版本后，服务器将该版本的扩展随项目快照发给成员，不依赖每台电脑是否完成 CLI 技能安装。用户固定旧版本时仍使用旧版扩展。预览回执的 `ui` 可用于核对按钮、改动位置和面板。

升级/回退替换整份声明；新版删掉 `wanwu.ui.json` 会撤销旧扩展。删除项目技能会移除所有按钮、文字替换和打开的面板，即使设备仍保留技能文件。切换项目不继承扩展；没有扩展的项目显示默认界面。多个技能修改同一文字时，技能名称按字典序最前者生效；移除它后使用下一个，全部移除后恢复默认。

发布后检查当前选用版本、成员界面、卸载还原及切换项目。扩展清理只撤销界面，不删除用户已经发送的消息、创建的画布或其他业务数据。
