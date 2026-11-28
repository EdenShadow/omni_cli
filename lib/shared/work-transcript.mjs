import {ConversationPrivacy} from './conversation-privacy.mjs';
import {normalizeClaudeItems} from './claude-content.mjs';
import {messageSentAt} from './work-timing.mjs';
import {ENCRYPTED_SCHEDULE_PROMPT} from './encrypted-schedule.mjs';

const visiblePrompt = text => typeof text === 'string' && text !== ENCRYPTED_SCHEDULE_PROMPT;

export function mergeHistoryItems(first, second) {
  const items = new Map(first.map(item => [item.id, item]));
  const order = [...items.keys()], existing = new Set(order), next = [];
  let anchor;
  for (let i = second.length - 1; i >= 0; i--) {
    next[i] = anchor;
    if (existing.has(second[i].id)) anchor = second[i].id;
  }
  let previous;
  second.forEach((item, i) => {
    if (!items.has(item.id)) {
      const before = order.indexOf(next[i]), after = order.indexOf(previous);
      order.splice(before >= 0 ? before : after >= 0 ? after + 1 : order.length, 0, item.id);
    }
    items.set(item.id, {...items.get(item.id), ...item});
    previous = item.id;
  });
  return order.map(id => items.get(id));
}

// Merge source snapshots with live delivery without appending missing activity after
// a historical answer. Item IDs, command IDs and provider turn IDs stay distinct.
export function reduceMessages(events, history = [], commands = [], {historyHasMore = false, historyReady = true} = {}) {
  const byCommand = new Map(commands.map(c => [c.id, c]));
  const commandOrder = new Map(commands.map((c, i) => [c.id, i])), dispatchedAt = new Map();
  const normalize = item => {
    if (item.role !== 'user') return item;
    const scope = [...(item.text || '').matchAll(/^<wanwu scope="([0-9a-f-]{36})"(?: from="[^\n]*")? \/>$/gm)].at(-1)?.[1];
    const commandId = item.commandId || scope || item.text?.match(/\[wanwu-message:([0-9a-f-]{36})\]/)?.[1];
    if (!commandId) return item;
    const command = byCommand.get(commandId);
    // Delivery and provider history can arrive before the command-list refresh.
    // Keep one prompt identity throughout that handoff, including on reconnect.
    return {...item, id: 'command:' + commandId, commandId, dispatched: true, ...(command && visiblePrompt(command.prompt) ? {
      author: command.author ?? item.author, text: command.prompt,
      maskedPreview: command.maskedPreview ?? item.maskedPreview, attachments: command.attachments} : {})};
  };
  const eventTimes = new Map();
  const live = [], fragments = new Map(), submissions = new Map();
  for (const event of events) {
    let p = event.payload;
    if (p?.kind === 'fragment') {
      const {group, index, total, data} = p;
      if (!Number.isInteger(index) || !Number.isInteger(total) || total < 1 || total > 10000 || index < 0 || index >= total || typeof data !== 'string') continue;
      const bundle = fragments.get(group) || {parts: new Map()};
      bundle.parts.set(index, data); fragments.set(group, bundle);
      if (bundle.parts.size !== total) continue;
      try {p = JSON.parse(Array.from({length: total}, (_, i) => bundle.parts.get(i) || '').join(''));} catch {continue;}
      fragments.delete(group);
    }
    // Enqueue is a shared queue update, not a sent user message. Place the
    // prompt at the persisted dispatch event, so reconnects and later status
    // changes cannot backdate it into the middle of the preceding response.
    if (p?.kind === 'command' && p.status === 'queued' && p.text !== undefined)
      submissions.set(p.id, p);
    if (p?.kind === 'status' && p.status === 'working' && p.commandId) {
      if (!dispatchedAt.has(p.commandId) && Number.isFinite(event.created)) dispatchedAt.set(p.commandId, event.created);
      const submitted = submissions.get(p.commandId), command = byCommand.get(p.commandId);
      const display = visiblePrompt(command?.prompt) ? command : visiblePrompt(submitted?.text) ? submitted : undefined;
      if (display) live.push(normalize({kind: 'message', role: 'user',
        id: 'command:' + p.commandId, commandId: p.commandId, dispatched: true,
        text: display.prompt ?? display.text, author: command?.author ?? submitted?.author,
        maskedPreview: display.maskedPreview, attachments: display.attachments ?? submitted?.attachments,sentAt:command?.created??event.created}));
    }
    if (p && ['message', 'delta', 'tool', 'diagnostic'].includes(p.kind)) {
      // Older clients flattened Claude thinking and tool blocks into a reply.
      // Reuse the source blocks when replaying those already-stored events.
      if (Number.isFinite(event.created) && !eventTimes.has(p.id)) eventTimes.set(p.id,event.created);
      const raw=p.raw;
      if(raw&&['assistant','user'].includes(raw.type)&&Array.isArray(raw.message?.content)) {
        normalizeClaudeItems(raw,p.id).forEach((item,index)=>live.push(normalize({...item,commandId:p.commandId,
          ...(index===0&&p.replaceId?{replaceId:p.replaceId}:{})})));
      } else live.push(normalize(p.role==='user'?{...p,sentAt:p.sentAt??event.created}:p));
    }
  }
  // The native transcript omits submissions that failed before turn/start. A
  // later successful turn may already be in history while its live events have
  // not arrived (or were skipped on reopen). Use durable command chronology as
  // another anchor; lack of a shared item ID must not mean "append at the end".
  const position = item => {
    const command = byCommand.get(item.commandId);
    const time = [dispatchedAt.get(item.commandId), command?.startedAt, command?.created, item.startedAt].find(Number.isFinite);
    return {time, order: commandOrder.get(item.commandId)};
  };
  const compare = (a, b) => Number.isFinite(a.time) && Number.isFinite(b.time) && a.time !== b.time ? a.time - b.time :
    Number.isFinite(a.order) && Number.isFinite(b.order) ? a.order - b.order : 0;
  // Legacy peers may still replay the transport placeholder before the display
  // envelope is ready. It is never a transcript row and must not erase text that
  // has already arrived from the source history or the optimistic send.
  const presentable = item => item.role !== 'user' || item.text !== ENCRYPTED_SCHEDULE_PROMPT;
  const source = history.map(normalize).filter(presentable);
  for (let i = live.length - 1; i >= 0; i--) if (!presentable(live[i])) live.splice(i, 1);
  const commandAnchors = source.filter(item => item.role === 'user').map(item => ({id: String(item.id), commandId: item.commandId, position: position(item)}));
  const turnRoots = new Map(), guidance = [];
  for (const prompt of source) {
    if (prompt.role !== 'user' || !prompt.commandId) continue;
    const parent = byCommand.get(prompt.commandId)?.parentId || turnRoots.get(prompt.turnId);
    if (parent && parent !== prompt.commandId) guidance.push({prompt, parent});
    if (prompt.turnId && !turnRoots.has(prompt.turnId)) turnRoots.set(prompt.turnId, parent || prompt.commandId);
  }
  const followingCommand = item => commandAnchors.find(anchor => anchor.commandId !== item.commandId && compare(position(item), anchor.position) < 0)?.id;
  const map = new Map();
  for (const p of source) map.set(String(p.id), {...map.get(String(p.id)), ...p});
  const order = [...map.keys()];
  // Failure metadata survives reconnects even when no live events are replayed.
  // Reconstruct only failed root attempts, never queued/cancelled unsent input or
  // synthetic steer prompts. Older failures join when that history page loads.
  const historyStart = source.length ? position(source[0]).time : undefined;
  const failed = commands.filter(c => historyReady && c.status === 'failed' && !c.parentId && visiblePrompt(c.prompt))
    .sort((a, b) => compare(position({commandId: a.id}), position({commandId: b.id})));
  for (const command of failed) {
    const item = normalize({id: 'command:' + command.id, commandId: command.id, kind: 'message', role: 'user', dispatched: true});
    if (map.has(item.id)) continue;
    // A bounded tail can start inside a long turn, before its prompt/time anchor
    // has been loaded. Unknown chronology is not evidence that every old failure
    // belongs after the latest reply. Restore those attempts when pagination
    // supplies their window; live dispatch events below remain authoritative.
    if (historyHasMore && (!Number.isFinite(historyStart) || position(item).time < historyStart)) continue;
    const before = order.indexOf(followingCommand(item));
    order.splice(before >= 0 ? before : order.length, 0, item.id); map.set(item.id, item);
  }
  const historical = new Map(map);
  // Find the next historical anchor once, so reconnecting long sessions is linear
  // apart from inserting genuinely missing items into the displayed order.
  const firstSeen = new Map();
  live.forEach((item, i) => {const id = String(item.id); if (!firstSeen.has(id)) firstSeen.set(id, i);});
  const next = []; let anchor;
  for (let i = live.length - 1; i >= 0; i--) {
    next[i] = anchor;
    const id = String(live[i].id);
    // A late delta/completion updates its original row; it is not a new
    // chronological anchor for prompts or activity that arrived before it.
    if (historical.has(id) && firstSeen.get(id) === i) anchor = id;
  }
  const liveItems=new Map();
  let previous;
  live.forEach((p, index) => {
    const id = String(p.id), old = liveItems.get(id), source=historical.get(id);
    if (p.replaceId && p.replaceId !== id) {
      const replaced = String(p.replaceId), at = order.indexOf(replaced);
      if (!map.has(id) && at >= 0) order[at] = id;
      else if (at >= 0) order.splice(at, 1);
      map.delete(replaced);
      liveItems.delete(replaced);
    }
    if (!order.includes(id)) {
      const nextId = next[index], nextItem = nextId ? live[firstSeen.get(nextId)] : undefined;
      // Replayed history may already have skipped an older item's first event.
      // Its first *received* update still cannot anchor a later command before it.
      // A steered runtime keeps emitting under its original command ID. Once
      // the inserted prompt is in history, place new items after that prompt
      // even when the command list still dates the parent before the steer.
      const continuation = p.role !== 'user' && guidance.findLast(({prompt:item,parent}) => {
        if (parent !== p.commandId && (!p.turnId || p.turnId !== item.turnId)) return false;
        const seen = firstSeen.get(String(item.id));
        if (seen !== undefined) return seen < index;
        const at = dispatchedAt.get(item.commandId) ?? byCommand.get(item.commandId)?.startedAt ?? item.sentAt;
        return Number.isFinite(at) && eventTimes.get(p.id) >= at;
      })?.prompt;
      const chronologicalItem = continuation || p;
      const beforeId = nextItem && compare(position(chronologicalItem), position(nextItem)) <= 0 ? nextId : followingCommand(chronologicalItem);
      const before = order.indexOf(beforeId);
      const after = Math.max(previous ? order.indexOf(previous) : -1, continuation ? order.indexOf(String(continuation.id)) : -1);
      const dispatchedPrompt = p.role === 'user' && p.dispatched && !byCommand.get(p.commandId)?.parentId;
      order.splice(before >= 0 ? before : dispatchedPrompt ? order.length : after >= 0 ? after + 1 : order.length, 0, id);
    }
    const liveItem=p.kind==='delta'?{...old,...p,kind:old?.kind||(p.role==='system'?'tool':'message'),
      text:(old?.text||'')+(p.text||''),streaming:true}:{...old,...p,streaming:p.streaming??p.status==='inProgress'};
    liveItems.set(id,liveItem);
    let merged={...source,...liveItem};
    // Build the stream independently from history. Prefer a longer matching
    // snapshot until the stream catches up; never discard all future deltas.
    if((p.kind==='delta'||p.status==='inProgress')&&typeof source?.text==='string'&&typeof liveItem.text==='string'&&
       source.text.length>liveItem.text.length&&source.text.startsWith(liveItem.text))
      merged={...merged,text:source.text,status:source.status||liveItem.status};
    map.set(id,merged);
    // Updating an older parallel call must not move the insertion point back:
    // the next newly-started tool belongs after the latest first-seen activity.
    if (order.indexOf(id) > order.indexOf(previous)) previous = id;
  });
  const privacy=new ConversationPrivacy();
  for(const command of commands)if(command.visibilityVersion!==1)privacy.learn(command);
  const items=order.map(id => map.get(id)).filter(Boolean);
  const visible=items.map(item=>byCommand.get(item.commandId)?.visibilityVersion===1?item:privacy.page({items:[item]}).items[0]);
  return visible.map((item,index)=>{
    const c=byCommand.get(item.commandId),root=c&&(byCommand.get(c.parentId)||c);
    if(!c)return item;
    if(item.role==='user')return c.messagePrivate?{...item,text:'***',maskedPreview:'***',attachments:c.attachments}:c.visibilityVersion===1?{...item,text:c.prompt,maskedPreview:undefined}:item;
    if(root.responsePrivate)return {id:item.id,kind:'message',role:'assistant',text:'',commandId:c.id,turnId:item.turnId,privacyHidden:true};
    return item;
  });
}

