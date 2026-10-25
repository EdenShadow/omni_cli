# 技术选择与已核实来源

调研日期：2026-10-07。以下是文档能力，不是本项目对第三方工具的实测结论；有版本变化时重查官方文档。

- [molauu/svg-character-animator](https://github.com/molauu/svg-character-animator)：已有多状态 SVG 后，生成 React 状态机，支持待机、状态间过渡及网页输出。适合表情/姿势切换，但美术母版仍要设计，项目动作和资源加载仍需补齐。代码 MIT，示例美术 CC BY-NC 4.0，商业角色使用原创美术。按任务阅读其实现规范，不把第三方泛化结论当作所有引擎的事实。
- [GreenSock 官方 gsap-skills](https://github.com/greensock/gsap-skills)：适合关节、缓动、timeline 编排及框架清理，不是角色美术生成器。环境已有 gsap-core、gsap-timeline、gsap-react、gsap-performance 时按实现选用。
- [uianimation/rive-skill](https://github.com/uianimation/rive-skill)：社区 Rive 创作与接入指导。Rive 的状态机、绑定和骨骼适合长期角色系统。官方亦有 [CLI 与 AI agents 文档](https://github.com/rive-app/rive-docs/blob/main/cli/agents.mdx)。先核实 CLI/编辑环境和资源权限，不假装一个 JSON 就是可运行 .riv。

## 默认选择

少量矢量项目角色优先 SVG 分层 + 浏览器 WAAPI/CSS，本模板无额外依赖。复杂编排可用 GSAP。已有 Rive 制作链时用 Rive。大量 Canvas 角色或现有 Pixi 场景沿用已有渲染器；Canvas 本身不会使角色更美。

图像生成适合设计探索和复杂材质，生成后要有一致的分层或序列帧，单张贴图不能支持真实转身和四肢动作。Lottie 适合已制作好的时间轴资产，状态编排需宿主提供。

不为“找 skill”批量安装不相关包。核对来源、输入输出、依赖和作品许可；明确安装任务后再安装第三方。本 skill 自带原创样例与基础运行时，不需要下载第三方示例。
