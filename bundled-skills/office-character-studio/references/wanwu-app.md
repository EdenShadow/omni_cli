# 万物 AI 项目创作契约

当目录有 CREATION.md，先遵循其中的输出位置。只修改独立创作目录 output，不改全局配置、账号、设备、会话数据库，不另起页面。产品空间称“项目”、人称“成员”；技术兼容字段 office.json、officeAsset 和技能 ID 不改名。

角色输出 character.json + character.svg，七状态和独立动作池与原契约一致。保留母版身份和服饰，不能烘焙背景、电脑或其他成员。

项目输出 office.json，schemaVersion 2、renderMode pixel-grid，background 字段为 background.svg。宿主按格子模块编译 SVG；不用 image2.5 等生图路线。columns/rows 与 modules 定义格子，palette 定义配色；walkable/boards/seats/deviceZones/props 使用百分比，详见项目场景技能中的 pixel-project.json 和格子规范。公告、白板、Skills 必须正对屏幕，不倾斜、不透视、不烘焙真实文字。角色和电脑仍为宿主动态层。

旧场景编辑需按新的格子契约转换，保留旧母版文件、模块身份和用户数据。电脑由绑定设备动态生成，人数不限；工作分身由真实会话驱动。白板仍是占位；Skills 已接入真实版本库和图标桌面，其内容由宿主提供，不在角色或场景美术里假造。

角色创作先读宿主生成的 SCENE_CONTEXT.json，按项目颜色和实际画框校准角色。worldCharacterBox 是宿主容器，不要求身体塞满；新建应用 [默认场景体量](body-proportions.md#默认场景体量)。角色目录里的已有 character.json / character.svg 是编辑母版；新增默认形象也必须可再次换装、改表情和改动作。

外部参考图片只用于理解提示词主题与配色。SVG 禁止 use/image/a、href/src、事件处理器、脚本或外部资源。角色仍须完整动作校验；项目场景使用格子校验与宿主渲染。失败保留中间产物，不宣称发布成功。

项目保持正面格子视角，但用家具顶面、侧面、厚度、边缘高光与接触阴影体现立体感；看板内容平面不得倾斜。

工作烟雾、飞行工具和螺丝钉由宿主按 working 状态统一绘制，随机样式在本轮工作保持稳定；无需在角色资产内重复制作，所有角色自动兼容。
