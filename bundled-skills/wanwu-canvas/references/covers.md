# 封面设计与更新

封面应先让成员认出画布内容，再体现风格。避免通用图标、大量小字、无关的装饰图和虚构业务数据。推荐 1280 × 800，重要内容靠内留出安全边距；同时检查缩到 320 × 200 后的可读性。按页面选择合适方案，不必每次生成图片：

- **内容截图 `screenshot`（默认）**：看板、表格、工具、协作网页优先。确保关键区域在首屏，数据已读取，图片与字体已就绪；不要截加载页、错误页、弹窗或登录页。
- **专门构建 `page`**：页面内容细碎时，编写专用 `cover.html`，用清晰标题、关键内容与真实页面预览组成封面。可读取同一画布的共享数据，不伪造统计值。字体、配色与产品保持一致；不能只放一个通用图标。
- **图片 `image`**：创意、游戏、视觉作品适合。按用户要求生成/选取图片，实际生成后再提交文件。正文信息由页面提供；不要为了视觉效果捏造实时数据。

发布 manifest 可选：
```json
{"cover":{"mode":"screenshot"}}
{"cover":{"mode":"page","entry":"cover.html"}}
{"cover":{"mode":"image","file":"/absolute/cover.png"}}
{"cover":{"mode":"preserve"}}
```
`page` 必须把 `cover.html` 及其依赖加入同一份 `files` 清单；桌面客户端需支持 `canvasCoverPage`。`image` 接受 PNG/JPEG/WebP，最多 8 MB。`preserve` 仅在旧封面仍适用时使用；新建画布不能因此留下占位图。图片覆盖与正文发布一并提交。截图更新失败时保留已有封面，不报告成功。

仅更新封面，不改正文：
```sh
node scripts/canvas.mjs cover --canvas ID --file /absolute/cover.png --request UUID
node scripts/canvas.mjs capture --canvas ID --request UUID
node scripts/canvas.mjs capture --canvas ID --entry cover.html --request UUID
```
超时重试使用同一个 UUID，随后 `get` 确认 `coverId` 和文件。网页更新后重新生成封面，必须针对最新的 contentRevision；旧页面截图不能覆盖新页面的封面。

## 网页 JS API

自有画布可更新**自己的**封面，无需账号令牌或其他画布 ID。保存到项目后，首页和团队画布栏同步更新：
```js
const ctx = await Wanwu.ready;
// 由网页绘制清晰的预览。也可传 image/png、image/jpeg、image/webp 的 Blob。
const image = document.querySelector('canvas.preview');
const requestId = Wanwu.uuid(); // 若超时，保留此 ID 与原始图片，再重试
if (!ctx.preview?.readOnly) {
  const file = await Wanwu.cover.set(image, {requestId});
  // 只有成功返回 file.id 后才显示“封面已更新”。
}
```
图片最多 2 MB，建议使用 1280 × 800 的 WebP/JPEG。API 不能截取任意跨域网页、系统屏幕或父窗口。HTML canvas 中有未授权跨域图片时，浏览器会拒绝导出；把所需图片放入当前画布资源包。

只在用户触发或有意义的数据更新后调用，做节流去重，不在渲染循环/每条广播上反复上传。更新不修改页面与业务数据。错误、离线或权限撤回时保留旧封面；409 表示网页版本变化，应重新打开后生成。

## 截图完成信号

截图器只读，不允许写入状态、触发任务或更新封面。`ctx.preview?.readOnly` 为 true 时禁用写操作。页面加载实际数据、图片和字体之后可通知：
```js
await Wanwu.ready;
await loadMyData();
await document.fonts.ready;
await Promise.all([...document.images].map(img => img.decode().catch(() => {})));
requestAnimationFrame(() => requestAnimationFrame(() => Wanwu.cover.ready()));
```
旧页面没有这个信号时，截图器等待页面完成加载且读请求安静后再拍摄。截图失败应如实报告；不要用占位图冒充内容截图。
