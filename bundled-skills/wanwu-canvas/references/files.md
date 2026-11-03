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


## 内网 NAS 素材

在团队自有画布中，可按当前观看者选中的同步助手 NAS 钥匙串读取整个授权目录。首次访问由观看者确认。设备和观看者需连到同一可达内网或 VPN。分享链接、第三方网页不提供此接口。不要把临时链接写进画布源码、云数据或公屏，只保存相对路径。

```js
await Wanwu.ready;
const { entries } = await Wanwu.nas.list(); // {name,directory}；主机级配置先列共享
const { url } = await Wanwu.nas.url("素材/电影.mp4");
document.querySelector("video").src = url;
```

若已将钥匙串限定到“素材”共享，上例的路径只写“电影.mp4”。桌面版的媒体地址支持分段读取和拖动播放。WebApp 的 `url` 由浏览器从内网读取文件后生成 Blob 地址，替换素材时可调用 `URL.revokeObjectURL(url)`。浏览器须允许本地网络访问；对于大文件或无法嵌入的浏览器，用 `Wanwu.nas.link(path)` 在用户点击时提供限时内网直链，或在桌面端播放。已有网站提供的原生文件链接沿用其权限与有效期。不要使用 `smb://` 作为图片或视频的 src。
