## 消息与附件

下列命令省略 `node /absolute/wanwu-skills-sync/scripts/sync.mjs` 前缀，沿用 SKILL.md 中已确定的范围参数。

用户要求发送即已授权对应内容；不要在普通回答后自动发送，也不要上传整份会话。消息由「万物同步助手」发送，并标注发起成员和来源会话。

如果运行时返回 `request.groupChat.autoReply` 为 true，宿主会自动把最终回答送回该群聊，无需手动重发文字。用户请求生成的文件可通过本技能直接发送；成功分享文件后不要重复分享同一结果。其他会话仍须有用户发送请求。

1. 整理指定的文字与已有本地文件。文字最多 4000 字符，长文可保存为 `.md` 附件；最多 5 个文件，每个 500 MB，使用执行设备上的绝对路径。文件夹先压缩，原文件保留。排除凭据、应用私有数据和未指定材料。
2. 每次新发送生成一个 UUID：`node -e 'console.log(require("node:crypto").randomUUID())'`。多行文字写入 UTF-8 文件，用 `--text-file` 避免 shell 插值。
3. 运行：

```sh
chat --request UUID --text-file /absolute/message.txt --file /absolute/report.pdf --file /absolute/chart.png
```

文字支持 Markdown 标题、加粗、列表、引用、代码块和表格；保留用户原有格式，代码块中不要改写内容。

简短文字可用 `--text '消息内容'`；纯附件省略文字，纯文字省略文件。旧客户端不认识发送操作时，脚本自动通过同一会话接口分块上传，不读取桌面凭据，不需要换设备。新客户端使用原生大文件通道。`capabilities.chat` 缺失时说明服务端需要更新。

4. 只有 `status: sent` 才表示已发送。超时或结果不确定，用 `chat-status --request UUID` 查询，或用**相同 UUID、相同内容**重试。改变内容必须使用新 UUID，不能盲目生成新 ID 导致重复消息。群聊附件正常保留 7 天，原文件不删除。
