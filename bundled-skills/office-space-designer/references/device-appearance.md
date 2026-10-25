# 电脑与桌子外观

DEVICE APPEARANCE 模式复用场景设计技能的配色和像素立体语言。先读 CREATION.md、SCENE_CONTEXT.json 和已有 output/device.json / device.svg；参考图用于造型、材质和配色，不嵌入文件。不生成整个场景、独立道具或人物。

## 输出

`output/device.json`：
```json
{"schemaVersion":1,"kind":"device","name":"霓虹 4090 工作站","art":"device.svg"}
```

`output/device.svg` 为透明背景、`viewBox="0 0 408 328"` 的完整桌子与电脑组合。宿主显示为 204 × 164 世界单位，保持已有设备占地、点击入口和磁吸锚点。图形全部在画布内，桌腿落地接近 y=320；长桌横向占据大部分画布，显示器、主机、键盘放在桌面上。不要画背景色矩形、角色、浮动设备名、会话文字或在线徽章，宿主会单独提供。

按用户的描述设计可辨认的细节。例如“赛博朋克长桌上的英伟达 4090 台式机”：深色金属长桌、立体桌沿与桌腿、超宽显示器、透明侧板机箱、可见的三风扇显卡、绿色灯带、键盘与整齐走线。可用短文字 4090 / RTX 点明组件；它们是外观元素，不能声称已检测或更改真实硬件。优先在有限尺寸中突出轮廓与关键部件，避免堆满微小线条。

## 画法与限制

正面像素轮廓，顶部、侧面、厚度、高光与接触阴影清晰，和当前项目家具的尺度协调。改造时保留用户未要求变动的设计。可用 svg / g / path / rect / circle / ellipse / line / polyline / polygon / defs / clipPath / title / desc / text / tspan；直接设置 fill、stroke 等属性。不使用 style、gradient、image、use、链接、href/src、脚本、事件处理、动画或外部资源。可短文字标识型号，不能嵌入图片或字体。

设备外观不包含 seats、physics、trigger；这些属于独立道具。不得修改账号、设备绑定、会话记录或真实设备配置。

```sh
node <skill>/scripts/validate-device.mjs output/device.json
```

宿主校验失败时按具体错误修复文件，再次运行验证。完成生成仅保存新版本素材；不要宣称已经替换现场。用户在预览中点击“应用到这台设备”后才修改当前项目的设备外观并广播，其他项目保留其各自外观。旧外观素材仍可重复选择，恢复默认不会删除历史作品。
