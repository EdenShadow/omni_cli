# NAS 文件同步

在「项目 Skills → 万物同步助手 → 钥匙串」配置 SMB 共享目录、用户名、密码和可选域。仅填 `smb://192.168.1.23` 时，根目录按账号权限列出文件共享；取文件必须写“共享名/文件路径”。限定到一个共享时地址示例为 `smb://nas/Team/Projects` 或 `\\nas\Team\Projects`。执行任务的电脑需要能从局域网或 VPN 访问共享目录。每个任务按当前发起人的项目权限取用可见凭据；只在钥匙串设置这些值。

查询当前 HTTP 主机和端口时，运行 `node scripts/sync.mjs credentials-status --skill wanwu-skills-sync` 并沿用当前任务范围。在 `nas-smb` 依赖下，以 `currentEntryId` 找到选中的条目，读取 `nasHttpOrigin`（协议、主机及实际端口）和 `nasWeb`。万物设备默认固定监听 54758，可在 NAS 钥匙设置中修改。技能启动执行 NAS HTTP 任务时先查询当前状态，nasHttpPort 是配置端口，nasHttpOrigin 是已就绪服务的实际地址。地址缺失时报告当前状态及地址尚不可用。不要扫描常用端口或猜测；读取画布文件仍通过画布授权接口。

按任务选择操作，沿用当前的 `--scope` 或 `--context`：

- 明确要求写入 NAS，用 `node scripts/sync.mjs nas-put --file /absolute/project.zip --path 交付/project.zip`。子目录按需创建。文件夹先整理成 ZIP。重复保存相同内容可重试；同名不同内容应另取文件名。
- 读取或查找共享文件，用 `nas-list`（可加 `--path 交付`）和 `nas-get --path 交付/project.zip --output /absolute/new.zip`。取回目标必须是新文件。共享盘内始终用相对路径。
- 用户要求归档本地附件或工程文件时，有指定画布则调用万物画布的 `archive --canvas ID --file /absolute/project.zip --request UUID`。有 NAS 时写入共享盘；未配置时沿用原画布附件存储。没有画布且只要求保存时，可先用 `nas-put`；若没有配置，按原任务已授权的附件交付方式处理，不擅自发公屏。明确只准存 NAS 时，缺配置就提示设置。
- 用户同时要求归档并告知公屏时，用 `chat --destination auto --request UUID --file /absolute/project.zip`。配置了 NAS 时，公屏只收到共享盘内的文件路径；未配置时发送原有附件。`--destination nas` 要求写入成功后再通知。普通发消息或发送可直接下载的公屏附件仍用原来的 `chat`。
- 存储不可达、权限不足、凭据被撤销或写入校验失败时，停止并报告。不得自行换账号、改存 CDN 或把用户名、密码、带凭据的链接放进消息或网页。用户提供的 NAS 路径不能用来替换钥匙串里的主机。

桌面客户端保存 NAS 后，设备先验证 SMB 读取能力并检测同一 NAS 的 HTTP/HTTPS 素材服务，已有服务可用时复用。否则由这台万物 AI 设备提供仅内网可达的只读 HTTP，设备需保持在线。旧钥匙串可编辑并保存一次启用。画布使用 `Wanwu.nas.list(path)`、`Wanwu.nas.url(path)`；无需把凭据写进网页。


## 文件读写与连通性验收

按任务选用入口。AI 在执行设备上处理任何 NAS 文件时用 SMB；页面预览或下载用画布 SDK 提供的限时 HTTP 访问。画布中生成的内容须先通过受支持的传输方式交给执行设备，再调用 nas-put。没有可写入的本地输入文件时，不报告已归档。

- **读。** 先用 nas-list 定位指定条目，再用 nas-get 取回到新的本地文件。二进制保留原字节并核对大小、SHA-256；要解析或预览时再验证实际格式。只列出共享名不能确认某个文件可读。
- **写。** 只有用户要求写入时，把授权的源文件用 nas-put 写到目标相对路径。命令会校验临时文件后提交，保留不同内容的同名文件。核对回执路径、大小、SHA-256。同名冲突时向用户说明目标冲突，避免自行覆盖。不要把取回、画布状态或云附件当作 NAS 写入。
- **HTTP。** 从当前任务范围的 credentials-status 读取当前钥匙的实际地址。NAS 主机、提供 HTTP 的设备、执行 SMB 的设备可能不同。端口可自定义，根路径 404 或 OPTIONS 204 只能说明服务有响应；验证文件须在有权限的画布使用 nas.url / nas.link。只有读取页面或范围请求成功才报告相应能力可用。公网、局域网和其他设备上的访问应分别验证。
- **排错。** 主机不可达表示当前执行进程未连上 SMB；区分 TCP 连接、凭据验证、目录权限、文件读取和客户端解析。不要仅据 EHOSTUNREACH 判定用户未给本地网络权限。只读 HTTP 不接收文件写入。

在 Mac 上照常运行本技能的命令。安装在系统或用户「应用程序」目录的万物 App 会直接执行 NAS 操作，沿用本次会话的钥匙授权。普通终端的 Node 或 curl 报错时，只能据此判断该进程的连接。要验证 NAS 自带的文件服务（`nasWeb=existing`），使用已知文件的完整网址运行 `node scripts/sync.mjs nas-http-check --url <文件网址>`，沿用相同项目或会话。该命令在同一 App 环境请求开头最多 128 字节，返回实际 HTTP 状态、范围和样本摘要。校验时与 SMB 读回文件的相同前缀比较。需要通过 HTTP 读取全文时用 `nas-http-get --url <文件网址> --output /新的绝对路径`，返回完整字节数和 SHA-256。根路径 403 可以和具体文件返回 200 或 206 同时出现。若使用万物提供的临时地址（`nasWeb=ready`），在目标画布用 `Wanwu.nas.url` 验证文件、用 `Wanwu.nas.list` 验证目录。
