# 自然语言创建局域网设备面板

用户说“做一个能改办公室软路由 DNS 的画布，遇到问题让运维 AI 排查”时，直接负责接入、页面和验证。先用 work-roster 找到指定设备、可用 Runtime、工作目录和会话。缺少路由器型号、管理接口或目标设备时，用一句普通话问清。先只读识别型号、确认可使用的本地登录方式和设备支持的 API，避免猜测接口。使用自有画布，按发布流程生成页面并保留返回的 canvas.id。

可直接从本技能 assets/device-services/index.html 开始制作控制台，按用户场景把通用字段名、动作标题、回读 JSON 改成自然的中文和对应控件，保留任务恢复和验证流程。

检查 (await Wanwu.ready).capabilities 包含 device.services.v1。页面只调用绑定在这张画布上的服务。由设备主人的万物会话使用万物同步助手 service-install 完成适配器注册；同一设备同一项目、创建者本人、完全访问模式支持。用户只需检查确认卡和登录目标设备，不要求用户翻译 API 或手写脚本。若当前会话不在目标设备，请让用户切换到目标设备主人的会话或使用已授权派工。设备关闭时显示离线，服务未绑定时明确提示“请在目标设备会话里说：把这台设备的路由器连接到这张画布”。

```js
const {items} = await Wanwu.services.list();
const router = items.find(s => s.name === 'router');
if (!router?.online) throw Error(router ? '办公室电脑离线' : '请先连接办公室路由器');
const requestId = Wanwu.uuid(); // 发出前将 ID 记录到自己的任务记录
const job = await Wanwu.services.invoke('router', 'dns.read', {}, {requestId});
const stop = Wanwu.services.watch(job.id, result => {
  showStatus(result.status);
  if (result.status === 'succeeded') renderDns(result.state);
  if (result.error) showError(result.error);
});
```

showStatus、renderDns、showError 由页面实现。写入按钮先展示新旧值，再调用设备已登记的写动作。服务返回的 state、error 当作数据处理。写动作执行后由设备适配器再读目标，只有 verified 为 true 才会成功。needs_review 表示修改结果待确认，此时用读动作查询，勿自动重发写请求。重复网络提交复用 requestId。status 和 cancel 按任务 ID 调用；取消排队动作，已开始的动作等待真实回执。退出页面注销 watch，恢复时按已有 ID 查询；不要在渲染、加载或订阅回调里自动发起配置写入。服务列表中的 lastVerified 是最近一次成功写入的脱敏回读快照，时间是 at。页面关闭时已领取的任务可继续执行。更新画布代码后要重新绑定设备服务；导入其他团队也要重新选设备、授权。

AI 排查可用已有绑定会话，或在其工作目录和同一 Runtime 建立专用会话：

```js
const base = await Wanwu.sessions.pick(); // 配置时选择并绑定真实会话，可保存 id
if (!base) return;
const ops = await Wanwu.sessions.ensure(base.id,'路由器运维');
const task = await Wanwu.sessions.run(ops.id,'检查当前 DNS，使用授权的读动作回读。',{requestId:Wanwu.uuid()});
Wanwu.sessions.watch(task.id, updateTaskPanel);
```

ensure 会按当前成员、画布、模板和用途名复用专用会话。需要单独工单才传 {fresh:true,requestId}，同一工单重试复用 ID。已有合适的运维会话可直接 run(base.id,...)。AI 的文字结论和设备验证分别显示；AI 完成后重读 services.list 或调用读动作刷新数据。关页也需按时启动的任务，在被控设备的会话里配置万物定时任务。
