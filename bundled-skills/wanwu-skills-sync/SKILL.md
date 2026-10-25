---
name: wanwu-skills-sync
description: 按需获取万物项目与权限，发送指定消息或文件到团队、同步技能、编辑公告和待办、读取成员形象、修改角色与场景，附带项目界面扩展，或进行备注和跨设备派工。普通问答不调用，不自动广播。
metadata:
  display_name: 万物同步助手
  version: "1.15.0"
---

# 万物同步助手

普通回答保持原样。用户要求操作万物时，才运行本技能安装目录下的 `scripts/sync.mjs`；不要提前读取所有参考文档。回复使用用户当前语言。

## 按需取得上下文

直接在 Codex 中使用：

```sh
node /absolute/wanwu-skills-sync/scripts/sync.mjs context
```

脚本从本机正在运行的万物客户端获取当前账号、设备和会话授权，不需要在消息里粘贴上下文。当前消息带 `<wanwu scope="…" />` 时，在命令中加 `--scope ID`，按本轮发起人权限执行；旧版给出的上下文路径仍可用 `--context PATH`。有明确引用时不得省略引用再切换身份。

若返回 `select-project`，用用户指定的项目名称或返回的 ID 加 `--project PROJECT` 再调用；多个候选且用户未指定时才询问。不要根据工作目录、历史令牌或同名项目猜测。运行时未启动、旧版本或多实例处理见 [运行时与项目选择](references/runtime-context.md)。只让脚本读取授权文件，不展示、上传或复制文件内容。

`context` 默认只返回当前范围和能力。确有需要再加 `--include skills`、`--include devices,sessions`，或读取对应功能接口；不每次拉取完整项目资料。后续命令沿用相同的 `--scope` / `--project` / `--runtime` 选择。

## 只读取本次需要的流程

| 用户请求 | 按需阅读 |
| --- | --- |
| 需要用户选择或补充信息，运行时没有原生提问工具 | [会话内提问](references/questions.md) |
| 发消息、文件、SVG 到公屏或团队群聊 | [消息与附件](references/chat.md) |
| 语音、音乐、普通音频或明确要求自动播放 | [音频](references/audio.md) |
| 公告、创建/修改/删除指定 TODO | [公告与待办](references/board-workflow.md)，字段见 [格式](references/board-format.md) |
| 分享或同步指定技能 | [技能发布](references/skill-publish.md) |
| 技能附带插件、增加项目按钮/表单、修改允许的界面元素 | [项目界面扩展](references/ui-extensions.md) |
| 技能声明 API Key、账号或用户 ID 依赖；按发起人选择和权限取用钥匙串 | [钥匙库](references/credentials.md) |
| 创建/保存角色、表情动作、道具、办公室，自动布局或绑定画布 | [场景流程](references/scene-workflow.md) |
| 合照、成员形象或场景参考 | [图像参考](references/image-references.md) |
| 设备/文件夹/会话备注、跨设备派工 | [备注与任务编排](references/work-dispatch.md) |

默认不广播、不写入、不生成语音。只有用户要求的操作才执行，明确的请求本身就是对应授权，不重复索要确认。群聊任务的最终回答由宿主自动回传；请求的结果附件按消息流程发送，避免重复文本。Wanwan Xiaohe 语音默认关闭，除非用户明确重新要求。

新写入使用 UUID；超时保持同一 UUID 查询或重试，只有实际成功回执才报告成功。修改前读取当前对象，保留无关内容；公告/TODO 写入后重新读取验证，冲突时重读并合并。角色修改仅限发起人自己。技能发布不授权安装、升级 CLI 或复制凭据。

需要选择时，用原生提问工具或 `question` 等待回答，不只在最终回复列选项。存背包不等于发公屏或应用到项目；无空位时保留草稿，提问选择存背包或调整布局。
