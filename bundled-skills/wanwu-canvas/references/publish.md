# 创建与修改

所有命令：`node scripts/canvas.mjs [--scope UUID] ACTION ...`。可原生 Codex 调用，沿用本机运行时发现。`context` 只取简短身份；`context --include sessions` 按需取可绑定会话。

指定 ID 时直接 `get --canvas ID`；没提供 ID 才 `list`。本地建立 manifest JSON：
```json
{
  "title":"团队数据看板",
  "note":"公开的使用说明",
  "tags":["数据看板"],
  "kind":"owned",
  "entry":"index.html",
  "files":[{"path":"index.html","file":"/absolute/work/index.html"},{"path":"app.js","file":"/absolute/work/app.js"}]
}
```
`path` 为网页包内相对路径，不得包含 ..、问号、#、% 或反斜杠。网页每文件最多 8 MB，整包最多 32 MB/200 文件。大素材用附件，HTML 通过 SDK 取得下载地址。允许 HTML/CSS/JS/WASM 等资源；所有页面在隔离容器执行，不能访问父窗口、Cookie、文件系统。必须绑定资源清单，不能热链本机路径。

`tags` 为可选字符串数组，用于首页分类，卡片不显示标签；详情中可查看和手动编辑。最多 12 个、每个 1–32 字，不含逗号或换行；去除首尾空格并合并重复标签。更新旧画布时省略此字段保留原标签，传 `[]` 清空。可使用团队已有的分类名称，避免同义分类。

新建默认绑定发起发布的 AI 会话（服务端按可信运行时身份关联，不能用自填 sessionId 冒充）。原生会话未导入时会按需创建映射。更新省略 bindings 会保留原绑定；显式非空数组可换成指定的可访问会话。设备离线、会话被删或无权限时入口隐藏。

创建：`publish --input /absolute/manifest.json --request UUID`。
修改：先下载需要的源文件，manifest 中增加读取到的 `revision`，使用 `publish --canvas ID --input /absolute/manifest.json --request UUID`；也兼容 manifest 中提供 `id`。两处 ID 同时提供时必须一致；更新不能省略 revision。发送完整网页文件集，并保留标题、备注、类型、入口与旧功能、资源和绑定。不同版本不可变，失败不替换正在运行版本。

第三方链接：manifest 使用 `{ "kind":"external", "title":"…", "url":"https://…", "note":"…", "bindings":[] }`。无法绕过网站的 CSP、嵌入或登录限制；不可用万物 API 读取第三方页面内容。不自动截取第三方登录内容。

`publish` 默认截图实际页面；也可在 manifest 的 `cover` 中选择生成图片、专门构建的封面页面或保留旧封面，见 [封面设计与接口](covers.md)。更新网页期间保留原封面，等新封面成功后再替换。封面失败不影响已保存的网页，不重复建画布。

`patch --canvas ID --input /absolute/patch.json --request UUID` 修改标题/标签/备注/绑定，输入包含 revision。
`delete --canvas ID --revision N --request UUID` 删除；用户须明确指定，服务端检查作者/项目主人。

需要自定义服务端逻辑时，将根目录 `wanwu.server.json` 和其 entry 脚本加入完整 files 清单；不是上传到独立外部服务器。发布前会隔离验证脚本，成功更新会关闭旧版本内存房间。先读 [服务端房间](server-rooms.md)。
