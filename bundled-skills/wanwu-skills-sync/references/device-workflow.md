# 在会话里修改指定设备外观

支持桌面端、H5/WebApp 发起的会话，以及 omni-cli 承载的 Codex、Claude Code、DeepSeek Harness。执行创作的电脑与目标电脑可以不同；目标离线也能修改项目里的外观。用户要求的电脑、云、机械臂等形态是开放创意，不是模板白名单。

沿用本轮 `--scope ID` 或 `--context PATH`，下面命令均通过本技能的 `scripts/sync.mjs` 执行。

1. `context` 检查 `capabilities.sceneDevices`；不支持时说明需要升级服务端，不绕过权限。
2. `scene-context` 读取 `devices` 的 `id`、项目内 `name`、`canEditAppearance`、`appearanceAssetId`。按用户明确指定的设备匹配；“本机/这台机”仅在上下文明确指向执行设备时用 `context.deviceId`。不能把执行设备自动当成用户所说的另一台目标。多个同名或指代不明时，用会话内提问让用户选择，再使用 ID。
3. 以新 UUID 和新空目录准备：

```sh
scene-prepare --request UUID --kind device --device DEVICE_ID --text-file /absolute/request.txt --workspace /absolute/device-edit
```

也可用 `--device-name EXACT_PROJECT_NAME`，但不能与 `--device` 同时传。同名会拒绝，不猜测。发起人必须是目标设备拥有者或项目创建者；权限不是执行电脑主人的权限。

4. 使用 office-space-designer 的 `references/device-appearance.md`。读取 CREATION.md、SCENE_CONTEXT.json 中的 targetDevice 和已有 output/device.json、device.svg。修改现有底稿，保留无关设计。默认静止；用户要求动态时才使用 v2 的 idle/working 动画，所有版本都保留完整静态 SVG。不要改设备名称、账号、会话、运行时或办公室布局。
5. 运行技能自带校验，再预览：

```sh
node /absolute/office-space-designer/scripts/validate-device.mjs /absolute/device-edit/output/device.json
scene-preview --request UUID --workspace /absolute/device-edit
```

查看 preview.svg，校验构图；动态作品按动画契约检查普通/工作状态。修改文件后重新 preview。只要用户明确要求改目标设备，继续应用，无需再让用户去设计窗口点按钮：

```sh
scene-apply --request UUID --workspace /absolute/device-edit
scene-context --output /absolute/updated-devices.json
```

核对 `status: applied` 的 `deviceId`、`appearanceAssetId` 与新 context 对应设备一致后报告完成。其他设备和项目不变，成员端实时刷新。新旧客户端共享静态底稿；支持动态的新客户端在工作/空闲状态切换，纯净模式不渲染设备外观。

只要求设计预览/存作品时，在 preview 加 `--destination backpack`，随后 `scene-save`；不应用设备。超时保持 UUID，用 `scene-status --request UUID` 查结果，勿重复创建。同一操作不能改目标；遇到 409 外观已被他人更新，重新读取并以新 UUID 合并，不能覆盖新外观。
