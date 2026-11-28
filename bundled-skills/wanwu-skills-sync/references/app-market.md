# 在当前会话创作市场应用

应用包含至少一个项目技能，可选网页画布。新建技能用本技能的发布流程，标记为当前用户创作。新建网页或外链用万物画布的发布流程。所有市场操作继承本轮项目和发起人的权限。

运行 `node scripts/sync.mjs market-sources` 获取可以公开提交的资源。将用户选中的技能和画布 ID 按展示顺序写入 JSON 文件。第一个画布是主页。项目的密码、成员名单、运行数据和会话内容不属于应用包。发布前检查静态程序、展示图片和说明适合公开。

绘图前先看[本项目的 Skills 图标规则](skill-publish.md)、[十二款应用图标参考](app-icon-style.webp)和[可编辑的邮箱图标示例](app-icon-example.svg)。应用继承某个技能的品牌且用户希望沿用时，使用已获准发布的那个技能自己的原图。组合多个技能时，为应用的主要用途设计独立图形。

应用图标默认使用透明画板，沿用「万物 PPT」「AI Character Studio」利落的大色块、少量高光和短投影。让一个有辨识度的主体占画板的约八成，留出透明边距，缩到侧栏也能认出。计算器保留机身、屏幕、彩色按键和显示内容，机身外的薄荷绿方块留空。邮箱可以保留信封、信纸与发送箭头。

十二款参考图依次是邮箱、计算机、PPT、股票、计算器、换算、资料库、预算、语音备忘、汇率、计时和笔记，用来参考主体造型和配色。透明轮廓以邮箱 SVG 示例为准。交付前分别在浅色、深色底上按桌面 36px 和手机 56–60px 预览，检查主体周围及镂空处是否露出页面底色，浅色高光和深色细节是否仍能辨认。

默认以带 viewBox 的独立静态 SVG 绘制，可使用内联 path、rect、circle 等形状。也支持真实生成的 PNG、JPEG、WebP 图标（单张最大 8 MiB、1600 万像素）。用户指定 Image 2.6 或提供图像时，新生成的图优先采用带真实 alpha 通道的 PNG 或 WebP，提示词写明「单个主体、透明背景、保留物件自身配色」。白底和画进图里的棋盘格在界面中都会显示出来。用户指定沿用原图时用原文件作为 iconFile，非方图会按比例居中留白。iconFile 和展示图片 imageFiles 独立；可另附 0–6 张展示图片，每张压缩到 1 MB 以内。

新建时生成一次 UUID 作为 id，version 设为 0。更新时沿用原应用 ID 和当前版本，提交完整的新资源清单。调用方式为 `node scripts/sync.mjs market-publish --input /absolute/path/plan.json`。输入示例：

~~~json
{"id":"应用 UUID","version":0,"name":"计算器","note":"日常计算和单位换算","skillIds":["从 market-sources 取得的 ID"],"canvasIds":[],"iconFile":"/absolute/path/icon.svg","imageFiles":[]}
~~~

若用户从提交表单送来 draft，先用 `market-read-draft --input FILE` 读取仅含 draft 的 JSON。生成图标后以 {"draft":"草稿 UUID","iconFile":"/absolute/path/icon.svg"} 调用 market-publish。原表单内的资源和图片会自动使用。相同请求重试沿用原输入。只在收到应用 ID 和版本后报告已上架。

首次上架会在允许安装的来源项目自动关联原始技能和画布。卸载来源安装后仍可迭代原稿。维护已有应用时，用 market-detail 的 {"id":"应用 UUID","view":"project"} 读取最新项目版本。用户仅要求修改、试用或更新项目时，market-publish 传 release=project、该项目版本号和完整清单，可传 reuseIcon=true 沿用图标。市场用户继续使用最近上架的版本。用户明确要求上架已保存版本时，传 {"id":"应用 UUID","version":项目版本号,"publishSaved":true}，原样上架该版本。明确要求直接发布新改动时传 release=market。使用 draft 时沿用草稿中指定的范围，按回执的 release 和 version 报告结果。

用 market-list 查询，输入可含 tab（recommended、new、installed）、query 和 offset。market-detail 查看清单。market-install、market-update、market-status、market-repair、market-uninstall 均接受 {"id":"应用 UUID"}；只有明确要求卸载时才执行卸载。技能运行时为应用新建画布，在万物画布的 publish 清单中传 appId（当前安装的应用 UUID），新画布会随应用卸载。已有画布可以用 market-attach 绑定，传 {"id":"当前项目已安装的应用 UUID","canvasId":"当前项目画布 UUID"}。它会成为应用的新标签页。不要猜测目标应用，先查已安装列表。以上操作均支持 --input JSON文件。
