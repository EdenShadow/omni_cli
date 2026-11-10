# 让画布操作这台机器的内网服务

用户用自然语言说明设备和目标即可。负责找出可调用的本地脚本或管理 API、编写适配器、发布画布、安装绑定和验收。软路由、NAS、RPA 等均用相同接口。先只读识别目标和真实接口，确认所需权限；密码在设备本地配置或从系统钥匙串读取，不放进画布、动作参数、返回值或聊天记录。

在设备主人的完全访问会话中，准备一个独立 .mjs 文件。它由本机 Node 启动，工作目录为万物的适配器目录，无项目 node_modules，stdin 是一份 {action,args,phase,requestId} JSON。stdout 只输出一份 JSON 对象，失败以非零状态退出。使用固定目标、接口和允许的参数；命令用 execFile 的参数数组。需要调用原有脚本时用绝对路径，原有程序的安装和访问权限须由设备主人管理。普通按钮全程不调用模型。

- read 的 execute 阶段从目标读取脱敏状态。
- write 的 execute 阶段检查字段、预期旧值，向目标提交一次；verify 阶段仅再次读取并返回 {verified:实际值匹配,state:脱敏实际值}。手动覆盖、超时、网络断开时回读后再做决定。暴露防火墙、网关等可能切断控制链路的修改前，先验证目标有独立的本地限时回滚机制。
- 不把“执行任意命令”、可变 URL、脚本源码、token 或自由拼接的 shell 当成动作参数。每次脚本最长 30 秒，结果控制在 64 KiB 内。args 仅支持已声明的短字符串、有限数字和布尔值。

在自有画布发布后创建本机 JSON。用户不用填写此文件：
```json
{"canvasId":"实际画布UUID","name":"router","title":"办公室软路由","members":[],"script":"/实际路径/router.mjs","actions":[{"name":"dns.read","title":"读取 DNS","mode":"read","fields":[]},{"name":"dns.apply","title":"应用 DNS","mode":"write","fields":[{"name":"dns","type":"string","required":true}]}]}
```

沿用本轮 --scope，执行 scripts/sync.mjs service-install --input FILE --request UUID。members 默认只授权设备主人，明确需要共享时填项目成员真实 ID。提示主人检查本机脚本和授权窗口，确认后绑定。更新代码或画布版本需重新确认。验收先从画布读真实值；写入只按用户明确要求，核对 verify 回读。未获授权或设备无法访问时说明实际缺少的条件。

AI 运维会话也可调用已授权动作：service-list --input FILE 使用 {canvasId}，读取 items 和画布 contentRevision（或通过画布 get 获取）。service-invoke --request UUID --input FILE 使用 {canvasId,contentRevision,service:"router",method:"dns.read",args:{}}。service-status --input FILE 使用 {canvasId,id:任务ID}，直到 succeeded、failed、cancelled、expired 或 needs_review。注册在别的设备上的服务也能按成员权限调用。撤销用 service-revoke --request UUID --input FILE，输入 {canvasId,name}，在原设备主人的会话执行。发布新版本、服务返错、同名冲突时不要重建无关画布。
