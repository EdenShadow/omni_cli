# 资源与工程文件

`get --canvas ID` 列出网页源文件、封面、共享附件和摘要大小。
`download --canvas ID --file-id FILE_ID --output /absolute/new-file` 按权限取短期下载地址并保存，拒绝覆盖已有文件。可选 `--cdn 1` 请求签名 CDN；未配置、旧端或限制可见范围的画布自动回退受限下载。校验 SHA256，不在回复中展示签名 URL。
`attach --canvas ID --file /absolute/archive.zip --request UUID` 上传用户选定的资源。普通文件上限1GB，工程ZIP可到2GB（服务端限制为准）。目录先整理成 ZIP，排除 token、.env、账户配置和运行时凭据。上传使用现有分块接口；不把文件base64塞进模型上下文。

本地没配置 COS 时文件保存于服务端本地，返回 storage=local；配置 COS 后会上传云存储并可走现有签名 CDN，返回 storage=cos。不要把 local 称为已上传云存储。用户需要共享剪映草稿时共享源工程ZIP及其资源；这不等于已实现剪映格式的在线实时编辑器。

共享数据可由 `state --canvas ID --key main` 读取；写入用 `state --canvas ID --input /absolute/state.json --request UUID`，输入为 `{key,value,revision}`。仅在用户要求时修改，先读当前 revision，冲突后合并。

画布网页可通过 `Wanwu.files.upload(file,{onProgress,signal})` 上传用户选择或拖入的文件，返回真实 fileId 和 storage。将 fileId 交给 `Wanwu.sessions.run` 即可携带文件执行任务，见 [画布 AI 任务](ai-tasks.md)。页面监听 `files.changed` 后重新 list，可显示 AI 通过 attach 返回的资源。

`await Wanwu.files.url(fileId)` 返回受权限检查的默认下载地址；普通全团队可见画布可显式用 `Wanwu.files.url(fileId,{cdn:true})` 申请 CDN 加速，未支持时回退默认地址。只保存 fileId，不持久化短期 URL；过期后重新申请。CDN 签名地址目前有效期 15 分钟，已签发地址在有效期内不能即时撤销；密码/指定成员画布始终回退受限地址。分享页只列出可随链接下载的附件。files.url 与 files.download 均按该链接的权限取文件，见 [链接分享](sharing.md)。

COS 存储和 CDN 分发是两件事：`storage:cos` 仅表示已存入 COS；网页源文件仍由隔离容器的受限地址加载。资源/归档/版本化作品快照可走附件 CDN；实时笔画、撤销和在线状态走 state/collab，不能用 CDN 缓存替代实时数据。不要将 COS 密钥放进网页。

浏览器通过 `fetch` 读取 CDN 快照或图片时，CDN 还需正确配置 CORS（画布隔离来源可能为 `null`），使用无凭据请求；不能向 CDN 附带万物账户令牌。未配置跨域读取时使用受限传输或通过宿主下载，不解除画布隔离。

### 归档到项目存储

任务要求保存本地附件或工程时，用 `archive --canvas ID --file /absolute/project.zip --request UUID`。如有指定共享盘内的相对路径，加 `--path 项目/交付/project.zip`。执行设备通过万物同步助手的钥匙串直连 SMB；返回 `storage: nas` 和共享盘内的相对路径即完成归档。未配置时使用原有画布附件流程；已选 NAS 连接失败或权限不足时，向用户报告错误。

需要从 NAS 取文件时，用同项目和发起人范围调用万物同步助手的 `nas-get --path 项目/交付/project.zip --output /absolute/new.zip`。已有画布 fileId 仍用 `download`。NAS 归档返回相对路径；在内网画布中用下述接口换取临时读取地址。仅用户另行要求网页附件或对外分享时，按对应流程上传并检查权限。


## 内网 NAS 文件读写

先区分操作发生在哪一端。画布页面通过 NAS HTTP 只读访问当前观看者选中的共享目录。执行任务的设备用同步助手通过 SMB 列目录、取回或写入文件。两端可以在不同机器上。此方法适用于文档、表格、压缩包、媒体等任意文件；是否能预览取决于文件格式和客户端。

| 需求 | 调用 | 完成依据 |
| --- | --- | --- |
| 浏览目录 | `Wanwu.nas.list(relativeDirectory)` | 返回 `entries`，区分目录和文件 |
| 页面读取、解析、预览 | `Wanwu.nas.url(relativeFile)` | 用返回的 `url` 读取文件内容或交给显示控件，验证一次实际使用 |
| 用户点击下载或打开大文件 | `Wanwu.nas.link(relativeFile)` | 使用返回的限时地址，客户端能访问该内网 |
| 从 NAS 取回到执行设备 | 同步助手 `nas-get --path … --output /新的绝对路径` | 核对返回的相对路径、字节数和 SHA-256 |
| 将执行设备上的文件写入 NAS | 同步助手 `nas-put --file /绝对路径 --path …` | 返回 `stored`、`storage: nas`、路径、字节数和 SHA-256 |

共享盘配置只填主机时，相对路径从共享名开始，如 `Team/reports/result.csv`；配置已限定到 Team 时，路径是 `reports/result.csv`。用 list 确认基准，从父目录和条目原名构造相对路径，保留空格、中文和大小写。不要拼接 SMB 地址、HTTP 端口或自己编码文件名来构造媒体链接。

```js
// relativeFile 来自当前目录中选中的文件。只保留路径，打开时再换取地址。
await Wanwu.ready;
const { url } = await Wanwu.nas.url(relativeFile);
try {
  const response = await fetch(url);
  if (!response.ok) throw Error('文件读取失败 HTTP ' + response.status);
  const bytes = await response.arrayBuffer(); // 小型二进制文件；文本可用 text()
  // 将 bytes 交给对应解析器。大文件优先使用下载或分段播放。
} finally {
  if (url.startsWith('blob:')) URL.revokeObjectURL(url);
}
```

图片、音视频可以直接将 SDK 返回的 url 赋给控件 src。桌面端可能返回 `wanwu://canvas/api/nas-media/…`，浏览器端可能返回 Blob URL。不要用 HTTP 协议白名单误拦桌面地址。控件仍在使用时保留 URL；更换或关闭后再释放 Blob。过期时按原相对路径重新请求。临时地址和访问票据不存云数据或公屏。分享页面和第三方页面不能申请此能力。

如果需求是在画布上保存编辑结果，先明确结果如何传到有权限的执行设备，再通过 SMB 写入用户指定的 NAS 路径。网页 SDK 没有 nas.put；网关不支持 PUT/POST 上传。云附件上传、画布数据保存与 NAS 落盘是不同结果，不要互相代替。

验收使用目标文件本身。文本解析内容，二进制检查大小或哈希，媒体等待解码或分段播放成功。单独报告目录、文件读取、文件写入的验证情况，不用目录列表、ready 或首页响应代替文件读写。只有用户授权写入时才做写入验证。
