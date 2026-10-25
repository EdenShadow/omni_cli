# 资源与工程文件

`get --canvas ID` 列出网页源文件、封面、共享附件和摘要大小。
`download --canvas ID --file-id FILE_ID --output /absolute/new-file` 按权限取短期下载地址并保存，拒绝覆盖已有文件。可选 `--cdn 1` 请求签名 CDN；未配置、旧端或限制可见范围的画布自动回退受限下载。校验 SHA256，不在回复中展示签名 URL。
`attach --canvas ID --file /absolute/archive.zip --request UUID` 上传用户选定的资源。普通文件上限500MB，工程ZIP可到2GB（服务端限制为准）。目录先整理成 ZIP，排除 token、.env、账户配置和运行时凭据。上传使用现有分块接口；不把文件base64塞进模型上下文。

本地没配置 COS 时文件保存于服务端本地，返回 storage=local；配置 COS 后会上传云存储并可走现有签名 CDN，返回 storage=cos。不要把 local 称为已上传云存储。用户需要共享剪映草稿时共享源工程ZIP及其资源；这不等于已实现剪映格式的在线实时编辑器。

共享数据可由 `state --canvas ID --key main` 读取；写入用 `state --canvas ID --input /absolute/state.json --request UUID`，输入为 `{key,value,revision}`。仅在用户要求时修改，先读当前 revision，冲突后合并。

画布网页可通过 `Wanwu.files.upload(file,{onProgress,signal})` 上传用户选择或拖入的文件，返回真实 fileId 和 storage。将 fileId 交给 `Wanwu.sessions.run` 即可携带文件执行任务，见 [画布 AI 任务](ai-tasks.md)。页面监听 `files.changed` 后重新 list，可显示 AI 通过 attach 返回的资源。

`await Wanwu.files.url(fileId)` 返回受权限检查的默认下载地址；普通全团队可见画布可显式用 `Wanwu.files.url(fileId,{cdn:true})` 申请 CDN 加速，未支持时回退默认地址。只保存 fileId，不持久化短期 URL；过期后重新申请。CDN 签名地址目前有效期 15 分钟，已签发地址在有效期内不能即时撤销；密码/指定成员画布始终回退受限地址。公开分享页不开放附件 URL API。

COS 存储和 CDN 分发是两件事：`storage:cos` 仅表示已存入 COS；网页源文件仍由隔离容器的受限地址加载。资源/归档/版本化作品快照可走附件 CDN；实时笔画、撤销和在线状态走 state/collab，不能用 CDN 缓存替代实时数据。不要将 COS 密钥放进网页。

浏览器通过 `fetch` 读取 CDN 快照或图片时，CDN 还需正确配置 CORS（画布隔离来源可能为 `null`），使用无凭据请求；不能向 CDN 附带万物账户令牌。未配置跨域读取时使用受限传输或通过宿主下载，不解除画布隔离。
