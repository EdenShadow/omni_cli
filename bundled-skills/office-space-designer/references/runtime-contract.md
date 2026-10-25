# 模块化项目运行契约

## 文件

模板 `assets/starter/public/office-space/` 与相邻 `office-characters/` 可静态托管或以 iframe 接入功能 Tab。`office.json` 定义主题、设备、成员、props 和默认看板；`scene.svg` 是家具母版；`layout.js` 是布局、导航、聚集点与分身身份纯函数；`world.js` 渲染空间、动态设备/看板；`props.js` 注册道具与绘制；`office.js` 调度实例、机关、面板与存档。

`scene.svg` 的 desk/chair/plant defs 以及 lounge/play 分组被 renderer 使用。休闲家具按子节点提取，换美术必须同步 renderer，不盲目替换 SVG。

## 数据

`schemaVersion:1, presentationVersion:2, id, name, brief, scene, palette`。
`devices:[{id,name}]`：旧 capacity 可保留为兼容字段，但不能参与限员。
`members:[{id,name,job,src,width,ratio,anchor,seed,home,state,rootId?,baseName?,cloneNumber?,cloneColor?}]`。

当前角色宽约：芽团 130、香蕉 100、橘子 126 世界单位；ratio/anchor 沿用各自角色。世界 left/top 是脚底，画框向上偏移 anchor。sitting 使用角色 hipAnchor 对齐座面。UI 初次按视口宽度缩放而非强行展示整张高地图，保留双轴滚动。

看板：`announcements:[{id,title,body,tag,date}]`、`notes:[{id,text,x,y,color}]`（便签 x/y 百分比）、`skills:[{id,name,command,description,prompt}]`。所有编辑即时刷新地图预览。

存档键保持 `office-space:<id>:v1`。包括 settings、devices、members、assignments、seats、props 与 presentationVersion。首次读旧版宽度乘 1.85，之后不再缩放；持久化写入版本标记。坏数据不删原件。导出完整项目 JSON 给技能继续编辑；示例不含云同步和网页 AI 服务。

`assignments[instanceId]={deviceId,slot}` 中 slot 只是聚集序号，不是容量/保留坑位。`workPoint(device,index,layout)` 在桌前连续区域选择可走点，允许相互覆盖、无限扩展序号。assignments 和 seats 互斥。

## 布局、障碍与深度

`createLayout(devices,props)` 返回 width/height、computers、boards、zones、seats、obstacles。新增设备重算房间尺寸、看板与互动区，保留稳定实体 ID。可移动 DIY 物体不能占住重新生成的核心设备。

导航是网格 A* 与精确线段/膨胀矩形相交。验证整条路径不切角，入口与落点可达。墙/树进入 obstacles；软性触发器不阻挡正常通行。地面碰撞以脚底/小胶囊表达，角色上半身与树冠可以重叠。

渲染位置与表现分层：世界节点只做 x/y 路径位移；角色内部做表情、原地动作；弹跳/飞行高度用单独视觉变换。所有家具、人物、道具参与同一 footY 排序，不给三个容器建立隔离 stacking context。排序以世界 Y 乘 1000 加小于 1000 的稳定 tie，避免人数多时 ID 序号压过实际前后位置。

每次重新指派读取当前插值位置并停止旧动画/onfinish，释放旧道具占用与座位。空中被中断先安全落地。抵达后取消 fill 并提交最终 style，再切状态。飞毯乘客与载具同路径进度和深度；原地工作随机与 done/sitting 随机继续独立运行。

注意 `office-character` 自定义组件有自己的 animate 辅助方法，不要把它当 DOM 原生 animate 调用。外部位移用宿主 wrapper，或显式 `Element.prototype.animate.call(element, frames, timing)`。

## 椅子与沙发

座位 `{id,label,kind,approach,surface,depth}`。`store.seats[instanceId]=seatId` 预订/占座，是真实一人一个座位，区别于不限人数的电脑区域。抵达可达 approach 后 hip 对齐 surface，离开恢复脚底锚点；失败保留原预订。done 持续随机庆祝，sitting 独立随机玩耍，不混入工作池。

## 自检重点

查看场景元素而非只看工具侧栏；不清空旧存档掩盖问题。验证分身身份不变、原工位仍工作、同源独立 seed、超过 8 人无满员拒绝、三板预览、路径中断、机关暂停/减少动态、粒子清理、刷新保存与新电脑重新布局。

## 整洁布局模式

示例使用工位区与合并的休闲会客区，不再在每台电脑旁创建独立椅子。layout.seats 当前只有三个沙发位置，真实座椅类型的扩展能力仍保留。坐满后其他成员去共享休闲区的可达空地，不以增加电脑来增加座椅。

store.propStorage 保存未摆出的道具。tidyOfficeStore 只在 cleanLayoutVersion 尚未到 1 时把旧游乐场 props 收纳，并释放移除的椅子分配。玩家可以从库中重新放置，成功后才从 propStorage 移除。地图高度只由设备区、会客区与实际摆出的道具计算。
