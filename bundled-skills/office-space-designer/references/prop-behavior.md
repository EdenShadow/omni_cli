# 自主道具：移动、返航与路过互动

用户要求无人机巡游、机械狗寻路返航、充电循环或沿路留下可碰触物品时读取本页。静态仍是默认；不要给未要求的家具添加活动。以下例子是组合方式，不是道具种类限制。

## 世界运动与局部动画

`behavior` 是 prop.json 的可选字段，放进办公室时会保留到 custom 模块。宿主规划路线、播放移动、处理碰触与共享结算，不执行生成的 JavaScript。无人机旋翼、机械狗腿部等局部运动仍用 `animations`，见 prop-animation.md；局部转动不能代替在办公室巡游。

SVG 始终保留完整静态造型，旧客户端和背包预览能正常显示。需要充电站留在原处时，把移动主体放在唯一的 `<g data-part="robot">` 中，充电站放在组外，movement.part 指向 robot。主体内部可再分动画部位。省略 part 表示整件道具移动。透明画布不要远大于主体：导航使用完整道具宽高作为占地，过大的空边会让它过不了通道。

## 可组合配置示例

下面是一件地面巡游道具，可根据创意替换造型、物品、颜色、文字与反应。与标准 name/art/width/height/seats 等字段一起写入 prop.json：

```json
{
  "behavior": {
    "movement": {
      "mode": "ground",
      "pattern": "wander",
      "radius": 8,
      "speed": 1,
      "travelSeconds": 45,
      "chargeSeconds": 12,
      "part": "robot",
      "facing": "right"
    },
    "trail": {
      "svg": "<svg viewBox=\"0 0 32 32\"><circle cx=\"16\" cy=\"16\" r=\"12\" fill=\"#efba55\"/></svg>",
      "size": 0.5,
      "everySeconds": 6,
      "lifetimeSeconds": 40,
      "maxItems": 5,
      "onTouch": {
        "radius": 0.8,
        "effect": "confetti",
        "colors": ["#efba55", "#72bca6"],
        "score": 1,
        "text": "+1",
        "emotion": "done",
        "duration": 1800
      }
    }
  }
}
```

只需要移动时省略 trail；只需要表情或特效时省略 score/text。例子中的小圆点应替换为符合主题且清晰可辨的物品 SVG，例如包裹、花瓣、能量球或炸药桶。不是只有金币可拾取，也不是每种物品都要加分。

## 配置字段

- movement.mode：`air` 飞越家具与隔断，仍受可行走区域的外边界限制；`ground` 使用家具、电脑和房间墙体寻路。此版本避让固定场景障碍，不模拟多个移动道具之间的刚体碰撞。
- pattern：`wander` 先探索实际可达区域，再持续巡游到需要预留返程时；角落里也先找近处出口；`route` 按给定 `waypoints:[{"x":4,"y":0},{"x":4,"y":3}]` 路线巡游。坐标是相对于停靠点的格数，最多 12 个，须落在半径内。route 也会先绕障，最后返回停靠点。
- radius：1–24 格；speed：0.2–4 格/秒；travelSeconds：5–300 秒的续航预算；chargeSeconds：2–300 秒的充电/停靠时间。宿主预留完整返程和余量，不会强行耗尽电量走到回不来的地方。固定路线较短时提前返航；wander 不因少量随机目标失败就结束整次巡游。充好后立即开始下一轮，没有额外空等周期。
- part：可选，SVG 中唯一的 g[data-part]。摆放坐标就是停靠点，之后在布局里移动道具会一起改变活动中心。布局时暂停并显示完整静态造型，保存后恢复；可在布局检查器修改半径、速度和续航。
- facing：`right` / `left` 表示素材原本朝向，宿主按运动方向翻转移动主体；地面默认 right。正面或对称造型用 `fixed`；空中默认 fixed。基座、文字牌、位置和路线不能一起翻转。确认往左时向左、往右时向右，不能倒退滑行。
- trail.svg：最多 16 KB 的独立安全 SVG，约束与 prop.svg 相同；不能有脚本、外链或自写样式。
- size：0.25–2 格；everySeconds：2–60 秒；lifetimeSeconds：3–120 秒；maxItems：1–12。物品只在出行阶段留下，过期自动清除；落点在障碍内时跳过。
- onTouch.radius：0.25–2 格；effect：`confetti` 彩纸、`glow` 光圈、`explosion` 爆炸；colors：1–4 个六位十六进制颜色；duration：600–5000 毫秒。
- text：可选，最多 24 字；score：可选，0–100 整数，为这件道具给成员累计的互动分数，没有经济价值；未指定 text 时浮出 +score。
- emotion：可选，`done` 庆祝、`tired` 疲惫、`working` 工作、`idle` 待机、`pranked` 被整了、`dancing` 跳舞。只临时改变外观，不取消任务或改写人物位置；结束自动恢复原状态。

## 放置与共享语义

每个项目最多 16 件自主道具。空中和地面道具均要把停靠点放在地面边界内；地面道具完整占地须避开实体家具/墙，路径太窄或起点被挡时安全停靠，不会瞬移穿墙。通常紧凑主体更适合办公室通道；按实际房间比例设计，不强制所有道具同样大小。没有固定基座的空中道具可设 walkThrough:true，避免原停靠位置成为人物障碍。

