## 消息与附件

下列命令省略 `node /absolute/wanwu-skills-sync/scripts/sync.mjs` 前缀，沿用 SKILL.md 中已确定的范围参数。

用户要求发送即已授权对应内容；不要在普通回答后自动发送，也不要上传整份会话。消息由「万物同步助手」发送，并标注发起成员和来源会话。

如果运行时返回 `request.groupChat.autoReply` 为 true，宿主会自动把最终回答送回该群聊，无需手动重发文字。用户请求生成的文件可通过本技能直接发送；成功分享文件后不要重复分享同一结果。公屏长任务可按 [长任务进度](progress.md) 克制地发送中间进展；其他会话仍须有用户发送请求。

1. 整理指定的文字与已有本地文件。文字最多 4000 字符，长文可保存为 `.md` 附件；最多 5 个文件，每个 500 MB，使用执行设备上的绝对路径。文件夹先压缩，原文件保留。排除凭据、应用私有数据和未指定材料。
2. 每次新发送生成一个 UUID：`node -e 'console.log(require("node:crypto").randomUUID())'`。多行文字写入 UTF-8 文件，用 `--text-file` 避免 shell 插值。
3. 运行：

```sh
chat --request UUID --text-file /absolute/message.txt --file /absolute/report.pdf --file /absolute/chart.png
```

文字支持 Markdown 标题、加粗、列表、引用、代码块和表格；保留用户原有格式，代码块中不要改写内容。

简短文字可用 `--text '消息内容'`；纯附件省略文字，纯文字省略文件。旧客户端不认识发送操作时，脚本自动通过同一会话接口分块上传，不读取桌面凭据，不需要换设备。新客户端使用原生大文件通道。`capabilities.chat` 缺失时说明服务端需要更新。

4. 只有 `status: sent` 才表示已发送。超时或结果不确定，用 `chat-status --request UUID` 查询，或用**相同 UUID、相同内容**重试。改变内容必须使用新 UUID，不能盲目生成新 ID 导致重复消息。群聊附件正常保留 7 天，原文件不删除。


## @项目成员并提醒

用户要求 Bot 在公屏 @某人时，先用 `scene-members --query '名称'` 读取当前项目成员，核对 ID；重名时用用户名确认，不猜目标。发送时重复 `--mention MEMBER_ID` 可选多人：

```sh
chat --request UUID --text-file /absolute/message.txt --mention MEMBER_ID
```

客户端会在正文保留或添加可见的 @，并将成员 ID 写入加密消息的提及信息；只写普通姓名不等于通知。`context.capabilities.chatMemberMentions` 为 true 才支持此参数；旧客户端会明确提示升级，不降级为没有提醒的普通消息。发送成功只代表消息入群，不代表接收人的系统已展示通知。

宿主自动回传群聊最终回答时，也会识别正文里唯一匹配的 `@用户名`、`@显示名` 或 `@【显示名】`，不需要再用 chat 重发。重名优先使用唯一用户名；代码、引用示例、链接、附件引用、邮件地址和未知成员不会自动触发提及。正文中的 `@所有人`（或 `@everyone`）会展开为当前项目的全部成员提醒。

被提及成员的桌面客户端沿用 @提醒规则，包括应用内消息免打扰和正在阅读该群聊时；系统关闭通知权限仍不会显示系统 push。不要为了测试而向真实成员发送额外消息。


## Bot @所有人

用户要求通知所有人时，用 `chat --request UUID --text-file /absolute/message.txt --mention-all`；客户端会在正文保留或添加一个可见的 @所有人，并按当前项目成员列表生成加密提及信息。无需逐个拼接 ID，重试仍使用相同 UUID。普通任务不要自行添加全员提醒。

需要发送端 `context.capabilities.chatEveryoneMentions` 为 true（客户端 1.2.417 起）；旧客户端只更新 skill 不够，脚本会在发送前提示升级。服务端和接收端沿用既有成员提及格式；成员已离开项目时不再列入。宿主自动回传正文里的 @所有人 也支持全员提醒，无需再用 chat 重复发送。
