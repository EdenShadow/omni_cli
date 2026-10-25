# Omni CLI · 万物命令行设备

在没有图形界面的 Linux 服务器，或不需要桌面版的 Windows / macOS 机器上，将已有的 **Codex、Claude Code、DeepSeek Harness** 接入万物项目。

CLI 常驻时负责接收任务、启动本机 AI、回传流式回复、附件和任务结果，以及同步团队技能。不附带 Electron、远控服务或万物内置 AI runtime；AI 终端只在需要时启动。

## 安装与启动

需要 **Node.js 24+**，并已安装、登录至少一种支持的 AI 终端。使用普通系统用户运行，不需要管理员/root 权限。

```sh
npm install -g github:EdenShadow/omni_cli#v0.1.0
omni setup
```

也可从源码运行：

```sh
git clone https://github.com/EdenShadow/omni_cli.git
cd omni_cli
npm ci --ignore-scripts
node bin/omni.mjs setup
```

`omni` 和 `omnicli` 是同一个命令。向导会依次：

1. 输入万物账号、密码（密码不回显，也不保存）。
2. 检测本机 AI 终端，选择需要绑定的终端。
3. 设置设备名称、公屏任务工作目录、文件共享范围和执行审批方式。
4. 安装默认技能并把设备注册到当前账号。
5. 选择已加入的项目，以及“默认工作区”或“导入全部已有会话”。
6. 启动常驻连接。

**默认工作区不会上传旧会话**。选择导入全部会话会分页导入所选终端的历史会话索引；历史内容在查看或使用时按协议读取。失效的旧工作目录会跳过。也可以先绑定，稍后在万物网页/桌面版将这台设备放进项目。

之后使用 `omni start`。关闭进程后设备离线；下一次启动会重新连接并补发尚未确认的结果。

## 项目协作与默认技能

随包附带并安装到**已选择的终端**：

- 万物技能同步助手 `wanwu-skills-sync`
- 万物画布 `wanwu-canvas`
- 团队公告设计师 `announcement-designer`
- AI 项目角色工坊 `office-character-studio`
- 项目场景设计师 `office-space-designer`

通过默认技能，AI 会话可以在授权范围内读取项目上下文、协作操作画布/公告/待办、共享文件、使用团队技能、跨设备派工。技能依赖的 Python、生成服务或第三方凭据仍需要按技能说明配置；CLI 不附带这些第三方运行环境或密钥。

加入项目后自动接收技能变更通知，并定期核验。同步采用现有万物校验、分块传输、重试和备份机制；正在执行的任务结束后才切换技能版本。相互冲突的项目技能版本会报错，避免静默覆盖。

项目成员可以按现有权限调用共享会话，也可以在公屏 **@会话** 发起任务，接收回复和输出附件。原生 AI 会话调用协作技能时，CLI 通过本机受限的上下文接口提供项目能力；公屏派工按发起人权限运行，不把设备主人的密钥权限借给其他人。

CLI 不渲染项目界面；技能的 UI 扩展会显示在项目成员的网页/桌面客户端。画布读写与文件 API 可用，**浏览器渲染截图/封面自动捕获不可用**，可上传生成的封面替代。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `omni runtimes` | 检测本机支持的 AI 终端 |
| `omni login` | 登录已有万物账号 |
| `omni bind` | 绑定/调整终端并安装默认技能 |
| `omni start` | 前台常驻 |
| `omni status` | 查看本地账号、设备和工作目录，不输出凭据 |
| `omni projects` | 列出已加入的项目及 ID |
| `omni join <project-id>` | 将设备加入已有成员权限的项目 |
| `omni import <project-id> [codex\|claude\|dsh]` | 导入全部已有会话 |
| `omni skills sync` | 同步已绑定项目的技能后退出 |
| `omni access` | 调整共享文件范围与执行审批 |
| `omni logout` | 清除 CLI 凭据，不删除工作文件或技能 |

修改登录、绑定或权限前，请先停止正在运行的 CLI。每个配置目录只允许运行一个实例。账号尚未创建时，请先在万物注册。

## 配置与权限

| 环境变量 | 含义 |
| --- | --- |
| `OMNI_HOME` | 独立的配置/任务目录，默认 `~/.omni-cli` |
| `OMNI_SERVER_URL` | 登录时选择 HTTPS 服务端，默认与万物客户端一致 |
| `WANWU_CODEX_PATH` | 指定 Codex 可执行文件 |
| `WANWU_CLAUDE_PATH` | 指定 Claude Code 可执行文件 |
| `WANWU_DSH_PATH` | 指定 DeepSeek Harness 可执行文件 |
| `CODEX_HOME` / `CLAUDE_CONFIG_DIR` / `DSH_HOME` | 对应终端自己的配置与技能目录 |
| `WANWU_RUNTIME_DIR` | 原生会话发现目录，默认 `~/.wanwu/runtime`；修改时也需传给 AI 终端 |

CLI 的设备身份和登录状态与万物桌面版独立。密码仅用于 HTTPS 登录；会话令牌保存在用户私有目录，Unix 使用目录 `0700` / 文件 `0600`，Windows 限制为当前用户和 SYSTEM 的 ACL。**这是操作系统权限保护，不是磁盘内容加密**；不要分享或提交配置目录。需要加密落盘时可使用系统磁盘加密。

默认仅向团队共享项目已导入的目录，并在 AI 需要时请求授权；可在设置中明确改为全部可访问目录/完整执行。任何选项都不提升系统用户权限。macOS 受保护文件夹仍可能需要系统授权；Linux 无图形界面也无需模拟授权弹窗。远端授权请求可在万物中处理。

## Linux 后台运行（可选）

先用目标普通用户完成 `omni setup`，再按实际绝对路径创建用户级 systemd 服务：

```ini
[Unit]
Description=Omni CLI device bridge
After=network-online.target

[Service]
Type=simple
ExecStart=/absolute/path/to/node /absolute/path/to/omni_cli/bin/omni.mjs start
Environment=PATH=/home/you/.local/bin:/usr/local/bin:/usr/bin:/bin
Restart=on-failure
RestartSec=5
KillMode=control-group
TimeoutStopSec=30

[Install]
WantedBy=default.target
```

服务使用与登录向导相同的用户、HOME 和配置目录。NVM 或其他自定义安装需要填写真实 Node 与终端路径，可使用上述 `WANWU_*_PATH`。Windows/macOS 可先在终端运行 `omni start`；当前版本不自动注册系统服务。

## 开发和验证

```sh
npm ci --ignore-scripts
npm run check
npm test
npm pack
```

协议核心从万物代码中抽取，来源记录在 `CORE_SOURCE.json`。`scripts/import-core.mjs <wanwu-source-directory>` 是维护工具，仅复制明确的模块依赖和默认技能，不读取用户数据、服务端数据库或发布凭据。

CI 在 Windows、macOS、Linux 的 Node.js 24 上检查语法、模块加载、默认技能安装、API 凭据隔离、公屏回复流、离线重试、技能更新屏障和目录权限。实际模型调用还依赖用户自己的终端版本、登录状态和额度。
