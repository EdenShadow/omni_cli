# 万物浮窗位置

自有画布可以决定万物 Logo 浮窗在本页的初始位置。仅影响当前用户打开的这个画布，不改变其他画布、团队数据或访问权限；第三方网页不能控制它。没有设置时仍在右下角。用户始终可以拖动，窗口缩放会保持拖动的位置并限制在画布边界内；下次显式设置（例如切换游戏页面）会采用新的位置。关闭画布或刷新内容后重新使用页面配置。

## 按屏幕宽度设置

```js
const context = await Wanwu.ready;
if (context.launcherPosition && Wanwu.ui?.setLauncherPosition) {
  await Wanwu.ui.setLauncherPosition({
    desktop: { right: 18, bottom: 18 },
    mobile: { left: 16, top: 80 },
    breakpoint: 760
  });
}
```

- 坐标相对于**画布内容可视区域**，不含万物顶部标签栏或底部导航。浮窗尺寸目前为 48 × 48 CSS px，宿主保留安全边距，越界位置会自动限制。
- 使用 `left` 或 `right`、`top` 或 `bottom`。数字单位是 CSS px，也支持 `"25%"` 这样的画布宽/高百分比。不能同时指定 left/right 或 top/bottom。未指定的轴默认 right/bottom 18。
- 宽度不大于 `breakpoint` 时用 mobile，否则用 desktop；默认 760，支持 320–1200。缺失的分支保持右下角。平板/折叠屏按实际宽度判定，不按设备型号。
- 同一个位置适用所有尺寸时：`await Wanwu.ui.setLauncherPosition({left:16, top:80})`。
- 返回 `{ok:true}` 表示宿主已接受布局设置。参数错误会拒绝；旧客户端没有此能力时跳过即可，不影响游戏/应用功能。

## 内部页面切换与实时计算

```js
async function arrangeTools(page) {
  const context = await Wanwu.ready;
  if (!context.launcherPosition || !Wanwu.ui?.setLauncherPosition) return;
  if (page !== 'game') {
    await Wanwu.ui.resetLauncherPosition(); // 恢复右下角
    return;
  }
  const controls = document.querySelector('.game-controls')?.getBoundingClientRect();
  // 将浮窗放在右下按钮区的上方；由宿主负责越界限制。
  await Wanwu.ui.setLauncherPosition({
    right: 16,
    bottom: controls ? Math.max(18, innerHeight - controls.top + 16) : 18
  });
}
```

在页面完成布局后调用；SPA 切换页面时重新调用。实时计算可接自己的 ResizeObserver/窗口 resize，并在位置确有变化时才更新，勿在游戏每帧循环调用、反复覆盖用户拖动。只需响应宽度变化时优先用 desktop/mobile 配置，让宿主自动适配。下载进度、执行圆点、点击打开列表及发送飞入动画仍使用同一个浮窗，位置变化不需要自行实现这些交互。
