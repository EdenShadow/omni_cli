# 第三方网页脚本

先运行 `node scripts/canvas.mjs page-script --canvas ID`，核对画布、origin、revision 和现有代码，保留用户已有逻辑。仅画布创建者或项目管理员可写入。accounts 只提供本画布账号的 id、label；选择用户指定的账号，有多个且无法区分时询问。不要索取、抄录或输出密码。

把完整设置写在一个本地 JSON 文件中，再运行 `node scripts/canvas.mjs page-script --canvas ID --input /absolute/settings.json`。使用读取到的 revision 和 origin；credentialId 为所选账号 ID 或 null。只需要用户明确要求的动作。遇到版本冲突先重读再合并。写入即为这块画布启用团队脚本。保存后核对返回的 teamEnabled、revision 与 origin；当前打开的桌面画布会刷新。其他有访问权限的成员打开该画布时自动运行。同样可以在 WebApp 中管理；跨站网页内的脚本由桌面端执行。

用户要求写好并自动启用时，直接完成写入并确认 `teamEnabled: true`，不要只在聊天里贴代码或让用户再点按钮。对于已经保存的脚本，先读设置；若未为团队启用，用 `node scripts/canvas.mjs page-script --canvas ID --mode enable --revision REV` 就地启用，再核对返回状态。已经启用则直接告知，可以避免额外刷新。

示例（将示意值替换为读取到的值）：

```json
{"revision":0,"origin":"https://example.test","credentialId":"<所选账号 ID>","source":"await ww.fillLogin({username:'#account', password:'#password', submit:'button[type=submit]'});"}
```

- 输入是 JavaScript 异步函数体，可访问当前页面的 DOM 和 `ww`。只在桌面端当前顶层页面与画布同源且成功加载后运行。遇到证书警告必须等使用者在原生弹窗确认；不要模拟点击信任、关闭安全检查或自动解决验证码。
- `await ww.waitFor(selector, timeoutMs)` 等待动态元素并返回元素或 null，默认 10 秒，上限 30 秒。
- `await ww.fillLogin()` 等待常见账号与密码输入框，填入当前选中的密码箱账号并提交同源登录表单；也可按目标网页传 CSS 选择器 username、password、submit。仅限 HTTPS。没有登录表单时安静跳过，已登录页面不会重复提交。单页应用按需等待真正可操作的控件。
- 网页脚本随项目成员访问权限保存，公开分享页不执行。不硬编码账号、令牌或密码，不向其他网站转发页面数据。只有用户明确要求移除时才传空 source 和 null credentialId。
