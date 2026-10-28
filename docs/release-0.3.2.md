# 0.3.2

- 普通会话支持跨设备设计外观：读取项目设备和当前外观，明确指定目标，预览后应用。Codex、Claude Code 和 DeepSeek Harness 共用技能链路；桌面与 H5/WebApp 可以向 CLI 设备发起此类任务。
- 需要万物服务端 1.2.403 或更新版本。按任务发起人检查设备拥有者/项目创建者权限，冲突时拒绝覆盖；保留旧客户端静态外观，动态和工作状态按用户要求生成。
- `omni runtimes order` 查看 @Bot 顺序，`omni runtimes order set claude codex dsh` 修改，`omni runtimes order reset` 恢复 Codex → Claude Code → DeepSeek Harness。仅选择本设备已安装并绑定的运行时，正在执行的任务不受影响。
- 同步技能安装就绪检查，避免已安装技能等待其他无关会话结束。

验证：69 项测试通过，包括 CLI 自身 RuntimeBridge、SkillExchange 和技能子进程调用真实测试服务端的跨设备应用链路；95 个模块检查及导入图检查通过。未调用付费模型生成作品。

升级前结束或妥善停止常驻进程，然后运行：

```sh
npm install -g github:EdenShadow/omni_cli#v0.3.2
omni --version
omni start
```

安装来源为 GitHub 标签；此版本未发布到 npm registry。现有设备需重启常驻进程才会使用新代码与技能。