export function activityType(item) {
  if (item.kind === 'diagnostic' || item.label === 'runtime-connection') return 'connection';
  const type = item.activity || item.raw?.type || item.label;
  if (type === 'runtimeQuestion' || type === 'question') return 'question';
  if (type === 'transfer' || type === 'attachment-transfer') return 'transfer';
  if (type === 'plan') return 'plan';
  if (['reasoning', 'thinking', '思考摘要'].includes(type)) return 'reasoning';
  if (['command', 'commandExecution', 'Bash'].includes(type)) return 'command';
  if (['file', 'fileChange', 'Edit', 'Write', 'MultiEdit'].includes(type)) return 'file';
  if (['read', 'Read', 'Glob', 'Grep'].includes(type)) return 'read';
  if (['search', 'webSearch', 'WebSearch', 'WebFetch'].includes(type)) return 'search';
  return item.role === 'assistant' && item.kind === 'message' ? 'commentary' : 'tool';
}

// This is a small public progress label, not the command body or tool JSON.
// Keep the original records intact for the explicitly expanded history.
export function activitySummary(item, english=false) {
  const t=(zh,en)=>english?en:zh,type=activityType(item);
  if(type==='question')return item.status==='waiting'?t('等待你的回答','Waiting for your answer'):item.status==='completed'?t('已收到回答','Answer received'):t('提问已结束','Question closed');
  if(['failed','declined','error'].includes(item.status))return t('执行遇到问题','Execution needs attention');
  const labels={transfer:t('正在接收附件','Receiving attachments'),plan:t('正在安排步骤','Planning steps'),
    reasoning:t('正在思考','Thinking'),command:t('正在运行命令','Running a command'),file:t('正在编辑文件','Editing files'),
    read:t('正在读取文件','Reading files'),search:t('正在搜索','Searching'),commentary:t('正在处理','Working'),
    connection:item.willRetry===false?t('连接中断','Connection interrupted'):t('正在重新连接','Reconnecting'),tool:t('正在使用工具','Using a tool')};
  if(['reasoning','commentary'].includes(type)) {
    const text=String(item.text||'').trim();
    if(text&&!/^(?:[{\[]|```)/.test(text)) {
      const first=text.split('\n').find(line=>line.trim())||'';
      return first.replace(/^\s{0,3}#{1,6}\s+/,'').replace(/\[([^\]]+)\]\([^)]+\)/g,'$1').replace(/[*_`]/g,'').trim().slice(0,120)||labels[type];
    }
  }
  const tool=String(item.toolName||item.label||'').toLowerCase();
  if(type==='tool'&&/^(imagegeneration|image_gen|imagegen|imageview|view_image)$/.test(tool))return /view/.test(tool)?t('正在查看图片','Viewing an image'):t('正在生成图片','Generating an image');
  return labels[type]||labels.tool;
}

export function latestWorkActivity(turn) {
  return (turn.active&&turn.activity.findLast(item=>activityType(item)==='question'&&item.status==='waiting'))||turn.activity.at(-1);
}

// Keep the last public progress message visible when guidance seals a segment,
// too. A new prompt must not delete what the user was just reading above it.
// Final/streaming replies already render in full, so do not repeat stale progress
// alongside them. Reasoning summaries, tool output and prompts stay in history.
const commentaryPreviews = new WeakMap();
export function latestWorkCommentary(turn) {
  if (!commentaryPreviews.has(turn)) commentaryPreviews.set(turn,
    turn.replies.some(item => item.text?.trim()) ? undefined :
      turn.activity.findLast(item => item.kind === 'message' && item.role === 'assistant' &&
        activityType(item) === 'commentary' && item.text?.trim()));
  return commentaryPreviews.get(turn);
}

// Use the newest invocation, not the latest output chunk: a slow earlier command
// may keep streaming after a newer command has started. Never preview prompts or
// stdout as executable input. The expanded records retain the original content.
export function latestWorkCommand(turn) {
  if (!turn.active) return;
  for (let i = turn.activity.length - 1; i >= 0; i--) {
    const item = turn.activity[i];
    if (item.kind !== 'tool' || item.role === 'user') continue;
    let command = item.command;
    if (typeof command !== 'string' && activityType(item) === 'command') {
      command = item.raw?.command;
      // Claude streams tool input JSON before its normalized envelope arrives.
      if (typeof command !== 'string' && typeof item.text === 'string') {
        try { command = JSON.parse(item.text)?.command; } catch { /* Input still streaming. */ }
      }
    }
    if (typeof command === 'string' && command.trim()) return {id:String(item.id), command:command.trim()};
  }
}

// Disjoint source, preview and replay pages can arrive in either order. Order
// whole exchanges, so their replies, files and guidance keep their original sequence.
function orderWorkGroups(groups, activeId) {
  const times = new Map();
  for (const group of groups) {
    if (times.has(group.key)) continue;
    const time = group.command?.startedAt || group.command?.created ||
      messageSentAt(group.prompts[0] || group.items[0]);
    if (Number.isFinite(time)) times.set(group.key, time);
  }
  const dated = groups.filter(group => times.has(group.key));
  dated.sort((a, b) => times.get(a.key) - times.get(b.key));
  let index = 0;
  const ordered = groups.map(group => times.has(group.key) ? dated[index++] : group);
  if (!activeId) return ordered;
  // A legacy page can have no clocks at all. The claimed command still identifies
  // the live exchange (including its guidance segments) independently of arrival order.
  const current = ordered.filter(group => group.key === activeId);
  return current.length ? [...ordered.filter(group => group.key !== activeId), ...current] : ordered;
}

export function buildWorkTurns(messages, commands = [], sessionStatus = '', workingCommandId) {
  const byCommand = new Map(commands.map(c => [c.id, c])), aliases = new Map();
  const root = id => byCommand.get(id)?.parentId || id;
  // History includes turn IDs; live events also include their originating command.
  // Resolve both before grouping, even when history arrives ahead of the live user.
  for (const m of messages) if (m.turnId && m.commandId) {
    if (!aliases.has(m.turnId) || byCommand.get(m.commandId)?.parentId)
      aliases.set(m.turnId, root(m.commandId));
  }
  const groups = [], latest = new Map(); let current;
  for (const m of messages) {
    // Actual source-history prompts and dispatch events may precede the latest
    // command snapshot. Keep those; suppress only an unsubmitted queued echo.
    if (m.role === 'user' && byCommand.get(m.commandId)?.status === 'queued' && !m.dispatched && !m.turnId) continue;
    const key = m.turnId && aliases.get(m.turnId) || m.commandId && root(m.commandId) ||
      m.turnId && 'turn:' + m.turnId || (m.role === 'user' ? m.id : current) || 'earlier';
    let group = latest.get(key);
    // A steer continues the same runtime turn, but starts a new displayed
    // exchange. Keep already-delivered activity above the appended question.
    // The message ID makes this boundary stable as tools stream or history loads.
    const prompt = m.role === 'user' && m.kind === 'message';
    const recoveredRootPrompt = prompt && m.commandId === key && group && !group.prompts.length;
    if (!group || prompt && group.items.length && !recoveredRootPrompt) {
      group = {id: m.role === 'user' && m.kind === 'message' ? 'prompt:' + m.id : String(key), key,
        prompts: [], items: [], command: byCommand.get(key)};
      groups.push(group); latest.set(key, group);
    }
    if (recoveredRootPrompt) group.id = 'prompt:' + m.id;
    if (m.role === 'user' && m.kind === 'message') {const sentAt=messageSentAt(m,byCommand.get(m.commandId));group.prompts.push(sentAt?{...m,sentAt}:m);}
    else group.items.push(m);
    // Queued prompts can arrive while a different turn is still streaming.
    if (group.command?.status !== 'queued') current = key;
  }
  const currentWork = sessionStatus === 'working' ? workingCommandId : undefined;
  const currentCommand = byCommand.get(currentWork);
  const activeId = currentCommand && ['done','failed','cancelled'].includes(currentCommand.status) ? undefined : currentWork;
  const ordered = orderWorkGroups(groups, activeId);
  const last = ordered.findLast(g => g.command?.status !== 'queued');
  return ordered.map(group => {
    const continued = latest.get(group.key) !== group;
    // A room snapshot can announce a new command before its messages or metadata arrive.
    // Only the matching group can inherit its working status.
    const inheritsStatus = currentWork ? group.key === workingCommandId : group === last;
    let status = group.command?.status || (inheritsStatus ? sessionStatus : 'done');
    if (activeId && group.key === activeId && status === 'queued') status = 'working';
    if (continued || activeId && group.key !== activeId && ['running','steering','steered'].includes(status)) status = 'done';
    const active = ['running', 'steering', 'steered', 'working'].includes(status);
    const assistants = group.items.filter(m => m.role === 'assistant' && m.kind === 'message' && m.text?.trim());
    const explicit = assistants.filter(m => (m.phase || m.raw?.phase) === 'final_answer');
    const legacy = assistants.filter(m => !(m.phase || m.raw?.phase));
    const tail=legacy.at(-1),tailIndex=group.items.indexOf(tail);
    // Phase-less providers can stream their newest text directly as a response.
    // Once a tool follows it, that text becomes progress in the process list.
    const hasLaterActivity=group.items.slice(tailIndex+1).some(m=>m.kind==='tool'&&activityType(m)!=='connection');
    const replies = explicit.length ? explicit : tail&&(!active||!hasLaterActivity) ? [tail] : [];
    const activity = [], connections = [];
    for (const item of group.items) {
      if (replies.includes(item)) continue;
      const type = activityType(item);
      if (type === 'connection') {connections.push(item); continue;}
      if (type === 'reasoning' && !item.text?.trim()) continue;
      activity.push({...item, activity: type});
    }
    // Retry telemetry is not a tool invocation. Keep one compact warning only
    // while relevant; a successful answer should not be followed by stale errors.
    if (connections.length && (active || status === 'failed')) {
      const connection = connections.at(-1);
      activity.push({...connection, id: group.id + ':connection', activity: 'connection',
        attempts: Math.max(connections.length, Number(connection.attempts) || 1)});
    }
    const startedAt=!continued&&Number.isFinite(group.command?.startedAt)?group.command.startedAt:undefined;
    const finishedAt=!active&&Number.isFinite(group.command?.finishedAt)?group.command.finishedAt:undefined;
    return {id: group.id, commandId:group.command?.id || (currentWork && inheritsStatus ? workingCommandId : undefined), prompts: group.prompts, activity, replies, active, status, error: continued ? undefined : group.command?.error,
      ...(startedAt?{startedAt,...(finishedAt?{finishedAt}:{})}:{})};
  });
}
