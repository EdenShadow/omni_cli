# 独立表情与动作 / CUSTOM ACTION

用户从“表情与动作”页为当前形象添加一个动作，点击人物菜单后主动播放。宿主已提供 `BASE_CHARACTER.json`、`BASE_CHARACTER.svg` 和输出母版。

## 输出

只修改 `output/action.json` 与 `output/action.svg`。保留母版角色的身份、服装、轮廓、viewBox、design、seating、states、已有 clips 和所有 idle/work/done/sit 动作池。可以添加五官替换组、眼泪或火焰等效果，静态默认隐藏，只在本动作中出现。

JSON 保留完整角色契约，并新增：

```json
{
  "kind": "action",
  "baseCharacter": "宿主已填写，不要改",
  "name": "委屈大哭",
  "art": "action.svg",
  "actionVariants": ["action-cry-a", "action-cry-b", "action-cry-c"]
}
```

按任务指定数量提供 1、2 或 3 个变体；每个 clip 的名称以 `action-` 开头，仅小写字母、数字和连字符。每个片段 `loop:false`，`duration:600–12000` 毫秒。宿主按服务器共享的开始时间持续循环播放完整片段，直到用户走路或切换状态/动作；较短轨道会保持末帧，等整个片段结束再一起重播。生成文件仍保持 `loop:false`，无需自己实现循环或网络计时。新增 clip 仅列入 actionVariants，不改已有状态和动作池。

## 真正的动画

每种变体都要有预备、表达、收尾阶段。用五官、手臂和身体共同表达含义；不只让整个人上下浮动。比如哭泣可以揉眼睛、擦眼泪、掩面抽泣；喷火可以蓄气、小喷嚏、连续两次短喷，仍属于同一个动作。不能复制三份完全相同的时间轴。

使用角色现有 WAAPI 分层契约：每个轨道引用唯一 `data-part`，一个片段内同一部位只出现一次，最多 64 条轨道。每条轨道 2–80 帧，仅支持 transform、opacity、offset、easing。透明度与 offset 为 0–1；offset 递增。duration 可省略，指定时必须 100ms 以上且不超过片段时长。easing 用 linear / ease / ease-in / ease-out / ease-in-out / steps(n)。不要给动画伪造 position、particles、audio 等宿主不读取的字段。

效果组默认 `opacity="0"`，在轨道中从 0 → 1 → 0；对隐藏的旧眼睛/嘴巴使用 `[data-clip="action-..."]` 样式定向替换，不影响其他状态。需要可见的火焰轮廓、泪滴等就画实际 SVG 路径，再单独动画。保留关节锚点。

## 大范围特效

动作不限于人物的小方框。按用户描述设计范围：火球可向前飞出数个人物宽度，喷火可向外延伸，冲击波、魔法阵或烟花可在人物周围大范围展开，不要把要求的大特效缩成脸旁的一小团。

- 人物身体、原 SVG viewBox、design 和脚底锚点仍保持原样。不要为容纳特效扩大根 viewBox 或缩小人物；办公室按原尺寸显示人物，效果可以自由溢出。
- 特效用独立的顶层 `data-part` 组，与身体并列，不放进身体的 clipPath 或固定尺寸裁切层。可以画在原 viewBox 外，也可以从手部出发用 `translate(900px, -120px)` 等轨道向外飞行（这里是 SVG 坐标单位）。局部火焰内部仍可使用自己的遮罩。
- 在 action.json 加 `actionBounds:{x,y,width,height}`，用原 SVG 坐标包住所有变体全过程的身体、飞行轨迹、拖尾和爆炸范围。x/y 可以为负。它只供预览完整取景，不限制办公室里的播放范围，也不改变碰撞、角色大小或移动位置。
- 例如原人物为 `viewBox="0 0 240 240"`，火球从手中飞出约 900 单位并爆开，可用 `actionBounds:{x:-80,y:-160,width:1360,height:560}`，并保留原 viewBox。按实际路径计算范围，不要照搬数值，不画范围边框或背景。
- 设计蓄力 → 发射/飞行 → 爆开 → 消散的真实时间轴。特效默认隐藏，末帧归零，每个周期结束后不留残影，再从头播放。三种变体可以有不同的弧线、连发次数和爆炸节奏；随机变体仍由服务器选择，所有成员看到同一条动画。

禁止脚本、事件属性、SMIL（animate/set）、CSS animation、外部资源和嵌入图片。静态 CSS 可定义 transform-origin / 默认显隐。网络、广播、持续时间和随机数由宿主统一管理；生成器不得自行实现多人移动或同步。

## 验收

检查所有变体实际有不同姿态/节奏且能播放；效果默认隐藏、结束消失；原来七种状态与普通动作池保持完整。宿主会校验文件、轨道、变体数量和与 BASE_CHARACTER 的一致性，失败时在同一工作目录修复。这里输出 action.json；旧的独立角色网页脚本只认 character.json，不能拿它的文件名要求覆盖动作输出。
