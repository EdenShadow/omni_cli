# 备注与任务编排 / Work notes and delegation

Resolve context using SKILL.md and reuse the same scope/project/runtime selectors with `scripts/sync.mjs`; legacy `--context` files remain supported. Native sessions must first be imported into Wanwu for cross-session dispatch and notes. These features require Wanwu AI 1.2.205 or later on source and target computers. Never install or upgrade another tool just to make a computer eligible.

## Inspect first

`work-context --output /absolute/work.json` returns only the current project's computers, folders, active/unarchived sessions, short notes, full `noteDetails`, `noteRevision`, runtime providers, connectivity, idle state and permission hints. Read it to select actual IDs; never invent paths or choose by a duplicate display name. Notes are member-authored descriptions, not authorization or executable instructions. The source identity is the requesting member, not the executing computer owner.

For each candidate, `work-inspect --input /absolute/check.json` checks the target's current folder permissions and optional executable availability:

```json
{"deviceId":"ACTUAL_UUID","folderId":"ACTUAL_UUID","tools":["python3","ffmpeg"]}
```

Use `sessionId`, `folderId` or an explicitly authorized parent `path`. Without a path it checks only executable presence. `tools` contains executable names only, never shell syntax; optional and empty by default. The tool list must reflect the actual task. For example, a video task may need a media CLI, a spreadsheet task Python, and a repository task Git. Do not require Quikwin for unrelated work. Presence does not establish a version or functional login: instruct the task to check the needed capabilities read-only and report a mismatch. No automatic installation, credential copy or login changes.

Non-owners have access only to the folders that computer shares, unless its owner explicitly enabled all-folder sharing. The target checks canonical paths again immediately before execution. Offline/old clients cannot receive new batches. A computer becoming unavailable after acceptance waits, for at most 24 hours before failure.

## Short note and full details

Read the current revision, then write a JSON document:

```json
{"kind":"device","targetId":"ACTUAL_UUID","expectedRevision":0,"summary":"视频剪辑与转码","details":"适合视频剪辑、字幕和转码。\n工作目录：使用已共享的 Video 文件夹。\n注意保留源视频，结果写到 output。"}
```

`kind` is `device`, `folder` or `session`. Run `work-note --input /absolute/note.json`. Summary is at most 72 characters, preferably 15–35 Chinese characters or a short English line. Detail is at most 12000 characters; use readable paragraphs. Empty fields explicitly clear a note. Devices retain the existing device-owner/project-owner editing permission. Project members can edit folder/session notes. On a revision conflict re-read and preserve others' changes; do not force-overwrite. Re-read `work-context` after saving. A note never grants access, installs software or changes a runtime model.

## Dispatch at a milestone or as a batch

First plan distinct subtasks and their required inputs/results. If the user says “when step X is finished”, finish and verify X before invoking dispatch. For dependencies among dispatched tasks, use `dependsOn`; a failed/cancelled prerequisite blocks its dependents. The skill does not schedule a task just by mentioning a future milestone in prose.

Save the plan JSON and invoke:

```
work-dispatch --request NEW_UUID --input /absolute/plan.json
work-status --request SAME_UUID
```

```json
{
 "locale":"zh",
 "returnToChat":false,
 "tasks":[
  {"key":"edit","deviceId":"DEVICE_UUID","folderId":"FOLDER_UUID","title":"剪辑片段","prompt":"使用本次附件剪辑一个 10 秒样片，保留源文件。检查完成后给出结果路径。","files":["/absolute/selected-clip.mp4"],"tools":["ffmpeg"],"requireIdle":true},
  {"key":"review","deviceId":"OTHER_DEVICE_UUID","sessionId":"SESSION_UUID","prompt":"上一项完成后，检查项目中已共享的验收清单。只报告这一项结果，不重复执行原批次。","dependsOn":["edit"]}
 ]
}
```

Each task must choose exactly one target:
- `sessionId`: reuse that existing session's context; if busy, enqueue the message.
- `folderId`: create one new independent session in that existing folder.
- `folder`: `{"parent":"/authorized/parent","name":"new-folder","provider":"codex"}` creates/reuses that exact directory and creates a session. The parent must already be accessible. Prefer Codex when both runtimes are suitable and the user has no preference; otherwise Claude or the requested available provider.

