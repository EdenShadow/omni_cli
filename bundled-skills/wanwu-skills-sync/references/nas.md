# NAS 文件同步

在「项目 Skills → 万物同步助手 → 钥匙串」配置 SMB 共享目录、用户名、密码和可选域。仅填 `smb://192.168.1.23` 时，根目录按账号权限列出文件共享；取文件必须写“共享名/文件路径”。限定到一个共享时地址示例为 `smb://nas/Team/Projects` 或 `\\nas\Team\Projects`。执行任务的电脑需要能从局域网或 VPN 访问共享目录。每个任务按当前发起人的项目权限取用可见凭据；只在钥匙串设置这些值。

按任务选择操作，沿用当前的 `--scope` 或 `--context`：

- 明确要求写入 NAS，用 `node scripts/sync.mjs nas-put --file /absolute/project.zip --path 交付/project.zip`。子目录按需创建。文件夹先整理成 ZIP。重复保存相同内容可重试；同名不同内容应另取文件名。
- 读取或查找共享文件，用 `nas-list`（可加 `--path 交付`）和 `nas-get --path 交付/project.zip --output /absolute/new.zip`。取回目标必须是新文件。共享盘内始终用相对路径。
- 用户要求归档本地附件或工程文件时，有指定画布则调用万物画布的 `archive --canvas ID --file /absolute/project.zip --request UUID`。有 NAS 时写入共享盘；未配置时沿用原画布附件存储。没有画布且只要求保存时，可先用 `nas-put`；若没有配置，按原任务已授权的附件交付方式处理，不擅自发公屏。明确只准存 NAS 时，缺配置就提示设置。
- 用户同时要求归档并告知公屏时，用 `chat --destination auto --request UUID --file /absolute/project.zip`。配置了 NAS 时，公屏只收到共享盘内的文件路径；未配置时发送原有附件。`--destination nas` 要求写入成功后再通知。普通发消息或发送可直接下载的公屏附件仍用原来的 `chat`。
- 存储不可达、权限不足、凭据被撤销或写入校验失败时，停止并报告。不得自行换账号、改存 CDN 或把用户名、密码、带凭据的链接放进消息或网页。用户提供的 NAS 路径不能用来替换钥匙串里的主机。

桌面客户端保存 NAS 后，设备先验证 SMB 读取能力并检测同一 NAS 的 HTTP/HTTPS 素材服务，已有服务可用时复用。否则由这台万物 AI 设备提供仅内网可达的只读 HTTP，设备需保持在线。旧钥匙串可编辑并保存一次启用。画布使用 `Wanwu.nas.list(path)`、`Wanwu.nas.url(path)`；无需把凭据写进网页。
