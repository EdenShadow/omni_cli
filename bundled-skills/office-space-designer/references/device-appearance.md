# 设备造型与可选动态状态

DEVICE APPEARANCE 模式复用场景设计技能。先读 CREATION.md、SCENE_CONTEXT.json 和已有 output/device.json / device.svg。参考图用于造型和配色，不嵌入文件；不生成整个场景、独立道具或真实设备。

## 自由造型，默认静止

**不要求有桌子。** 用户可以设计桌上电脑、弹跳皮球上的电脑、浮空 UFO 终端、筋斗云电脑、机械臂，或其他有创意的设备造型。用户要求传统桌面时才保留桌子、键盘、主机等部件；不要擅自把浮空造型改回办公桌。可按要求添加小公仔等装饰，但不能画宿主的成员角色、名字、会话气泡或在线徽章。

以上造型和动作仅是灵感示例，不是白名单、固定模板或分类限制。以用户描述为准，可以自由组合和创作其他形态、部件与运动；只遵守画布尺寸、安全和性能边界。

无动态要求时输出静态 v1：

```json
{"schemaVersion":1,"kind":"device","name":"筋斗云终端","art":"device.svg"}
```

`output/device.svg` 使用透明背景、`viewBox="0 0 408 328"`。宿主以 204 × 164 世界单位显示，保留设备占地、点击入口和布局锚点。全部图形及动画极限位置均须在画布内。落地桌子可以靠近 y=320；浮空、云朵或机械臂无须画桌腿。正面像素立体造型，突出轮廓、厚度、高光和阴影。RTX / 4090 等短标签只是外观，不代表修改或检测了真实硬件。

## 仅按需求生成动画

用户要求屏幕命令行滚动、公仔跳跃、弹跳电脑或办公状态变化时，使用 **schemaVersion:2**，SVG 仍是静态安全形状，动画写在 JSON 中。读取 [局部关键帧格式](prop-animation.md)，但设备的 `animations` 是按状态分组的对象，不是道具的平铺数组。

```json
{
  "schemaVersion":2,"kind":"device","name":"云上终端","art":"device.svg",
  "animations":{
    "idle":[{"part":"cloud","duration":4200,"easing":"ease-in-out","frames":[{"y":0},{"y":-8},{"y":0}]}],
    "working":[
      {"part":"cloud","duration":2400,"easing":"ease-in-out","frames":[{"y":0},{"y":-12},{"y":0}]},
      {"part":"terminal","duration":2800,"easing":"linear","frames":[{"y":0},{"y":-32}]}
    ]
  }
}
```

- `idle`：普通状态。省略或 `[]` 即静止。
- `working`：目标设备有真实办公任务时播放，任务全部结束恢复普通状态。省略时沿用 idle；显式 `[]` 表示办公时静止。只希望办公时动，就只写 working。
- 两种状态独立完整描述。需要共享的动效在两组内分别填写；不是把 working 叠加到 idle 上。
- 每种状态最多 16 轨，每轨对应唯一 `<g data-part="terminal">` 等组。每轨 2–16 帧，周期 600–60000ms；关键帧仅接受 x / y / rotate / scale / opacity 的有限数值。缓动和范围与局部关键帧格式相同。
- 静态定位和裁剪放在动画组的外层；屏幕文字放在固定屏幕 clipPath 内，滚动内容可重复绘制一段，让循环首尾无缝。玩偶跳跃、球体弹跳或云朵浮动应留足边距。
- 不要把单纯“浮空造型”理解为必须动画；只有明确要求运动才加动画。编辑时保留未要求修改的造型与原有动画；用户要求改为静止则移除动画。
- 旧版 v1 作品始终静止。创作列表缩略图默认静止；选中作品可切换“普通 / 办公”预览。办公室仅在可见时播放；纯净模式不挂载设备美术，后台、屏外与系统减少动态效果时停止动效。不依赖逐帧网络同步。
- 新作品的基础 SVG 必须是一张完整可见的静态造型，不能靠动画启动后才出现主体。旧客户端继续请求不带 state 的图片地址时，新服务端返回此静态造型；不要求旧客户端解析 v2 动画，不更换设备身份或布局。新客户端仍能正常显示旧作品。

## 安全边界与交付

允许 svg / g / path / rect / circle / ellipse / line / polyline / polygon / defs / clipPath / title / desc / text / tspan，直接设置 fill、stroke 等属性。禁止 style、gradient、image、use、链接、href/src、脚本、事件处理、SVG animate / set 与外部资源。宿主根据校验后的 JSON 编译动画，不允许生成任意代码。设备外观不含 seats、physics、trigger；弹跳是视觉动画，不改变导航、碰撞、账号、设备身份、会话或真实硬件配置。

```sh
node <skill>/scripts/validate-device.mjs output/device.json
```

校验失败按错误修复并重验。设计窗口生成只保存作品，用户在预览中点击“应用到这台设备”后应用。普通会话若存在 SCENE_REQUEST.json，则按 wanwu-skills-sync 的设备外观流程调用 scene-preview 校验；用户已明确要求修改目标设备时可 scene-apply，若只要求预览/保存则 scene-save，不重复要求点击界面。其他项目不变；恢复默认不删除历史作品。
