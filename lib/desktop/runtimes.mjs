import {CodexUsage,ClaudeUsage,codexCounters} from './token-usage.mjs';
import {findDesktopDsh} from './dsh-desktop.mjs';
import {findDesktopCodex} from './codex-desktop.mjs';
import {skillInstallRoot} from './skills/packages.mjs';
import {runtimeAnswerValues} from '../shared/runtime-questions.mjs';
import {askRuntimeQuestion,codexQuestionArgs,questionGuidance} from './runtime-question-flow.mjs';
import {withoutInlineMedia} from '../shared/transcript-media.mjs';
import {skillSearchRoots,localSkillCandidates} from './skills/local-reuse.mjs';
import {normalizeClaudeItems,ClaudeStream} from '../shared/claude-content.mjs';
export {normalizeClaudeItems,normalizeClaudeMessage} from '../shared/claude-content.mjs';
import {spawnRuntime, runtimeSearchPath, resolveRuntimeExecutable} from "./runtime-launch.mjs";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";
import {
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  cpSync,
  statSync,
  realpathSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const candidates = {
  dsh: [process.env.WANWU_DSH_PATH,path.join(homedir(),'.local/bin/dsh'),'/opt/homebrew/bin/dsh','/usr/local/bin/dsh'],
  codex: [
    process.env.WANWU_CODEX_PATH,
    path.join(homedir(), ".local/bin/codex"),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
    "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
    "/Applications/Codex.app/Contents/Resources/codex",
  ],
  claude: [
    process.env.WANWU_CLAUDE_PATH,
    path.join(homedir(), ".local/bin/claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ],
};
export function runtimePath() {
  if(process.platform==='win32')return runtimeSearchPath();
  const nvm = path.join(homedir(), ".nvm/versions/node");
  const versions = existsSync(nvm)
    ? readdirSync(nvm)
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
        .map((v) => path.join(nvm, v, "bin"))
    : [];
  return [
    path.join(homedir(), ".local/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    ...versions,
    process.env.PATH || "",
  ].join(path.delimiter);
}
export function detectRuntimes() {
  return ["codex", "claude", "dsh"].map((provider) => {
    const executable = [
      ...candidates[provider],
      ...runtimePath()
        .split(path.delimiter)
        .flatMap((p) => (process.platform==='win32'?['.exe','.cmd','']:['']).map(ext=>path.join(p,provider+ext))),
    ].map(p=>resolveRuntimeExecutable(provider,p)).find(Boolean)||(provider==='dsh'?findDesktopDsh():provider==='codex'?findDesktopCodex():null);
    return { provider, available: !!executable, path: executable || null };
  });
}
export function hashTree(dir, template = dir) {
  const h = createHash("sha256");
  function walk(d, prefix = "") {
    for (const f of readdirSync(path.join(template, prefix), {
      withFileTypes: true,
    }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (f.name.startsWith(".")) continue;
      const relative = prefix + f.name;
      if (f.isDirectory()) walk(path.join(d, f.name), relative + "/");
      else if (f.isFile()) {
        h.update(relative);
        h.update(readFileSync(path.join(d, f.name)));
      }
    }
  }
  walk(dir);
  return h.digest("hex");
}
export function installSkills(sourceRoot, provider, onProgress = () => {}) {
  const root = skillInstallRoot(provider);
  mkdirSync(root, { recursive: true });
  return ["office-character-studio", "office-space-designer", "announcement-designer", "wanwu-skills-sync", "wanwu-canvas"].filter(name=>existsSync(path.join(sourceRoot,name))).map((name) => {
    const source = path.join(sourceRoot, name),
      dest = path.join(root, name),
      sourceHash = hashTree(source);
    onProgress({ name, state: "checking" });
    const receipt=path.join(dest,'.wanwu-skill.json');
    if(existsSync(receipt)) {
      let installed;try{installed=JSON.parse(readFileSync(receipt,'utf8'));}catch{return {name,state:'current',warning:'本地版本记录损坏，已保留现有技能'};}
      if(installed.source==='wanwu-registry') {
        onProgress({name,state:'current',version:installed.version});
        return {name,state:'current',hash:installed.sha256,version:installed.version};
      }
    }
    if (
      existsSync(dest) &&
      (() => {
        try {
          return hashTree(dest, source) === sourceHash;
        } catch {
          return false;
        }
      })()
    ) {
      onProgress({ name, state: "current" });
      return { name, state: "current", hash: sourceHash };
    }
    // Bootstrap is not an upgrade operation. Preserve external/manual skills;
    // registry updates use the content-checked installer and its explicit backup.
    if (localSkillCandidates(skillSearchRoots(provider,root),name).length||existsSync(dest)) {
      const result={name,state:'current',warning:'已保留已有本地技能；由项目技能同步核验版本 / Existing local skill preserved for project verification'};
      onProgress(result);return result;
    }
    cpSync(source, dest, { recursive: true });
    onProgress({ name, state: "installed" });
    return { name, state: "installed", hash: sourceHash };
  });
}
export function normalizeCodexItem(item, context = {}) {
  if (!item) return null;
  item = withoutInlineMedia(item);
  // Generated image bytes belong to the local file, never the transcript wire format.
  if (item.type === 'imageGeneration') {
    const {result, ...metadata} = item;
    return {id:item.id || randomUUID(),kind:'tool',role:'system',activity:item.type,
      label:'imageGeneration',status:item.status || context.status,turnId:context.turnId,
      startedAt:context.startedAtMs,completedAt:context.completedAtMs,
      text:[item.revisedPrompt,item.failure?.message].filter(v=>typeof v==='string').join('\n'),
      paths:typeof item.savedPath==='string'?[item.savedPath]:[],raw:metadata};
  }
  const common = { id: item.id || randomUUID(), raw: item.type === 'reasoning' ? {type:item.type,summary:item.summary} : item,
    turnId:context.turnId, startedAt:context.startedAtMs, completedAt:context.completedAtMs,
    status: item.status || context.status, activity:item.type };
  if (item.type === "agentMessage")
    return { ...common, kind: "message", role: "assistant", text: item.text, phase:item.phase };
  if (item.type === "userMessage")
    return {
      ...common,
      kind: "message",
      role: "user",
      text: item.content
        .map((c) => c.text || (c.type.includes("mage") ? "[图片]" : ""))
        .join("\n"),
    };
  if (item.type === "reasoning")
    return {
      ...common,
      kind: "tool",
      role: "system",
      label: "思考摘要", activity:"reasoning",
      text: (item.summary || []).join("\n"),
    };
  return {
    ...common,
    kind: "tool",
    role: "system",
    label: item.type === 'mcpToolCall' ? [item.server,item.tool].filter(Boolean).join(' · ') : item.type, command:item.command, paths:item.changes?.map(c=>c.path), toolName:item.tool, query:item.query,
    text: item.command
      ? [item.command, item.aggregatedOutput].filter(Boolean).join("\n")
      : JSON.stringify(item, null, 2),
  };
}
export class CodexAdapter extends EventEmitter {
  constructor(executable, ask, {reconnectTimeoutMs=300000,interruptTimeoutMs=5000}={}) {
    super();
    this.reconnectTimeoutMs=reconnectTimeoutMs;
    this.interruptTimeoutMs=interruptTimeoutMs;
    this.executable = executable;
    this.ask = ask;
    this.pending = new Map();
    this.next = 1;
    this.turns = new Map();
    this.fresh = new Set();
  }
  async start() {
    if (this.ready) return this.ready;
    this.ready = this.initialize();
    try {
      return await this.ready;
    } catch (e) {
      this.ready = null;
      throw e;
    }
  }
  async initialize() {
    this.child = spawnRuntime(
      this.executable,
      ["app-server", "--listen", "stdio://", ...codexQuestionArgs],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          PATH: runtimePath(),
        },
      },
    );
    this.child.on("error", (e) => this.shutdown(e));
    this.child.on("exit", () => this.shutdown(Error("Codex 进程已退出")));
    this.child.stderr.on("data", () => {});
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      try {
        this.receive(JSON.parse(line));
      } catch {}
    });
    await this.rpc("initialize", {
      clientInfo: { name: "wanwu-ai", title: "万物 AI", version: "1.0.0" },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    this.child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
  }
  shutdown(error) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
    for (const t of this.turns.values()) {
      clearTimeout(t.reconnectTimer);
      t.controller?.abort();
      t.reject(t.terminalError||error);
    }
    this.turns.clear();
    this.ready = null;
  }
  rpc(method, params) {
    return new Promise((resolve, reject) => {
      const id = this.next++,
        timer = setTimeout(() => {
          this.pending.delete(id);
          reject(Error("Codex 请求超时：" + method));
        }, 60000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }
  async receive(msg) {
    if (msg.id !== undefined && !msg.method) {
      const p = this.pending.get(msg.id);
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(msg.id);
        msg.error ? p.reject(Error(msg.error.message)) : p.resolve(msg.result);
      }
      return;
    }
    if (msg.id !== undefined && msg.method) {
      let result;
      try {
        const turn = this.turns.get(msg.params?.threadId);
        if(turn)this.clearReconnect(turn);
        const context = {provider: 'codex', requestId: String(msg.id),
          commandId:turn?.commandId, projectId:turn?.projectId, approvalScope: turn?.approvalScope, signal: turn?.controller?.signal};
        if (
          ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(msg.method)
        ) {
          const ok = await this.ask({
            ...context, kind: 'permission',
            title: "Codex 请求操作权限",
            detail: JSON.stringify(msg.params, null, 2),
          });
          result = { decision: ok === true ? "accept" : "decline" };
        } else if (msg.method === "item/tool/requestUserInput") {
          const answer = await askRuntimeQuestion(this.ask,{
            ...context, kind: 'question',
            title: "Codex 需要你的回答",
            detail: JSON.stringify(msg.params.questions),
            // Codex's optional "Other" row is not a closed-choice contract.
            // Wanwu always offers a text answer, including notes on a selection.
            questions: (msg.params.questions || []).map(q=>({...q,isOther:true})),
          },turn?.emit);
          result = {
            answers: Object.fromEntries(
              (msg.params.questions || []).map((q,i) => [
                q.id,
                { answers: runtimeAnswerValues(answer,q,i) },
              ]),
            ),
          };
        } else if (msg.method === "item/permissions/requestApproval") {
          const ok = await this.ask({...context, kind: 'permission',
            title: 'Codex 请求操作权限', detail: JSON.stringify(msg.params, null, 2)});
          result = { permissions: ok === true ? msg.params.permissions || {} : {}, scope: 'turn' };
        }
        else if (msg.method === "mcpServer/elicitation/request")
          result = { action: "decline", content: null };
        else {
          this.child.stdin.write(
            JSON.stringify({
              id: msg.id,
              error: {
                code: -32601,
                message: "Omni AI does not support this request",
              },
            }) + "\n",
          );
          return;
        }
        this.child.stdin.write(JSON.stringify({ id: msg.id, result }) + "\n");
      } catch {
        this.child.stdin.write(
          JSON.stringify({
            id: msg.id,
            error: { code: -32000, message: "Request declined" },
          }) + "\n",
        );
      }
      return;
    }
    const p = msg.params || {},
      turn = this.turns.get(p.threadId);
    this.emit("notification", msg);
    if (!turn) {
      if(msg.method==='thread/tokenUsage/updated'){this.usageBaselines||=new Map();const total=codexCounters(p.tokenUsage?.total);if(total)this.usageBaselines.set(p.threadId,total);}
      return;
    }
    const eventTurnId=p.turnId||p.turn?.id;
    if(turn.turnId&&eventTurnId&&turn.turnId!==eventTurnId)return;
    if(!turn.turnId&&eventTurnId)turn.turnId=eventTurnId;
    // Once a terminal error is accepted, late retry/progress notifications must
    // not revive the turn while its interrupt acknowledgement is in flight.
    if(turn.terminalError&&msg.method!=='turn/completed')return;
    // Only real output resets the reconnect budget; usage/heartbeat and more
    // retry notifications must not keep a broken upstream alive indefinitely.
    if(['item/agentMessage/delta','item/commandExecution/outputDelta','item/reasoning/summaryTextDelta','item/started','item/completed','turn/plan/updated'].includes(msg.method))this.clearReconnect(turn);
    if (msg.method === "item/agentMessage/delta")
      turn.emit({
        kind: "delta",
        id: p.itemId,
        role: "assistant",
        text: p.delta, turnId:p.turnId,
      });
    else if (msg.method === "item/commandExecution/outputDelta")
      turn.emit({ kind: "delta", id: p.itemId, turnId:p.turnId, role: "system", text: p.delta, activity:"command" });
    else if (msg.method === 'item/reasoning/summaryTextDelta') {
      turn.summaries ||= new Map();
      const parts = turn.summaries.get(p.itemId) || [];
      parts[p.summaryIndex] = (parts[p.summaryIndex] || '') + p.delta;
      turn.summaries.set(p.itemId, parts);
      turn.emit({kind:'tool', id:p.itemId, turnId:p.turnId, role:'system', activity:'reasoning', label:'思考摘要', status:'inProgress', text:parts.join('\n')});
    }
    else if (msg.method === 'turn/plan/updated')
      turn.emit({kind:'tool',id:p.turnId+':plan',turnId:p.turnId,role:'system',activity:'plan',label:'执行计划',text:(p.plan||[]).map(step=>(step.status==='completed'?'[x] ':'[ ] ')+step.step).join('\n')});
    else if (msg.method === "error") {
      const message=p.error?.message||p.message||'Codex connection failed';
      // Capacity errors explicitly ask the user to choose another model. Some
      // runtime versions still mark these retryable; do not retry that model.
      const capacity=/\b(?:selected\s+)?model\s+is\s+(?:currently\s+)?at\s+capacity\b/i.test(message);
      const willRetry=p.willRetry===true&&!capacity;
      turn.retries = (turn.retries || 0) + 1;
      if(!willRetry)turn.terminalError=Error(message);
      turn.emit({kind:'diagnostic',id:(p.turnId||turn.turnId||p.threadId)+':connection',turnId:p.turnId,role:'system',activity:'connection',willRetry,status:willRetry?'inProgress':'failed',attempts:turn.retries,text:message});
      if(!willRetry){
        this.clearReconnect(turn);
        if(capacity&&p.willRetry!==false)void this.interruptTurn(p.threadId,turn,turn.terminalError);
        else this.finishTurn(p.threadId,turn,turn.terminalError);
      }
      else if(!turn.reconnectTimer){
        turn.reconnectTimer=setTimeout(()=>void this.interruptTurn(p.threadId,turn,Error('AI 连接持续中断，本轮已停止，已生成文件会保留 / AI connection could not recover; this turn was stopped and generated files were preserved')),this.reconnectTimeoutMs);
        turn.reconnectTimer.unref?.();
      }
    }
    else if (msg.method === "item/started" && p.item?.type !== "userMessage")
      turn.emit(normalizeCodexItem(p.item, {turnId:p.turnId,status:msg.method==='item/started'?'inProgress':'completed'}));
    else if (msg.method === "item/completed")
      turn.emit(normalizeCodexItem(p.item, {turnId:p.turnId,status:msg.method==='item/started'?'inProgress':'completed'}));
    else if (msg.method === "thread/tokenUsage/updated") {
      const accounting=turn.accounting?.accept(p);
      this.usageBaselines||=new Map();const total=codexCounters(p.tokenUsage?.total);if(total)this.usageBaselines.set(p.threadId,total);
      turn.emit({kind:"usage",...p,...(accounting?{accounting}:{})});
    }
    else if (msg.method === "turn/completed") {
      this.finishTurn(p.threadId,turn,p.turn?.status==='failed'?Error(p.turn?.error?.message||'Codex 执行失败'):null,{cancelled:p.turn?.status==='interrupted'});
    }
  }
  clearReconnect(turn) {
    clearTimeout(turn.reconnectTimer);turn.reconnectTimer=null;turn.retries=0;
  }
  finishTurn(id,turn,error,result) {
    if(this.turns.get(id)!==turn)return;
    this.clearReconnect(turn);turn.controller?.abort();this.turns.delete(id);
    error=turn.terminalError||error;
    if(error)turn.reject?.(error);else turn.resolve?.(result);
  }
  async interruptTurn(id,turn,error) {
    if(this.turns.get(id)!==turn||turn.interrupting)return;
    turn.interrupting=true;turn.controller?.abort();
    const turnId=turn.turnId||await turn.started;
    if(this.turns.get(id)!==turn)return;
    let timer;
    try {
      if(turnId)await Promise.race([
        this.rpc('turn/interrupt',{threadId:id,turnId}),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Codex interrupt timed out')),this.interruptTimeoutMs);}),
      ]);
      this.finishTurn(id,turn,error,{cancelled:true});
    } catch(e) {
      // An unresponsive runtime must stop before a new command can reuse it.
      if(this.turns.get(id)!==turn)return;
      this.child?.kill();this.shutdown(e);
    } finally {clearTimeout(timer);}
  }
  async list(cursor = null) {
    await this.start();
    const r = await this.rpc("thread/list", {
      limit: 80,
      cursor,
      sortKey: "updated_at",
      modelProviders: [],
    });
    return {
      sessions: r.data.map((t) => ({
        provider: "codex",
        localId: t.id,
        title: (t.name || t.preview || "Codex 会话").slice(0, 160),
        cwd: t.cwd,
        updated: t.updatedAt * 1000,
        busy: t.status?.type === "active",
      })),
      cursor: r.nextCursor,
    };
  }
  async metadata(id) {
    await this.start();
    return (
      await this.rpc("thread/read", { threadId: id, includeTurns: false })
    ).thread;
  }
  async historyPage(id, cursor = null) {
    await this.start();
    const page = await this.rpc("thread/items/list", {threadId: id, cursor, limit: 20, sortDirection: "desc"});
    return {items: page.data.map(e => normalizeCodexItem(e.item || e, e)).filter(Boolean)
      .reverse().map(({raw, ...item}) => item), cursor: page.nextCursor || null};
  }
  async history(id) {
    await this.start();
    let cursor = null,
      result = [];
    do {
      const r = await this.rpc("thread/items/list", {
        threadId: id,
        cursor,
        limit: 100,
        sortDirection: "asc",
      });
      result.push(...r.data.map((e) => normalizeCodexItem(e.item || e, e)));
      cursor = r.nextCursor;
    } while (cursor);
    return result.filter(Boolean);
  }
  async models() {
    await this.start();const result=await this.rpc('model/list',{limit:100});
    const models=result.data.filter(m=>!m.hidden).map(m=>{
      const fastTier=Array.isArray(m.serviceTiers)?m.serviceTiers.find(t=>['priority','fast'].includes(t.id))?.id:m.additionalSpeedTiers?.includes('fast')?'fast':undefined;
      return {id:m.model||m.id,name:m.displayName||m.model,...(m.description?{description:m.description.slice(0,1000)}:{}),default:!!m.isDefault,efforts:(m.supportedReasoningEfforts||[]).map(e=>e.reasoningEffort),...(m.defaultReasoningEffort?{defaultEffort:m.defaultReasoningEffort}:{}),...(fastTier?{fastTier}:{})};
    });
    this.modelCatalog=models;return models;
  }
  async create(cwd, {access='workspace',mode='code'}={}) {
    await this.start();
    const id=(await this.rpc('thread/start',{cwd,approvalPolicy:access==='full'?'never':'on-request',sandbox:mode==='plan'?'read-only':access==='full'?'danger-full-access':'workspace-write'})).thread.id;
    this.fresh.add(id);return id;
  }
  async fork(id,cwd) {
    await this.start();
    if(this.turns.has(id))throw Error('请先结束当前任务 / Finish the active task first');
    return (await this.rpc('thread/fork',{threadId:id,cwd,excludeTurns:true})).thread.id;
  }
  async run(id, prompt, emit, {images=[],approvalScope,access='workspace',mode='code',model,effort,serviceTier,commandId,projectId}={}) {
    await this.start();
    if(serviceTier&&serviceTier!=='default'){
      const selected=(this.modelCatalog||await this.models()).find(m=>m.id===model);
      if(!selected?.fastTier||!['fast','priority'].includes(serviceTier))throw Error('此模型当前不支持极速，请关闭后重试 / Fast mode is unavailable for this model; turn it off and retry');
      serviceTier=selected.fastTier;
    }
    const approvalPolicy=access==='full'?'never':'on-request';
    const fresh=this.fresh.delete(id);
    if(!fresh){this.usageBaselines?.delete(id);await this.rpc('thread/resume',{threadId:id,approvalPolicy,sandbox:mode==='plan'?'read-only':access==='full'?'danger-full-access':'workspace-write',excludeTurns:true});}
    return new Promise((resolve,reject)=>{
      const controller=new AbortController();const turn={resolve,reject,emit,approvalScope,commandId,projectId,controller,accounting:new CodexUsage({baseline:this.usageBaselines?.get(id),fresh,model})};this.turns.set(id,turn);
      turn.started=this.rpc('turn/start',{
        additionalContext:{'wanwu-question-ui':{kind:'application',value:questionGuidance}},
        threadId:id,input:[{type:'text',text:mode==='plan'?'Plan and explain only. Do not modify files or execute changes.\n\n'+prompt:prompt,text_elements:[]},...images.map(p=>({type:'localImage',path:p}))],
        ...(commandId?{clientUserMessageId:commandId}:{}),...(model?{model}:{}),...(effort?{effort}:{}),...(serviceTier?{serviceTier:serviceTier==='default'?null:serviceTier}:{}),approvalPolicy,
        sandboxPolicy:mode==='plan'?{type:'readOnly'}:access==='full'?{type:'dangerFullAccess'}:{type:'workspaceWrite',writableRoots:[],networkAccess:true,excludeTmpdirEnvVar:false,excludeSlashTmp:false},
      }).then(r=>{turn.turnId=r.turn.id;return r.turn.id;}).catch(e=>{this.finishTurn(id,turn,e);return null;});
    });
  }
  async steer(id,prompt,{images=[],commandId}={}) {
    const turn=this.turns.get(id);if(!turn)throw Error('会话已结束');
    const turnId=turn.turnId||await turn.started;if(!turnId||this.turns.get(id)!==turn)throw Error('会话已结束');
    await this.rpc('turn/steer',{threadId:id,expectedTurnId:turnId,...(commandId?{clientUserMessageId:commandId}:{}),input:[{type:'text',text:prompt,text_elements:[]},...images.map(p=>({type:'localImage',path:p}))]});
  }
  async cancel(id) {
    const turn=this.turns.get(id);if(turn)await this.interruptTurn(id,turn);
  }
  close() {
    this.child?.kill();this.shutdown(Error('Codex runtime closed'));
  }
}
export class ClaudeAdapter {
  constructor(executable, ask) {
    this.executable = executable;
    this.ask = ask;
    this.running = new Map();
    this.dirs = new Map();
  }
  async sdk() {
    return import("@anthropic-ai/claude-agent-sdk");
  }
  async list(offset = 0) {
    const { listSessions } = await this.sdk();
    const rows = await listSessions({ limit: 80, offset: Number(offset) || 0 });
    rows.forEach((s) => this.dirs.set(s.sessionId, s.cwd));
    return {
      sessions: rows.map((s) => ({
        provider: "claude",
        localId: s.sessionId,
        title: (
          s.customTitle ||
          s.summary ||
          s.firstPrompt ||
          "Claude 会话"
        ).slice(0, 160),
        cwd: s.cwd,
        updated: s.lastModified,
      })),
      cursor: rows.length === 80 ? String((Number(offset) || 0) + 80) : null,
    };
  }
  async metadata(id) {
    const { getSessionInfo } = await this.sdk();
    const s = await getSessionInfo(id);
    if (!s) throw Error("本地 Claude 会话不存在");
    this.dirs.set(id, s.cwd);
    return s;
  }
  async historyPage(id, cursor = null) {
    const {getSessionMessages} = await this.sdk();
    const rows = await getSessionMessages(id, {dir: this.dirs.get(id), includeSystemMessages: true});
    // Stable UUID boundary avoids offset drift when the original session grows.
    const end = cursor ? rows.findIndex(row => (row.uuid || row.message?.id) === cursor) : rows.length;
    if (end < 0) throw Error("历史位置已变化，请重新打开会话");
    const start = Math.max(0, end - 20);
    const items = rows.slice(start, end).flatMap(normalizeClaudeItems).map(({raw, ...item}) => item);
    return {items, cursor: start > 0 ? (rows[start].uuid || rows[start].message?.id) : null};
  }
  async history(id) {
    const { getSessionMessages } = await this.sdk();
    return (await getSessionMessages(id, { includeSystemMessages: true })).flatMap(normalizeClaudeItems);
  }
  async create(cwd) {
    const id = randomUUID();
    this.dirs.set(id, cwd);
    return id;
  }
  async fork(id,cwd,title) {
    if(this.running.has(id))throw Error('请先结束当前任务 / Finish the active task first');
    const {forkSession}=await this.sdk();
    const result=await forkSession(id,{dir:cwd,title});
    this.dirs.set(result.sessionId,cwd);return result.sessionId;
  }
  async models(cwd) {
    const {query}=await this.sdk();const controller=new AbortController();
    const input=(async function*(){await new Promise(resolve=>controller.signal.addEventListener('abort',resolve,{once:true}));})();
    const q=query({prompt:input,options:{cwd:cwd||homedir(),pathToClaudeCodeExecutable:this.executable,env:{...process.env,PATH:runtimePath()},abortController:controller,settingSources:['user','project','local'],persistSession:false}});
    const timer=setTimeout(()=>controller.abort(),15000);
    try{return (await q.supportedModels()).map(m=>({id:m.value,name:m.displayName,...(m.description?{description:m.description.slice(0,1000)}:{}),efforts:m.supportedEffortLevels||[]}));}
    finally{clearTimeout(timer);controller.abort();q.close();}
  }
  userMessage(id,prompt,images=[],uuid=randomUUID()){
    return {type:'user',uuid,message:{role:'user',content:[{type:'text',text:prompt},...images.map(p=>({type:'image',source:{type:'base64',media_type:({'.png':'image/png','.webp':'image/webp','.gif':'image/gif'})[path.extname(p).toLowerCase()]||'image/jpeg',data:readFileSync(p).toString('base64')}}))]},parent_tool_use_id:null,session_id:id};
  }
  async run(id,prompt,emit,{fresh=false,images=[],approvalScope,access='workspace',mode='code',model,effort,commandId,projectId}={}){
    const {query}=await this.sdk(),controller=new AbortController(),cwd=this.dirs.get(id)||homedir();
    const initial=this.userMessage(id,prompt,images,commandId);const pending=[initial];let wake,closed=false;
    const inbox={push(value){pending.push(value);wake?.();},close(){closed=true;wake?.();},async *[Symbol.asyncIterator](){while(!closed){if(pending.length)yield pending.shift();else await new Promise(resolve=>{wake=resolve;});}}};
    const permissionMode=mode==='plan'?'plan':access==='full'?'bypassPermissions':'default';
    const q=query({prompt:inbox,options:{cwd,pathToClaudeCodeExecutable:this.executable,env:{...process.env,PATH:runtimePath()},...(fresh?{sessionId:id}:{resume:id}),includePartialMessages:true,settingSources:['user','project','local'],systemPrompt:{type:'preset',preset:'claude_code',append:questionGuidance},permissionMode,allowDangerouslySkipPermissions:access==='full',...(model?{model}:{}),...(effort?{effort}:{}),abortController:controller,
      canUseTool:async(toolName,input,options)=>{
        const context={provider:'claude',requestId:randomUUID(),approvalScope,commandId,projectId,signal:options?.signal?AbortSignal.any([controller.signal,options.signal]):controller.signal};
        if(toolName==='AskUserQuestion'){
          const answer=await askRuntimeQuestion(this.ask,{...context,kind:'question',title:'Claude 需要你的回答',detail:JSON.stringify(input.questions,null,2),questions:input.questions||[]},emit);
          return answer!==false?{behavior:'allow',updatedInput:{...input,answers:Object.fromEntries((input.questions||[]).map((q,i)=>[q.question,runtimeAnswerValues(answer,q,i).join(', ')]))}}:{behavior:'deny',message:'用户取消回答'};
        }
        const allow=await this.ask({...context,kind:toolName==='ExitPlanMode'?'confirmation':'permission',title:'Claude 请求操作权限',detail:toolName+'\n'+JSON.stringify(input,null,2)});
        return allow===true?{behavior:'allow',updatedInput:input}:{behavior:'deny',message:'用户拒绝此次操作'};
      }}});
    const running={q,controller,inbox,steers:0,pendingInputs:new Set([initial.uuid])};this.running.set(id,running);const stream=new ClaudeStream(),accounting=new ClaudeUsage(model);
    try{for await(const m of q){
      if(m.type==='stream_event'||m.type==='assistant'||m.type==='user')stream.accept(m).forEach(emit);
      else if(m.type==='result'){
        emit({kind:'usage',usage:m.usage,cost:m.total_cost_usd,accounting:accounting.accept(m)});
        const consumed=m.user_message_uuids||(m.user_message_uuid?[m.user_message_uuid]:[]);
        if(!controller.signal.aborted){
          if(consumed.length){for(const uuid of consumed)running.pendingInputs.delete(uuid);if(running.pendingInputs.size)continue;running.steers=0;}
          else if(running.steers>0){running.steers--;continue;}
        }
        if(m.is_error&&!controller.signal.aborted)throw Error(m.errors?.join('\n')||m.result||'Claude 执行失败');
        break;
      }
    }return {cancelled:controller.signal.aborted};}
    catch(e){if(controller.signal.aborted)return {cancelled:true};throw e;}
    finally{inbox.close();controller.abort();q.close?.();this.running.delete(id);}
  }
  async steer(id,prompt,{images=[],commandId}={}){
    const r=this.running.get(id);if(!r)throw Error('会话已结束');
    const message=this.userMessage(id,prompt,images,commandId);r.pendingInputs.add(message.uuid);r.steers++;
    try{await r.q.interrupt();if(this.running.get(id)!==r)throw Error('会话已结束');r.inbox.push({...message,priority:'now'});}
    catch(e){r.pendingInputs.delete(message.uuid);r.steers=Math.max(0,r.steers-1);throw e;}
  }
  async cancel(id) {
    const r = this.running.get(id);
    if (r) {
      try {
        await r.q.interrupt();
      } catch {}
      r.controller.abort();
    }
  }
  close() {
    for (const r of this.running.values()) r.controller.abort();
  }
}
export function safeWorkspace(root, file) {
  const target = path.resolve(root, file);
  if (!target.startsWith(path.resolve(root) + path.sep))
    throw Error("文件超出生成目录");
  if (!realpathSync(target).startsWith(realpathSync(root) + path.sep))
    throw Error("不允许外部符号链接");
  if (statSync(target).size > 16 * 1024 * 1024) throw Error("生成文件过大");
  return target;
}