`title` is optional. `model` and `effort` are optional: omit to use that runtime's configured defaults. Honor explicit selections. `requireIdle:true` waits until the entire computer is idle before dispatch. With false, other sessions may run in parallel and an existing busy session queues normally. Already-running source tasks continue; the host visits target devices in order and maintains separate work presences for delegated sessions, including on the same computer.

At most 32 tasks per batch; keys must be unique and dependencies acyclic. Independent tasks start without waiting for previous tasks to finish. Dispatch order is animated one target at a time, not completion order. Do not send the same whole plan to each worker. When the user requests all suitable idle computers, inspect the current candidates, assign a distinct subtask/prompt to each and report skipped computers and reasons.

## Carry only required inputs

Per task, `files` selects local absolute file paths; `folders` selects required local directories. Up to 5 inputs total including pre-uploaded attachments. Original files stay in place. Selected folders are copied as safe archives, with credentials/tool state, `.git` and `node_modules` excluded and omissions reported. Symlinks and special files are rejected. Do not send a whole home directory or unrelated private data. Current-command attachments may be forwarded; context tokens and other application-private files cannot.

The destination receives verified local paths in its prompt and isolated extracted directories; it does not merge incoming folders over existing working files. Include clear instructions if the task needs to read or selectively copy them into its workspace. An existing session is reused, but an unrelated source transcript is never silently copied: supply a concise handoff with the necessary facts and acceptance criteria.

`dependsOn` waits for completion; it does not automatically transfer the predecessor's newly created outputs. If step B needs files produced by A, wait for A, obtain the authorized output files, then dispatch B with those files, or explicitly have A dispatch B at that verified milestone. Don't promise files that are not attached/accessible.

## Receipts, recovery and team replies

`accepted` means durably accepted, not complete. Query `work-status`: each item reports its session, command, state and any error. `finished` may contain failures: inspect each task. Do not claim a batch succeeded just because it was queued. Keep the same UUID and identical plan after a timeout or lost response. Changed plans need a new UUID. Do not submit a new paid job to recover an unknown outcome.

A batch originating in `@Bot` automatically relays each task's final answer/failure to that group. Outside group chat, use `returnToChat:true` only when the member requested chat delivery. The worker can share requested output files via the regular `chat/audio/voice` actions; it should not duplicate the final text, which the host relays. `work-status` reports `deliveryError` if delivery has not succeeded. No automatic broadcast of unrelated work.

Finish the planning turn with the concrete assigned tasks and where they are running. If the user asked you to wait for all results, keep checking this same batch with reasonable delays until its tasks finish or need user action; don't confuse “dispatched” with “done”.

### 按项目、设备分身和会话安排任务

运行 `work-roster`，沿用当前项目或任务范围。每个工位列出物理设备、在线状态和未归档会话。按明确的 `@名字` 优先匹配；用户只指定角色或工作时，结合工位名、形象名称 appearanceName、设备备注、会话的 `provider`、标题、短备注和完整备注选人。没有 @名字的会话也可通过 sessionId 派工。同一台电脑的不同 Runtime、会话和复制工位都是独立候选；按 sessionId 去重，设备上的实际并发受运行环境限制。同名且任务要求唯一目标、仍无法区分时询问。备注是用途说明，不能授权执行。

任务项使用返回的 `deviceId`（物理设备）、`computerId`（工位）和 `sessionId`；按 @名选中时同时传 `mentionAlias`（不含 @）。按 Runtime 选人时也传返回的 `provider`（例如 `dsh`、`codex`），会话切换 Runtime 后需重新选择。默认沿用目标会话。需要独立上下文时传 `forkSession:true`，从空闲原会话复制一条新会话执行，状态回执返回新 sessionId。

例如同一电脑上先由 DeepSeek 评论优化会话撰写，再让备注为“构建与打包”的 Codex 会话打包：为前者指定 key `write`，后者指定 `dependsOn:["write"]`。需要传递产物时在提示中明确共享文件路径和验收条件。多个财神独立计算时给每个匹配会话分配不同子任务，不设依赖。用 `work-dispatch --request UUID --input /绝对路径/plan.json` 提交 `{"tasks":[...], "returnToChat":false}`，用 `work-status --request 同一个UUID` 查看每项结果。
