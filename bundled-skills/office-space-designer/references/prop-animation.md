# 局部循环动画

宿主支持真正的动态道具。水波、喷泉、蒸汽、闪烁灯光、摆动枝叶或旋转叶片应使用 `animations`，放进项目后自动循环。保留静态底座、池沿、碰撞边界与坐点，只让合适的局部运动。不要将整个泳池上下抖动来假装水在流动。

在 `prop.svg` 中用唯一 `<g data-part="waves">` 包住动态部分，内部仍为普通静态形状。固定位置/缩放放在它的外层 `<g transform="…">`，避免与动画变换叠加冲突。泳池水纹应画在一个固定的裁剪层内，动画组是其子节点，确保水面不越过池沿：

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 160">
  <defs><clipPath id="water"><rect x="24" y="24" width="192" height="108"/></clipPath></defs>
  <rect x="8" y="12" width="224" height="140" fill="#cfbd99"/>
  <rect x="24" y="24" width="192" height="108" fill="#62b9cc"/>
  <g clip-path="url(#water)">
    <g data-part="waves" fill="#c0edf0">
      <path d="M16 48h24v4h28v-4h30v4h32v-4h34v4h36v-4h32v4h-216z"/>
      <path d="M8 94h28v4h30v-4h36v4h30v-4h30v4h40v-4h38v4H8z"/>
    </g>
  </g>
</svg>
```

在 `prop.json` 的其他字段旁添加：

```json
"animations": [
  {"part":"waves","duration":4200,"easing":"ease-in-out",
   "frames":[{"x":-8,"y":0,"opacity":0.5},{"x":8,"y":2,"opacity":0.9},{"x":-8,"y":0,"opacity":0.5}]}
]
```

示例只演示结构；按用户描述设计实际造型、细节和层次。多层水纹/光斑用不同部位、周期和错峰时间形成自然流动，避免所有纹理同步晃动。环状涟漪可用 `scale` 配合 `opacity`，叶片可用 `rotate`，浮动物体可用 `y`；每一帧中省略的值为 x/y/rotate=0、scale/opacity=1，因此需要保持的值应逐帧写出。关键帧等间距，循环首尾应视觉连贯。

- 最多 16 条轨道，每个 `part` 只对应一个唯一的 SVG `g[data-part]`，每个部位一条轨道。
- 每轨 2–16 帧；`duration` 为 600–60000 毫秒，`delay` 可选，0–60000 毫秒，用于错开起始相位。
- `easing` 可为 `linear`（默认）、`ease-in-out` 或 `steps(4)`。
- 帧中仅支持 x/y（−500–500 SVG 单位）、rotate（−3600–3600 度）、scale（0.2–4）、opacity（0–1）；缩放和旋转围绕该部位的中心。
- 不输出 CSS、脚本、SVG animate 元素或任意表达式；由宿主把已校验的数值变成动画。系统开启减少动态效果时显示静态造型。
- 创作预览、背包、办公室使用同一动画。成员移动、坐下、碰撞和点击触发沿用既有宿主逻辑，局部循环动画不改变家具占地，也不需要逐帧网络同步。
- 编辑与复制时保留 `animations` 和对应部位。旧的静态素材需要补上部位与关键帧后才会动，不能仅改名称。

执行 `node <skill>/scripts/validate-prop.mjs output/prop.json`，确认目标部位、帧值和静态 SVG 都通过校验。
