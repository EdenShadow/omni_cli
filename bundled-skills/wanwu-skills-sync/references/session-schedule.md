# 当前会话定时任务

使用本技能的 `node scripts/sync.mjs`，每次带本轮消息的 `--scope ID`。先运行 `schedule-get`，获取发起人在当前会话的定时任务、规则和 revision。每人每会话一条，服务自动沿用当前 Runtime、本轮选定的模型、推理强度和执行选项。若只问如何设置，直接解释。

- **新建**。用户说“每天九点检查订单”时，保存 JSON 如 `{"prompt":"检查订单并汇总异常","rule":{"kind":"daily","time":"09:00"}}`，调用 `schedule-create --input FILE --request UUID`。prompt 写每次到点要执行的工作。创建成功后等到点执行。已有任务时，明确要求替换才修改，避免覆盖无关任务。
- **修改**。使用刚读取的实际 ID 和 revision。例如 `{"scheduleId":"实际ID","revision":1,"rule":{"time":"10:30"}}`，调用 `schedule-update --input FILE --request UUID`。只填写要改的规则字段或 prompt，其他设置自动沿用。重试同一次保存时复用 UUID。遇到冲突先重读。
- **取消或删除**。把读取到的 scheduleId 和 revision 写入 JSON，调用 `schedule-delete --input FILE`。删除后不再触发后续任务。如果已经没有任务，直接告知。
- **时间规则**。执行设备本地时间，支持每天 daily、每周 weekly（weekday 为 0–6，0 为周日）、每月 monthly（day 为 1–31）、每 N 天 days（every，可设起始日期 anchor）、每 N 分钟或小时 interval（every，unit 为 minutes 或 hours）。可设 overlap 为 skip 或 wait。时间或执行内容不清楚时，先问缺的部分。单次指定日期目前不支持，勿擅自转换成重复任务。

按实际回执回复任务内容、频率和执行会话。applied 为 false 表示设置已保存，等待设备同步。区别保存与实际执行，无需另开会话或创建系统 cron。
