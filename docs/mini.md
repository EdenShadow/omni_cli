# Omni Mini：公屏极简安装

只登录万物账号、查询可 @会话及备注、发送加密公屏消息/派工、读取公屏反馈。无需本地 Codex、Claude、DSH、桌面界面或执行设备绑定。远端被 @的设备仍须在线并有可用 AI。账号和项目权限沿用完整版本。

需要 Node.js 24+。官网提供独立安装包（未发布到 npm registry）：

```sh
npm install --global https://wanwu321.com/assets/omni-mini-0.3.3.tgz
omni-mini setup
```

国内下载可将上面的域名改为 `wanwu123.cn`。安装后用 `omni-mini --help` 查看命令。

从源码运行 `node bin/omni-mini.mjs --help` 不需要 npm install。构建独立安装包：

```sh
npm run package:mini
npm install --global ./.local/mini-package/edenshadow-omni-mini-0.3.3.tgz
omni-mini setup
omni-mini projects
omni-mini agents list PROJECT_ID
omni-mini chat send PROJECT_ID --session SESSION_ID --text '请整理今日进展' --wait
```

安装包没有第三方 npm 依赖，也不包含 AI 执行桥、模型 SDK 或技能库。配置默认存放于 `~/.omni-mini`，可用 `OMNI_MINI_HOME` 覆盖；与完整版登录隔离。`OMNI_SERVER_URL` 可在登录前指定 HTTPS 服务端。

`agents list` 返回会话 ID、@名称、备注、设备与在线状态；`agents watch` 持续输出变化。精确派工用 `--session`，避免同名误选。`chat list/watch/wait` 支持历史、游标和任务反馈；详见 `chat --help`。发送不确定时用相同 `--id UUID` 和原内容重试，不能换 ID 重发。等待超时不取消远端任务。

始终保留公屏端到端加密；首次取得房间密钥可能需要已有解锁客户端在线，不降级为明文。Mini 不会在本机执行公屏指令或把成员备注当成指令。

零外部依赖不代表零内存占用；目前没有树莓派实机最低内存保证。硬件应能运行 Node.js 24 的对应架构版本。
