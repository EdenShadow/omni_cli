# 角色包 v1

交付 `office-character.js`、`character.json`、`character.svg`。

JSON 包含 `schemaVersion: 1`、id、name、description、art（相对 SVG 路径）、states、idleVariants、clips。可选 `idleLabels` 是 variant id 到中文显示名称的映射，供预览按钮和状态文案使用。完整示例见 [character.json](../assets/example/character.json)。所有资源同源。SVG 是可信本地产物，播放器拒绝主动内容；不要把任意远端 SVG 当可信 HTML 注入。

`clips[state]`：`duration` 毫秒，`loop` 布尔，`tracks` 数组。track 包含 `part`（对应 SVG `data-part`）、`frames`（WAAPI keyframes）、可选 `duration`、`easing`。只用 transform/opacity，动画组的 transform-origin 和 transform-box 在 SVG style 中定义。同一 clip 的同一 part 只放一条轨道。

idle 使用 idle clip 作为基础，scheduler 不连续重复地选 idleVariants，每个小动作结束回到 idle，随机等待 3.5–6.5 秒。公开状态为 idle、walk-left、walk-right、working、tired、done、sitting。新生成角色交付七状态；旧五状态包仍可加载，未提供 done 的包调用该状态会报错并保留原状态。显式切回 idle 或 playIdle 后恢复 facing=front，包括脸的位置、身体宽度及手臂透明度。事件：`characterstatechange` 的 detail 为 `{state, clip, facing}`；完成加载发 `characterready`，detail 为 `{id, idleVariants: [{id, label}], workVariants: [{id, label}], doneVariants: [{id, label}], sitVariants: [{id, label}]}`，用于按当前角色创建全部待机按钮；失败发 `charactererror`。

## 原生网页

```html
<script type="module" src="/office-characters/office-character.js"></script>
<office-character id="employee" src="/office-characters/yatuan/character.json"
  state="idle" seed="42" style="width:160px;height:160px"></office-character>
<script>
  const employee = document.querySelector('#employee');
  employee.setAttribute('state', 'working');
  // employee.setAttribute('paused', ''); employee.removeAttribute('paused');
</script>
```

公开属性：src、state、paused、seed、reduced-motion（主动启用静态模式；也自动尊重系统偏好）。公开方法：setState(name)、playIdle(name)（预览指定待机动作）、playWork(name)（预览指定工作变体）、playDone(name)（预览指定庆祝后继续随机庆祝）、playSit(name)（预览指定坐姿后继续随机坐姿）、restart()。角色只负责原地步态，场景容器控制地图移动。

支持不同 SVG viewBox 宽高比和不同 data-part 分组；160×160 是组件默认显示大小，可通过宿主 CSS width/height 改写。结构比例由角色自己的 SVG 与 clips 决定，场景内的大中小体型由宿主布局决定。没有会自动改变造型的 size/bodyType 参数。设计和排列不同体型时读 [体型与多角色设计](body-proportions.md)。

## React 18

在 effect 内动态 import 播放器并通过 document.createElement('office-character') 创建实例，append 到 ref 容器。另一个 effect 同步 state/paused；卸载时 remove 节点。也可声明 JSX IntrinsicElements 后使用标签。不要每次状态更新重建节点。多实例使用不同 seed。

## 万物 AI 应用接入

新版宿主通过 src/components/OfficeWorld.tsx 加载 office-character Web Component。播放器位于 public/office-characters/office-character.js；现有三个完整角色在对应子目录。应用会把通过校验的 manifest 和 SVG 保存到云端，客户端通过同源受认证资源加载并缓存。不要修改旧的五状态索引来替代新播放器。旧独立预览页面仍保留在 /office-characters/ 和 /office-space/；它们与云端应用有各自的存档。

## 打开随包样例

在 skill 的 assets 目录执行 `python3 -m http.server 8765 --bind 127.0.0.1`，打开 `http://127.0.0.1:8765/preview.html`。由于浏览器模块与 fetch 限制，不要双击 file:// 页面来判断加载失败。静态导出使用 character.svg。

## 随机工作动作

新角色提供 `workVariants: ["work-..."]`（新建默认至少五个不同 clip id；兼容已有三动作包）和 `workLabels`（id 到显示名称）。工作变体 `loop: true`，首尾连续，避免与七个公开状态和 idleVariants 重名。旧包可不提供该字段，继续循环基础 working。

进入 working 时随机选择变体；完整播放 2–3 个循环后选择下一个，连续不重复。整个过程中公开 state 始终是 working，道具保持显示。动画时钟随暂停、离屏和页面隐藏暂停；状态切换、换角色和卸载取消旧时钟。减少动态时直接显示基础 working 姿势。

`playWork(id)` 手动预览工作变体后继续随机工作。`characterready.detail.workVariants` 为 `[{id,label}]`，展示页据此创建工作按钮；`characterstatechange.detail.clip` 表示具体动作。SVG 的 `data-clip` 表示当前 clip，用于需要的局部样式。

## 持续庆祝状态

states 中声明 done，基础 clips.done 与 doneVariants 中每段 loop:false。每段完整播完，由独立可暂停动画时钟继续随机抽取，邻次不重复，始终保持 state=done；只有显式切换才退出，不进入工作或待机池。没有 doneVariants 时重播基础 done。每段时钟覆盖最长轨道时长和 200ms 入场过渡，暂停/离屏/后台/卸载与其它动画统一管理，旧回调用 version 隔离。

粒子每轮末帧 opacity:0，下一轮重新喷出，不累积 DOM；减少动态显示基础 done 的最后一帧并停掉调度，恢复正常动态后继续轮播。

## 坐下状态

states 中声明 sitting，提供 clips.sitting 和至少三个 sitVariants、sitLabels；各 sitting clip 为 loop:true，播放两个完整循环后随机换一种且不连续重复。基础 sitting 是减少动态的静态弯腿坐姿，不等于站立图向下平移。seating.hipAnchor 是臀部在 viewBox 高度中的比例，供宿主对齐沙发/椅子座面。具体约定见 [坐下与座位接入](sitting.md)。

## 工作表演版本

`design.workPerformance: "authored-v1"` 表示作者已按 [情绪工作](emotional-work.md) 在真实地图尺寸完成大幅姿态和节奏验证。宿主对该包直接播放原轨道；缺少此字段的旧包保持兼容，并可仅对弱情绪工作动作做可逆增强。字段不改变 schemaVersion，也不允许修改角色身份或无关动作。
