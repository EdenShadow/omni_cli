# 项目公告与 TODO / Project board format

所有命令使用 `node /absolute/wanwu-skills-sync/scripts/sync.mjs`，沿用 SKILL.md 中选定的 `--scope` / `--project` / `--runtime` 参数（兼容旧 `--context`）。只操作已确认范围内的项目，不能用参数更换万物任务的项目或发起人。

## 读取当前项目 / Read before editing

```sh
board --output /absolute/board-current.json
```

读取返回文件中的 `announcement`、`tasks`、`members`。公告不存在时 `announcement: null`、初始 revision 为 0；若 `legacyText` 非空，编辑原公告时保留其内容。每个任务有独立 `id`、`revision`、`authorId`、`assigneeId` 和状态。不要拿项目 board revision 当作公告或任务 revision。

Read the saved file before drafting. Use the announcement's own revision or the selected task's revision. The board's overall revision is not interchangeable with either. Member IDs resolve assignees; duplicate display names require clarification.

## 公告文档 / Announcement JSON

`--input` 文件直接是页面对象，不需要额外 `page` 外层：

```json
{
  "schemaVersion": 1,
  "title": "项目进展",
  "summary": "本周进展摘要",
  "compactMode": "scroll",
  "compactHtml": "<section data-announcement-editable=\"进展\"><p>用户提供的真实进展。</p></section>",
  "fullHtml": "<h1>项目进展</h1><section data-announcement-editable=\"进展\"><p>用户提供的真实进展。</p></section>",
  "todos": []
}
```

```sh
announcement-publish --request UUID --revision 3 --input /absolute/announcement.json
```

- title 最多 160 字符，summary 最多 1000；compactHtml 最多 160000，fullHtml 最多 600000。整个上传 JSON 最大 8 MB。
- 两份 HTML 都是自包含片段，CSS/JS 内联；图片用内联 SVG 或 data URI。禁止外部脚本、网络请求、iframe、表单、导航及应用宿主 API。
- compactHtml 展示在约 340×170 小画布里，标题由宿主标题栏展示，不重复写大标题；背景透明、无外围大留白，正文可滚动且字号可读。完整页面应适应 360–1100px 宽度。
- compactMode 为 scroll / auto-scroll / marquee / barrage / custom。编辑时保留原模式，除非用户要求改变。可编辑文字用 `data-announcement-editable` 包裹。
- 当前页面有 `contentHtml` 时，编辑内容须与 compactHtml/fullHtml 同步；若重新设计 HTML，删除过期 contentHtml，防止后续富文本编辑恢复旧内容。
- 保留用户未要求改变的文字、交互、图表、任务建议和语义 key，不编造进度、人物、日期。

`todos` 只放明确可执行的建议，结构为 `{key,title,body,color,texture,dueDate,dueAt}`。key 是稳定 ASCII 字母/数字/横线/下划线，1–80 字符；最多 60 条。只有用户要求同步到 TODO 时才用 `--todo-key KEY` 选中对应新事项。相同 key 不覆盖已有便签或状态；更新已有项必须按其 ID 使用 `todo-update`。

Keep existing announcement content and behavior except the requested edits. Inline all resources; the compact view has a host-rendered title and transparent background. Only explicitly selected, user-requested action items are created. Existing TODO edits and completion states are preserved.

## TODO 字段 / Task fields

创建文件示例：

```json
{"title":"确认发布文案","body":"核对用户指定的内容。","status":"todo","assigneeId":null}
```

```sh
todo-create --request UUID --input /absolute/todo.json
```

更新文件只包含变更字段，例如：

```json
{"status":"doing","assigneeId":"MEMBER_ID_FROM_BOARD"}
```

```sh
todo-update --request UUID --todo TODO_ID_FROM_BOARD --revision 2 --input /absolute/patch.json
```

- title：非空，最多 160 字符；body：Markdown，最多 30000 字符。
- status：todo / doing / done，对应待办 / 执行中 / 已完成。
- assigneeId：当前项目成员 ID；null 取消认领。只有用户要求指定/更换负责人时才传入；不能修改创建人。
- color：butter / mint / lilac / rose / sky / peach / sage / stone；texture：plain / paper / grid / linen。未要求改变时不要覆盖现有选择。
- dueDate：YYYY-MM-DD 或 null，全天截止；dueAt：带明确时区偏移的 ISO 时间或 null。不要猜测用户未提供的截止时间/时区。
- 不修改 id、authorId、created、completed 或其他系统字段。完成时间由状态自动维护。

For updates, send only changed fields. Omitting a field preserves it; null explicitly clears an assignee or deadline. Resolve a named task and assignee from the latest board, and never change other tasks as a side effect.

## 删除指定 TODO / Delete one task

先读取最新 board，将用户指向的事项唯一匹配到 ID；同名且上下文不足时澄清。不通过删除公告来移除 TODO，也不将“已完成”理解为删除。

```sh
todo-delete --request UUID --todo TODO_ID_FROM_BOARD --revision 2
```

需要 `capabilities.todoDelete: true`。删除不上传文档，不需要 `--input`；目标必须属于当前项目且 revision 与读取时一致。该操作使用同一团队权限规则，立即同步所有成员。回执为 `{status:"deleted", action:"todo-delete", requestId, projectId, projectName, taskId}`。重新读取 board 确认目标消失；不删除其他同名事项。

For an explicit delete request, resolve exactly one task from the current board. Supply its ID and revision, with no input file. Verify `deleted` and `taskId`, then fresh-read. Retry an uncertain operation with the same UUID, ID and revision, or query its receipt first. If a task is already absent, report that fact instead of selecting a substitute.

## 重试与确认 / Verify results

返回 published / created / updated / deleted 后，重新读取 board 确认。相同 UUID、相同文档和 revision 的重试返回原操作回执，不重复创建或增加公告版本。内容、目标或 revision 改变必须换新 UUID。`operation-status --request UUID` 查询本成员在当前项目的操作。

409 冲突时保留草稿，重读项目内容，合并用户要求与他人修改后用新 revision、新 UUID 重试。同一字段的意图无法确定时询问用户；不绕过版本保护。群聊、公告、TODO 更新不会改变项目技能版本。