所有观看者用同一场景和共享时间计算路线。掉落物由服务端验证距离与墙体遮挡，一件只让一个成员触发一次，触发后所有人移除；刷新/重连不重复加分。最多同时播放 6 个共享效果，其余物品保持可触发。行为改变或布局改变会重新规划路线和物品；这不是可执行任意脚本的游戏引擎。

自主道具不同时绑定 seats、physics、静态 trigger 或 canvasId，避免基座点击与移动主体产生歧义。编辑时保留已有 behavior 和 SVG part 锚点，用户只换外观时不要改变行为。

运行 `node <skill>/scripts/validate-prop.mjs output/prop.json`。验收应分别检查：静态完整造型、移动主体与基座分离、实际移动/返航、地面绕障、碰触效果与物品消失。SVG 预览只能证明造型，不能据此宣称办公室互动已验证。

## 倒计时与「被整了」

`trail` 至少配置 `onTouch` / `onTimer` 之一，也可以两者都配置：谁先触发就消耗共享物品，不能重复触发。接触只影响接触者。倒计时由服务器运行，影响范围内的在线成员；墙和家具会阻挡范围效果。不能让客户端自己指定目标、分数或爆炸时间。

`onTimer` 使用 `delaySeconds`（1–60 秒，必须小于 lifetimeSeconds）、`radius`（0.25–5 格）、`effect`（explosion/confetti/glow）、`colors`、`duration`（600–5000 毫秒），可选 `text` 和 `emotion`。定时效果不支持 score；积分仅由单次接触拾取产生。客户端显示秒数，后台暂停/离线期间的旧爆炸不会补放。

例如机械狗巡逻后留下炸药桶：保留 movement，trail 自绘炸药桶 SVG，配置：
```json
{"onTimer":{"delaySeconds":5,"radius":2.5,"effect":"explosion","colors":["#ffc65a","#ff8363"],"duration":4500,"text":"被整了！","emotion":"pranked"}}
```
这是 trail 中的触发片段，还须提供 svg、size、everySeconds、lifetimeSeconds、maxItems。若希望踩到就提前爆炸，再加同形的 onTouch（不含 delaySeconds，radius 最大 2）。每个项目最多同时显示 6 个效果，避免刷屏。

`emotion` 支持 `pranked`（被整了 / Pranked）、done、tired、working、idle、dancing。Pranked 的默认表现是焦黑、呆住、含泪；新角色可以创作哭泣、石化、眼镜滑落等版本。效果结束自动恢复原状态，不改变任务执行状态。使用宿主声明式能力组合不同道具、奖励或惊喜；不要把例子硬编码为唯一机械狗/炸弹产品。

倒计时也须短于 `everySeconds * maxItems`，避免物品在倒计时结束前因容量上限被替换。

跳舞使用 `emotion:"dancing"`，全体基础角色与旧自定义角色均支持，临时互动结束后恢复原状态。无音乐播放，不改变人物世界坐标。


## 先验证能运行，再交付

创作宿主提供的 `SCENE_CONTEXT.json.navigation` 含当前地面、房间门洞、家具占地和所有设备分身的位置，不含成员身份或聊天。已有场景也可使用 scene-context 的 JSON 快照。先确定预计停靠点，再用同一套宿主规划器检查：

```sh
node <skill>/scripts/check-prop-behavior.mjs SCENE_CONTEXT.json --prop output/prop.json --x 12 --y 16
node <skill>/scripts/check-prop-behavior.mjs scene-context.json --module existing-module-id
```

新道具使用预计停靠点，不擅自替用户摆放；旧道具编辑加 `--module existing-module-id` 替换对应占地。坐标是格数而不是百分比。没有实际几何时明确说明尚未验证摆放，不用虚构的空房间宣称通过。

- `home-blocked`：完整占地超出地面或与实体重叠；缩紧透明留白、调整主体占地或选择有出口的停靠位。不要关掉地面碰撞掩盖问题。飞行可以越过家具，不能飞出地面边界。
- `no-route`：找不到可走出的路线。角落先验证最近出口，不要只在大半径边缘找目标。布局检查器也会显示这类状态。
- `no-drop`：出行结束前没有一次可投放机会。根据可达路线调整 everySeconds、路线或续航。只设置 trail 不等于真的会投放；检查 firstDropSeconds / dropsPerCycle。route 只有短路径时不会凭空加长成 wander。
- 检查完整循环：出发、巡游、转向、投放、倒计时或接触、返航、充电、再次出发。网络快照或新消息不能重新启动同一条运动轨迹。

**文字与角色反应是两个独立能力。** `text:"被整了"` 仅是浮字；用户要求人物被炸懵、焦黑、石化或哭泣，必须在对应触发器写 `emotion:"pranked"`。若踩到和倒计时都能爆炸，两者都应配置所需表情。不能把浮字截图当作人物表情验收。基础角色和旧自定义角色使用宿主回退，新自定义角色优先播放自带 Pranked 动画。被命中后临时切换，结束恢复原来的工作/行走/待机状态，不取消任务。范围外或墙后角色不受影响，没命中人时只出现爆炸是正常结果。

以上检查器证明几何和时间配置，不证明实际播放器。交付应用机制时还需在隔离房间验证：炸弹倒计时命中人物，默认及自定义角色真实播放反应（不是仅 state 字段或浮字）、其他观看者同步、表情恢复。多个特效重叠时，纯文字效果不能覆盖角色表情；短表情过期后可恢复仍有效的上一种反应。
