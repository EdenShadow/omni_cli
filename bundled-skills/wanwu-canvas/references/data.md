# 画布数据服务

记录型页面要接入真实的云端持久化。万物已提供团队和画布隔离的 JSON 数据服务；技能生成页面、数据结构和读写逻辑即可，不必开端口或部署独立数据库。适用于 TODO、备忘录、表单、台账和轻量看板；不是任意后端代码托管或 SQL 服务。

等 `Wanwu.ready` 后使用 `Wanwu.data`（需万物 1.2.248+）：
```js
const todos = Wanwu.data.collection('todos');
const record = await todos.create({title:'准备周会',week:'2026-10-12',done:false});
// record: {id,data,revision,updated,authorId}；id 自动生成，也可第二参数 {id: UUID}
const current = await todos.get(record.id); // 不存在或删除后是 null
const week = await todos.list({where:{week:'2026-10-12'},sort:'updated',descending:true});
await todos.update(record.id,{done:true}); // 只合并传入字段，保留其他字段
await todos.remove(record.id); // 软删除，其他成员和后续列表不再看到
// 小列表可以刷新；频繁更新的应用应合并 event.record/event.deleted，见下文。
const off = todos.subscribe(event => reload());
```

- 数据写在万物服务端，刷新、关闭再打开和换设备仍保留；画布发布新 HTML 版本不会重置数据。首次打开空库应展示空态，不自动写示例数据，不重复创建记录。
- 集合名 1–32 位，以英文字母开头，后续字母/数字/`_`/`-`。记录 ID 1–60 位同样字符（可用 UUID）。每条数据为 JSON 对象。每画布最多 1000 条状态记录（含软删除），每条 256 KB；大文件用附件。大量历史应分期归档到附件或另一个画布。
- `list` 的 `where` 做顶层字段精确匹配；`sort` 可为 `updated`、`id` 或数据字段；`descending` 默认 true；`limit` 为 1–1000。时间保存为 ISO 日期或时间戳；周归属使用用户本地周一的日期，避免 UTC 导致跨日。
- 当前项目成员均可读写此画布数据；不能用 UI 隐藏来声称实现成员级私有记录。项目外、无权成员、第三方网页不能访问。页面不含访问令牌或数据库密码。
- `update` / `remove` 先读最新记录，再用 revision 写入；冲突最多重新读取合并 3 次。删除后的记录不能被旧编辑复活。编辑长文本时传 `{revision: record.revision}`，409 时保留用户草稿并提示重新读取，不能自动覆盖别人的编辑。
- 超时意味着结果未确认，不等于未保存。创建时先生成并保留 ID；不确定时 `get(id)` 核实，避免重复提交。写入成功再显示“已保存”；失败保留草稿和可重试入口。离线不要伪称云端已保存。
- 订阅返回注销函数；收到 `reset:true` 是长连接恢复，需重新读取。页面重新可见时也刷新。不要用广播代替存储。

## 加载与交互性能

- 新版客户端和服务端支持 `state.collection-list.v1` 时，集合 `list()` 只读取该集合；相同集合的并发读取合并。旧客户端退回全量读取并合并同时发起的请求。不缓存已经完成的查询；`where/sort/limit` 仍在客户端应用，`limit:10` 不代表服务端只传 10 条。
- 高频画板不要在每条订阅事件中重新查询所有集合。按 `id + revision` 合并 `event.record`，`event.deleted` 删除本地记录；保留删除版本，忽略旧版本。先订阅再读取首次快照，按版本合并快照和期间收到的事件；重连的 `reset:true` 才全量校准。
- 撤销、重做和拖动先更新本地视图，再后台提交。为操作保留顺序和 pending 状态；失败时撤回对应乐观修改或明确提示待重试，不能回滚其他人或后续操作。不要等 `get → update → list` 全部结束才更新画面。
- 大型画作采用版本化附件快照 + 小体积增量记录，先显示快照再补增量；快照版本与增量序号必须匹配，不能用旧快照覆盖更新的笔迹。不要把整幅作品 JSON 在每次光标移动或撤销时反复读取/重写。
- 首次加载尚未完成时显示“恢复作品”状态，不能先声称空画板；按帧分批重建笔迹，避免长时间占用主线程。绘制结果按图层/区块缓存，撤销只重建受影响区块；纹理笔刷不要每次从头重放全图。
- 发布前至少以数百条笔迹/数 MB 数据验证首次打开、重连、连点撤销、两人并发修改；分别记录网络请求数/字节、首幅画面时间、点击到本地反馈时间。离线模拟测试不能当公网或真实移动端测速。

AI 读取、编辑保存的数据（无需页面打开）：
```sh
node scripts/canvas.mjs state-list --canvas UUID
node scripts/canvas.mjs state --canvas UUID --key data.todos.RECORD_ID
```
原始记录键为 `data.COLLECTION.ID`，value 为 `{ "schema":"wanwu-record/1", "data":{...}, "deleted":false }`。AI 写入前读取原记录，只合并用户要求的字段；用文件 `{key,value,revision}` 调用 `state --canvas UUID --input /absolute/change.json --request UUID`，409 重读。删除保留原 revision 并写 `{schema:'wanwu-record/1',deleted:true}`，不要清空整个集合。

可运行示例：[每周 TODO](../examples/weekly-todo/index.html)。创建后至少验证：新增 → 刷新仍在 → 修改/勾选 → 另一个成员读取 → 删除后消失；发布 HTML 更新仍保留数据。截图预览只读，因此不要在加载时执行写入。


多会话同时编辑、批量累加/追加和持续同步请看 [实时更新](live-updates.md)。新接口在服务器内合并，避免客户端读改写的冲突重试。
