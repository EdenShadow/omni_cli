# 资源与工程文件

`get --canvas ID` 列出网页源文件、封面、共享附件和摘要大小。
`download --canvas ID --file-id FILE_ID --output /absolute/new-file` 按权限取短期下载地址并保存，拒绝覆盖已有文件。可选 `--cdn 1` 请求签名 CDN；未配置、旧端或限制可见范围的画布自动回退受限下载。校验 SHA256，不在回复中展示签名 URL。
`attach --canvas ID --file /absolute/archive.zip --request UUID` 上传用户选定的资源。普通文件上限1GB，工程ZIP可到2GB（服务端限制为准）。目录先整理成 ZIP，排除 token、.env、账户配置和运行时凭据。上传使用现有分块接口；不把文件base64塞进模型上下文。

本地没配置 COS 时文件保存于服务端本地，返回 storage=local；配置 COS 后会上传云存储并可走现有签名 CDN，返回 storage=cos。不要把 local 称为已上传云存储。用户需要共享剪映草稿时共享源工程ZIP及其资源；这不等于已实现剪映格式的在线实时编辑器。

共享数据可由 `state --canvas ID --key main` 读取；写入用 `state --canvas ID --input /absolute/state.json --request UUID`，输入为 `{key,value,revision}`。仅在用户要求时修改，先读当前 revision，冲突后合并。

画布网页可通过 `Wanwu.files.upload(file,{onProgress,signal})` 上传用户选择或拖入的文件，返回附件对象，其 id 是 fileId，storage 是存储后端。将 fileId 交给 `Wanwu.sessions.run` 即可携带文件执行任务，见 [画布 AI 任务](ai-tasks.md)。页面监听 `files.changed` 后重新 list，可显示 AI 通过 attach 返回的资源。

`await Wanwu.files.url(fileId)` 返回受权限检查的默认下载地址；普通全团队可见画布可显式用 `Wanwu.files.url(fileId,{cdn:true})` 申请 CDN 加速，未支持时回退默认地址。只保存 fileId，不持久化短期 URL；过期后重新申请。CDN 签名地址目前有效期 15 分钟，已签发地址在有效期内不能即时撤销；密码/指定成员画布始终回退受限地址。分享页只列出可随链接下载的附件。files.url 与 files.download 均按该链接的权限取文件，见 [链接分享](sharing.md)。

COS 存储和 CDN 分发是两件事：`storage:cos` 仅表示已存入 COS；网页源文件仍由隔离容器的受限地址加载。资源/归档/版本化作品快照可走附件 CDN；实时笔画、撤销和在线状态走 state/collab，不能用 CDN 缓存替代实时数据。不要将 COS 密钥放进网页。

浏览器通过 `fetch` 读取 CDN 快照或图片时，CDN 还需正确配置 CORS（画布隔离来源可能为 `null`），使用无凭据请求；不能向 CDN 附带万物账户令牌。未配置跨域读取时使用受限传输或通过宿主下载，不解除画布隔离。

## 轻量首屏与素材发布

导入旧网页、制作新网页和用户在运行中的页面添加素材时，使用同一套来源规则。图片、音视频、字体、模型、PDF、PPTX 和下载件均适用。

| 素材来源 | 页面保存什么 | 如何使用 |
| --- | --- | --- |
| 已有稳定的 HTTPS CDN 地址，原站允许引用且观看者能访问 | 原 URL，保留路径、版本和图片变换等参数 | 可直接填入网页或业务记录，用到时从原 CDN 取；不用下载、转存或再上传。CLI 的 `asset --url URL` 只返回引用，不联网。 |
| 当前画布已有附件 | fileId | `asset --canvas ID --file-id FILE_ID` 核对归属；打开时用 `Wanwu.files.url(fileId,{cdn:true})` 换取地址。 |
| AI 生成、本机导入或用户给的文件 | 上传后返回的 fileId | 作者使用 `asset --canvas ID --file /绝对路径 --request UUID`；运行中的页面用 `Wanwu.files.upload(file)` 处理文件选择和拖放。只在上传成功后保存引用。 |

带到期时间或访问凭据的 URL 只适合当次使用。万物附件保留原 fileId，外部私有资源保留来源标识并按查看者权限重新申请地址。仅靠 URL 形式无法证明长期有效或共享授权；不能刷新时，使用用户已授权上传的源文件。引入公开 CDN 不会让原资源变成画布私有。外站防盗链、跨域读取和字体 CORS 应在实际画布中验证。

带“粘贴链接 / 上传文件”的页面，可将技能内 `assets/asset-source.mjs` 作为网页模块一起发布。用 `saveAssetSource(url、File 或 {fileId})` 返回可保存的引用，用 `resolveAssetSource(ref)` 在显示时取地址。静态网页已有合适的链接可直接沿用。

网页包保留 HTML、CSS、JS、必要的启动数据，以及首屏所需的小预览。单份素材或 data URL 达 64 KiB、网页包内这些素材合计达 256 KiB 时，默认发布预检会指出文件。SVG 插图、JSON 里的 Base64 原图、生成器产生的字节数组也应从源码拆出。仅在用户明确要求离线自包含时，manifest 可指定 `"assetDelivery":"embedded"`，原网页包大小限制仍适用。

1. 新建时先发布能显示标题和首屏预览的轻量页面，取得画布 ID；已有画布直接沿用 ID。需要外部分享时，在素材准备好后再按要求设置分享。
2. 本地文件需上传时，素材逐件执行 `asset --canvas ID --file /绝对路径 --request UUID`，它按文件名、大小和 SHA-256 复用当前画布的相同附件；新素材才分块上传，相同上传超时重试沿用同一 UUID。把返回的 `id` 写入页清单，与页面顺序分开保存。更换一页只上传更换的文件。读取最新 revision 后发布完整的轻量网页代码。
3. 显示时用 `const {url} = await Wanwu.files.url(fileId,{cdn:true})` 给当前附件图片设置 `src`。保留预览至高清图解码完成；快速翻页时只应用仍属于当前页的结果。当前页就绪后至多预取下一页，长列表在接近视口时取图。音视频使用海报并按播放意图加载，PPTX/PDF/ZIP 下载件等到用户点击再取地址。重新打开或地址过期时按 ID 重新申请。
4. 以预期用户身份验证首屏能显示、首项高清资源可取、翻页能更新。核对附件返回的大小和哈希，区分已存 COS、确实从 CDN 取回和权限回退三种情况。对外分享只授权预期可交付的附件，依现有分享规则逐件验证。保留原访问范围。

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

本地附件由新版 CLI 优先从设备直传 COS；浏览器在服务端声明 `files.direct.v1` 后使用直传。服务端仅签发短时限定 PUT、验证云端对象并冻结永久文件，不中转大文件。旧服务端或未启用跨域时沿用分块上传。成功持久化后自动释放临时上传配额；签名上传过期且未完成的临时对象由服务端回收。
