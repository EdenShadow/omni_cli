# 格子模块与区域

场景创作使用 `schemaVersion: 2`、`renderMode: "pixel-grid"`。只写模块 JSON，宿主绘制 SVG；禁止整张生图、嵌入 raster、外链图片、生成图片后猜区域坐标。

从 `assets/pixel-project.json` 开始。columns 为 32–128、rows 为 24–128 的整数，每格基础 40 像素。modules 的 x/y/width/height 均为整数格子，模块必须在地图边界内。每个模块有稳定 id 和 kind，可选 color（六位 hex）。当前 kind：rug、sofa、table、plant、bookshelf、arcade、window、wall、lamp。palette 包含 wall、floor、tile、accent、wood、leaf。

其他区域用 0–100 百分比：walkable（x/y/width/height）、boards（announcement/canvas/skills）、deviceZones（电脑落点）、seats（可达座位脚底点）、props（已有 DIY 行为数据）。宿主自动从实体模块的下半部生成碰撞，从底边 Y 排深度；地毯在地面层。别再把模块重复写进 obstacles；obstacles 只用于额外阻挡区域。

看板必须是正面矩形，无 rotation、skew 或任何透视。宽至少 18%、高至少 16%，顶边与底边都在上方 32% 区域内，互不重叠。模块不能遮住看板。装饰和家具放在板下方，设备区保留连续行走通道，人物到电脑时会站在其 y+9% 附近，不要把这里放在障碍里。

默认三个看板顶边 y=5.5%、高度 24.5%、底边 30%，向上扩展而不挤占地面。Skills 使用三列两行的可滚动图标网格，更多内容在板内滚动，标题和添加按钮保持可见。优先保留此高度，避免退回到只有一行图标的扁看板。

参考主题：
- 森林图书馆：鼠尾草绿地砖、胡桃木书架、植物与柔紫沙发，右侧设备区。
- 太空实验室：灰蓝格子、紫蓝家具、浅青点缀，仪器可以先用 arcade 模块再按宿主能力扩展。
- 海边小屋：浅沙地砖、天蓝墙面、白木家具与绿色植物。

主题必须改变实际 palette/modules，不能只改 name。背景不要烘焙成员、电脑、公告正文、任务或 UI。SVG 预览中的 NOTICE/WHITEBOARD/SKILLS 仅为示意，真实项目文字由前台组件渲染。

## 立体感

正对屏幕不等于扁平：场景保持正交格子，用顶部、侧面、前沿和接触阴影表现体积。桌腿、层板、沙发扶手和显示器边框均应可辨认。使用同色系平涂明暗与边缘高光，不靠大面积渐变或旋转面板制造深度。模块外形保持在自身格子边界内，脚底深度与碰撞位置一致。

有 floorPlan 的场景遵循 [户型与容量](floor-plans.md)：顶部墙改为固定 9 行、看板高至少6格；门洞断开碰撞墙，实际桌宽约6.8格，桌前3.2格可达。其他百分比契约仅适用于无户型的普通场景。
