# 画布链接分享

仅在用户要求项目外使用时启用。默认关闭，不自动公开。

先 `node scripts/canvas.mjs share --canvas ID` 读取 `{mode,revision,path,canManage}`。
创建者或项目管理员可用 `share --canvas ID --mode public|account|off --revision N` 修改设置。
返回 url 是运行时按当前服务站点构造的完整分享链接，可直接交给用户。path 是相对路径；旧客户端若只返回 path，请在画布浮层复制完整链接，不猜测域名，不把授权内容放到 URL。

- `public`：持有链接的任何人免登录查看。当前画布页面及全部运行数据可读，禁止共享状态写入和广播；页面按 `context.readOnly` 隐藏编辑控件。
- `account`：登录任意万物 AI 账号即可互动，无需加入项目。只允许当前画布的数据读写、数据订阅和广播；不要把未授权的团队私密信息放进将要共享的数据表。
- `off`：关闭外部访问。切换模式会更换链接，旧链接和内容凭据失效；外部打开页会退出。

分享不授予项目成员身份。外部用户没有设备会话、共创任务、工程附件、封面写入、团队成员和其他画布权限。第三方网页仍按自己的登录权限运行。

共享页仍使用 `Wanwu.ready` / `state` / `data.collection()` / `room`。context 中 `shared=true`，project=null、members=[]；按 capabilities 检查可用能力，不能假定总有项目或会话。分享开启期间广播走可靠服务端转发，让项目内外的页面互通；它不是每帧游戏视频传输。持久恢复靠 data/state，监听 reconnect 后重读。页面资源需随网页包提供，不能依赖私有工程附件下载接口。

默认悬浮 Logo 提供复制链接；只有项目成员有返回项目共创入口。不得用页面内容提升这些权限。

登录后互动分享也支持 `rooms.v1`：通过 `Wanwu.rooms` 与项目内玩家连接相同房间，使用相同服务端规则。只读分享不可加入或写房间；分享关闭/权限改变后连接终止。见 [服务端房间](server-rooms.md)。
