## 公告和指定 TODO

下列命令省略 `node /absolute/wanwu-skills-sync/scripts/sync.mjs` 前缀，沿用 SKILL.md 中已确定的范围参数。

先运行 `board --output /absolute/board-current.json`，然后读取这个文件。它包含当前公告完整内容及 revision、待办列表及各自 revision、项目成员 ID 与昵称。`legacyText` 保留未迁移为页面的旧公告。`capabilities.board` 为 true 才支持。

读取 [公告与待办格式](board-format.md) 了解 JSON 字段、编辑规则和调用示例。不要用技能发布操作来更新公告或 TODO。

- 公告：基于当前完整页面只改用户要求的内容；保留其他段落、布局和功能。新公告输出 compactHtml 和 fullHtml。将页面保存为 JSON，执行 `announcement-publish --request UUID --revision CURRENT_REVISION --input /absolute/announcement.json`，直接同步到项目公告。
- 新建 TODO：将指定事项写成字段 JSON，执行 `todo-create --request UUID --input /absolute/todo.json`。该 UUID 同时作为新待办 ID。
- 更新指定 TODO：按用户指定的标题/ID/上下文匹配，重名时澄清；JSON **只写需改变的字段**。执行 `todo-update --request UUID --todo TODO_ID --revision CURRENT_REVISION --input /absolute/patch.json`。不把编辑误做新增，不动其他任务。
- 删除指定 TODO：确认 `capabilities.todoDelete` 为 true，使用刚读到的任务 ID 和自身 revision，执行 `todo-delete --request UUID --todo TODO_ID --revision CURRENT_REVISION`。无需 `--input`，不发布新公告，不改其他事项。用户明确要求删除即授权该项删除，不重复索要许可。
- 若公告包含用户要求新增的待办，可在发布时重复传 `--todo-key KEY`；未选中的建议不会加入 TODO。修改已有待办仍需 `todo-update`，避免重复创建。
- 用户要求更新/发布时，完成编辑后直接执行，不重复索要许可。仅要求草稿、建议或预览时不写入项目。
- 返回 `published` / `created` / `updated` / `deleted` 才报告成功。删除回执中的 taskId 必须等于目标 ID；随后重新 `board` 确认该项已消失、其他事项保留。其他写入同样重新读取确认保存结果。结果不确定用 `operation-status --request UUID`；相同操作重试保持 UUID 和文档不变。并发版本冲突时先重读、保留他人更改再合并；修改内容或 revision 后使用新 UUID，不强行覆盖。删除遇到冲突时重新查看内容，确认仍为用户指定事项后再用新 revision 和新 UUID；目标已不存在时说明已被移除，不选择另一个同名项代替。

消息、公告、TODO 的更新立即广播给项目成员，不触发 Skills 安装或暂停设备。只有实际发布技能版本才触发技能同步。
