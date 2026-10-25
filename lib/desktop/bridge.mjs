import {PROVIDERS} from '../shared/providers.mjs';
import {sessionNameFields} from '../shared/session-mentions.mjs';
import {DshAdapter} from './dsh-adapter.mjs';
import {ConversationPrivacy} from '../shared/conversation-privacy.mjs';
import {NativeChatEncryption} from './chat-encryption.mjs';
import {requestsImageChatDelivery,generatedImageEvent} from '../shared/image-chat-delivery.mjs';
import {groupChatState} from './group-chat.mjs';
import {DeviceScheduler} from './device-scheduler.mjs';
import {LocalOutputs} from './local-outputs.mjs';
import {SkillUpdateBarrier} from './skills/update-barrier.mjs';
import {SkillExchange} from './skills/exchange.mjs';
import {DeviceWorkbench,prepareCommand,authorizeDispatchedCommand} from './workbench.mjs';
import {compactDshOutbox} from './dsh-stream-relay.mjs';
import {compactRuntimeOutbox} from './runtime-stream-outbox.mjs';
import {RuntimeApprovals,applyRuntimeAccess} from './approvals.mjs';
import {ApprovalRelay} from './approval-relay.mjs';
import { WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { hostname, platform } from "node:os";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import path from "node:path";
import {
  detectRuntimes,
  installSkills,
  CodexAdapter,
  ClaudeAdapter,
  safeWorkspace,
} from "./runtimes.mjs";
import {AnnouncementDrafts} from './announcements.mjs';
import {DesktopSkills} from './skills/service.mjs';
export class RuntimeBridge {
  constructor({
    request,
    store,
    save,
    notify,
    skillsRoot,
    dataDir,
    publicDir,
    documentsPath,
    runtimeDirectory,
    writeRemoteClipboard,
    createRemotePeer,
  }) {
    Object.assign(this, {
      request,
      store,
      save,
      notify,
      skillsRoot,
      dataDir,
      publicDir,
      documentsPath,
    runtimeDirectory,
      writeRemoteClipboard,
    });
    this.adapters = {};
    this.chatEncryption=new NativeChatEncryption(this);
    this.workbench=new DeviceWorkbench(this);
    this.scheduler=new DeviceScheduler(this);
    this.busy = new Map();
    this.resetApprovals();
    // Legacy imports may have left a large transcript upload queue. Never resume it.
    this.outbox = (store.outbox || []).filter(e => !e.id?.startsWith('history-'));
    this.catalog = new Map();
    this.mappings = store.mappings || {};
    this.localOutputs = new LocalOutputs(this);
    this.stopped = false;
    this.generationJobs = new Map();
    this.skills = new DesktopSkills(this,{detect:()=>detectRuntimes().filter(r=>this.store.device?.runtimes?.includes(r.provider))});
    this.announcements = new AnnouncementDrafts(this);
    this.skillUpdates=new SkillUpdateBarrier(this);
    this.skillExchange=new SkillExchange(this);
  }
  adapter(provider) {
    if (!PROVIDERS.includes(provider))
      throw Error("不支持这个 Runtime");
    if (!this.adapters[provider]) {
      const runtime = detectRuntimes().find((r) => r.provider === provider);
      if (!runtime.available)
        throw Error(`没有找到 ${provider}，请先安装并登录`);
      const ask = (details) => this.approvals.request({...details,sessionId:Object.entries(this.mappings).find(([,m])=>m===this.busy.get(details.commandId))?.[0]});
      this.adapters[provider] = provider==='dsh' ? new DshAdapter(runtime.path,ask,{provider})
        : provider === "codex"
          ? new CodexAdapter(runtime.path, ask)
          : new ClaudeAdapter(runtime.path, ask);
      applyRuntimeAccess(this.adapters[provider], () => this.approvals, provider);
    }
    return this.adapters[provider];
  }
  persist() {
    this.store.outbox = this.outbox;
    this.store.mappings = this.mappings;
    delete this.store.seen;
    this.save();
  }
  resetApprovals() {
    const approvals = new RuntimeApprovals({store:this.store,save:this.save,notify:e=>{this.notify(e);relay.event(e);}});
    const relay = new ApprovalRelay(this,approvals);
    approvals.onAutomaticAnswer=id=>void relay.answer({id,answer:true}).catch(()=>{});
    this.approvals=approvals;this.approvalRelay=relay;
  }
  approve(data) {
    return this.approvalRelay.answer(data);
  }
  async bind(providers, recoverDeviceId) {
    if(this.busy.size||this.generationJobs.size||this.skills.jobs.size)throw Error("请先结束当前设备任务，再更新绑定");
    if (
      !Array.isArray(providers) ||
      !providers.length ||
      providers.some((p) => !PROVIDERS.includes(p))
    )
      throw Error("请选择 Runtime");
    for (const p of providers) {
      this.adapter(p);
      installSkills(this.skillsRoot, p, (detail) =>
        this.notify({ type: "skill-progress", provider: p, ...detail }),
      );
    }
    this.store.installation ||= randomUUID();
    if(recoverDeviceId&&recoverDeviceId!==this.store.device?.id&&this.outbox.length)throw Error("还有未同步的任务消息，请同步完成后再恢复其他设备绑定");
    if(this.pumping||this.flushing||this.workbench.running||this.scheduler.running)throw Error("设备正在同步，请稍后重试绑定");
    this.stop();this.ws=null;this.adapters={};
    this.resetApprovals();
    let result;
    try{result = await this.request("/api/devices/bind", "POST", {
      installation: this.store.installation,
      machineKey:this.store.machineKey,
      installations:this.store.installationCandidates,
      ...this.recoveryEvidence,
      ...(recoverDeviceId?{recoverDeviceId}:{}),
      name: this.store.deviceName || hostname(),
      platform: platform(),
      runtimes: providers,
    });}catch(error){await this.start().catch(()=>{});throw error;}
    // Reconnect with the new credential, even when refreshing the same device.
    this.store.installation=result.installation||this.store.installation;
    this.store.device = result.device;
    this.store.deviceToken = result.deviceToken;
    this.save();
    this.resetApprovals();
    await this.start();
    return result.device;
  }
  async list({ provider, cursor }) {
    const page = await this.adapter(provider).list(cursor);
    for (const session of page.sessions) this.catalog.set(`${provider}:${session.localId}`, session);
    return page;
  }
  async restoreDevice(deviceId) {
    if(this.busy.size||this.generationJobs.size||this.skills.jobs.size||this.outbox.length)throw Error('请先完成当前设备任务和消息同步 / Finish current tasks and sync first');
    this.stop();this.ws=null;this.adapters={};
    this.resetApprovals();
    try{
      const result=await this.request('/api/devices/recover','POST',{deviceId,machineKey:this.store.machineKey});
      this.store.installation=result.installation;this.store.device=result.device;this.store.deviceToken=result.deviceToken;
      this.save();this.resetApprovals();this.notify({type:'device-binding',device:result.device});await this.start();return result.device;
    }catch(error){await this.start().catch(()=>{});throw error;}
  }
  async importSession(data) {
    return (await this.importSessions({projectId: data.projectId, sessions: [data]}))[0];
  }
  async importSessions({projectId, sessions}) {
    if (!this.store.device) throw Error("请先绑定当前设备");
    if (!Array.isArray(sessions) || !sessions.length || sessions.length > 500)
      throw Error("请选择 1–500 条会话");
    // The picker already read this metadata. Import must not start or read a Runtime.
    const selected = sessions.map(s => {
      const local = this.catalog.get(`${s.provider}:${s.localId}`);
      if (!local) throw Error("请刷新本机会话列表后重试");
      return local;
    });
    const imported = await this.request("/api/sessions/import", "POST", {
      projectId, deviceId: this.store.device.id,
      sessions: selected.map(({provider, localId, title}) => ({provider, localId, title})),
    });
    for (const s of imported) {
      const local = this.catalog.get(`${s.provider}:${s.localId}`);
      this.mappings[s.id] = {...this.mappings[s.id], provider: s.provider,
        localId: s.localId, cwd: local.cwd, imported: true};
    }
    this.persist();
    this.workbench.metadataSent=false;
    return imported;
  }
  async resolveMapping(sessionId,provider,localId){
    const existing=this.mappings[sessionId];
    if(existing&&existing.provider===provider&&existing.localId===localId)return existing;
    // Rebuild a lost local link only from an actual local Runtime session.
    let cwd,fresh=false;
    if(localId.startsWith('pending-')){
      const sessions=await this.request('/api/bridge/sessions','GET',undefined,true);
      const s=sessions.find(s=>s.id===sessionId&&s.provider===provider&&s.localId===localId);
      cwd=s?.cwd;fresh=true;
    }else cwd=(await this.adapter(provider).metadata(localId))?.cwd;
    if(!cwd||!path.isAbsolute(cwd)||!existsSync(cwd))throw Error('请在原电脑重新导入此会话，未找到本地工作目录');
    const mapping={provider,localId,cwd,imported:true,...(fresh?{fresh:true}:{})};
    this.mappings[sessionId]=mapping;this.persist();this.workbench.metadataSent=false;return mapping;
  }
  privacyFor(sessionId) {
    this.conversationPrivacy ||= new Map();
    if(!this.conversationPrivacy.has(sessionId))this.conversationPrivacy.set(sessionId,new ConversationPrivacy());
    return this.conversationPrivacy.get(sessionId);
  }
  async readHistoryPage({sessionId,provider,localId,cursor}) {
    const m = await this.resolveMapping(sessionId,provider,localId);
    if (!m || m.provider !== provider || m.localId !== localId)
      throw Error("请先在原电脑确认导入这条会话");
    const adapter = this.adapter(provider);
    if (provider === 'claude') adapter.dirs.set(localId, m.cwd);
    const page = m.fresh ? {items: [], cursor: null} : await adapter.historyPage(localId, cursor);
    this.localOutputs.record(sessionId,page.items);
    return this.privacyFor(sessionId).page(page);
  }
  async readHistoryRequest(request) {
    let reply;
    try {
      const sessions=await this.request('/api/bridge/sessions','GET',undefined,true),descriptor=sessions.find(s=>s.id===request.sessionId);
      if(descriptor?.encryptedChat){const m=await this.resolveMapping(request.sessionId,request.provider,request.localId);m.encryptedChat=true;m.groupChat={...m.groupChat,projectId:descriptor.projectId};this.persist();}
      reply = await this.readHistoryPage(request);
      // Metadata only. A separate explicit click requests the file upload.
      if(request.projectId&&!this.mappings[request.sessionId]?.encryptedChat)try{reply.outputs=(await this.localOutputs.list({projectId:request.projectId,sessionId:request.sessionId,hydrate:false})).filter(f=>f.size<=500*1024*1024).map(({path,...file})=>file);}catch{/* File discovery must never prevent reading the conversation. */}
    } catch (error) { reply = {error: error.message.slice(0, 1000)}; }
    if(!reply.error)reply=await this.chatEncryption.history(request,reply);
    await this.request(`/api/bridge/history/${request.requestId}`, 'POST', reply, true);
  }
  async createSession({ projectId, provider, cwd, title }) {
    if (!this.store.device) throw Error("请先绑定当前设备");
    if (!cwd || !existsSync(cwd)) throw Error("请选择存在的工作目录");
    const naming=sessionNameFields(title);
    this.adapter(provider);
    const localId =
      provider === "codex"
        ? "pending-" + randomUUID()
        : await this.adapter(provider).create(cwd);
    const s = await this.request("/api/sessions/import", "POST", {
      projectId,
      deviceId: this.store.device.id,
      provider,
      localId,
      title: naming.summary || "新的会话",
      ...(naming.mentionAlias?{mentionAlias:naming.mentionAlias}:{}),
      cwd,
    });
    this.mappings[s.id] = {
      provider,
      localId,
      cwd,
      fresh: true,
      imported: true,
    };
    this.persist();
    return s;
  }
  transportEvents(sessionId,payload,id) {
    const encoded=JSON.stringify(payload);
    if(Buffer.byteLength(encoded)<800000) return [{sessionId,id,payload}];
    const chunks=[];for(let i=0;i<encoded.length;i+=180000) chunks.push(encoded.slice(i,i+180000));
    return chunks.map((data,index)=>({sessionId,id:id+"-"+index,payload:{kind:"fragment",group:id,index,total:chunks.length,data}}));
  }
  enqueue(sessionId, payload) {
    if (!payload) return;
    if(payload.kind==='usage'&&payload.accounting&&payload.commandId){
      this.outbox.push({sessionId,id:randomUUID(),usage:true,payload:{commandId:payload.commandId,...payload.accounting}});
    }
    this.localOutputs.record(sessionId,[payload]);
    let display=this.privacyFor(sessionId).event(payload);
    if(!display)return;
    this.outbox=compactDshOutbox(this.outbox,sessionId,display,this.uploadingEventIds);
    ({outbox:this.outbox,payload:display}=compactRuntimeOutbox(this.outbox,sessionId,display,this.uploadingEventIds));
    this.outbox.push(...this.transportEvents(sessionId,display,randomUUID()));
    this.persist();
    this.flush().catch(() => {});
  }
  async flush() {
    // Completion must join the active upload, not overtake its final tool/reply.
    if (this.flushing) return this.flushing;
    if (!this.store.deviceToken || !this.outbox.length) return;
    const upload = (async () => {
      while (this.outbox.length) {
        const {sessionId,usage} = this.outbox[0];
        const batch = this.outbox
          .filter((e) => e.sessionId === sessionId && !!e.usage === !!usage)
          .slice(0, 5);
        this.uploadingEventIds=new Set(batch.map(e=>e.id));
        try {
          for(const entry of batch)entry.attempted=true;
          this.persist();
          await this.request(
            usage?"/api/bridge/usage":"/api/bridge/events",
            "POST",
            {
              sessionId,
              events: usage?batch.map(({payload})=>payload):await Promise.all(batch.map(async ({id,payload})=>({id,payload:await this.chatEncryption.event(sessionId,id,payload)}))),
            },
            true,
          );
        } catch (e) {
          if (e.status === 403 || e.status === 404) {
            const ids = new Set(batch.map((e) => e.id));
            this.outbox = this.outbox.filter((e) => !ids.has(e.id));
            this.persist();
            continue;
          }
          throw e;
        } finally {
          this.uploadingEventIds.clear();
        }
        const ids = new Set(batch.map((e) => e.id));
        this.outbox = this.outbox.filter((e) => !ids.has(e.id));
        this.persist();
      }
    })();
    this.flushing = upload;
    try { await upload; }
    finally { if (this.flushing === upload) this.flushing = null; }
  }
  async start() {
    if(this.approvals.closed||!this.approvalRelay.current())this.resetApprovals();
    if(this.skillUpdates.closed)this.skillUpdates=new SkillUpdateBarrier(this);
    if(this.skillExchange.closed)this.skillExchange=new SkillExchange(this);
    this.skills.closed=false;
    this.stopped=false;
    // Install the retry loop before network I/O; a failed first request must not
    // leave a logged-in desktop permanently disconnected.
    if(!this.interval){
      this.interval=setInterval(()=>{
        if(!this.started){void this.resume().catch(()=>{});return;}
        if(!this.ws||this.ws.readyState>=2)void this.connect();
        this.approvalRelay.sync().catch(()=>{});
        this.reportGroupChat();
        void this.chatEncryption.sync().catch(()=>{});
        this.skillUpdates.tick().catch(()=>{});
        this.skillExchange.pump().catch(()=>{});
        this.pump().catch(()=>{});
        this.workbench.pump().catch(()=>{});
        this.scheduler.tick().catch(()=>{});
        this.flush().catch(()=>{});
        this.observe().catch(()=>{});
      },5000);
      this.interval.unref();
    }
    return this.resume();
  }
  async resume() {
    if(this.stopped)return;
    if(this.starting)return this.starting;
    const generation=this.connectionGeneration||0;
    const current=()=>!this.stopped&&(this.connectionGeneration||0)===generation;
    const job=(async()=>{
      await this.recoverBinding?.();
      if(!current()||!this.store.deviceToken)return;
      if(!this.approvalRelay.current()){this.approvals.close();this.resetApprovals();}
      if(!this.started){
        try{await this.request('/api/bridge/recover','POST',{},true);}
        catch(error){
          if(error.status!==401||!this.recoverBinding||!current())throw error;
          await this.recoverBinding(true);
          if(!current()||!this.store.deviceToken)return;
          await this.request('/api/bridge/recover','POST',{},true);
        }
        if(!current())return;
        this.started=true;
      }
      await this.skillExchange.start?.();
      if(!current())return;
      await this.connect();
    })().catch(error=>{
      if(current())this.notify({type:'bridge-status',online:false,error:error.message});
      throw error;
    }).finally(()=>{if(this.starting===job)this.starting=null;});
    this.starting=job;return job;
  }
  retryConnection(delay) {
    clearTimeout(this.reconnect);
    if(!this.stopped)this.reconnect=setTimeout(()=>void this.resume().catch(()=>{}),delay);
    this.reconnect?.unref();
  }
  async connect() {
    if(this.stopped||this.ws?.readyState===0||this.ws?.readyState===1)return;
    if(this.connecting)return this.connecting;
    const generation=this.connectionGeneration||0;
    const current=()=>!this.stopped&&(this.connectionGeneration||0)===generation;
    const job=(async()=>{
      try {
        const {ticket}=await this.request('/api/ws-ticket','POST',{},true);
        if(!current())return;
        const url=new URL(this.store.endpoint);
        url.protocol=url.protocol==='https:'?'wss:':'ws:';
        url.pathname='/events';url.search='ticket='+encodeURIComponent(ticket);
        const socket=this.ws=new WebSocket(url,{handshakeTimeout:15000});
        socket.on('open',()=>{
          if(!current()||this.ws!==socket){socket.close();return;}
          clearTimeout(this.reconnect);
          socket.send(JSON.stringify({type:'bridge-ready',capabilities:['session-outputs-v1','session-history','workbench-v1','task-dispatch-v1','file-access-v1','skills-sync-v1','skills-exchange-v1','device-schedules-v1','folder-attachments-v1','folder-attachments-v2','group-chat-v1','session-mentions-v1','encrypted-chat-v1','queue-edit-v1']}));
          this.approvalRelay.sync().catch(()=>{});
        this.reportGroupChat();
          this.notify({type:'bridge-status',online:true});
          this.skillUpdates.invalidate();
          this.skillExchange.pump().catch(()=>{});
          this.pump().catch(()=>{});
          this.workbench.defaultWorkspaces.invalidate();
          this.workbench.pump().catch(()=>{});
          this.scheduler.tick().catch(()=>{});
        });
        socket.on('message',async b=>{
          if(!current()||this.ws!==socket)return;
          try {
            const e=JSON.parse(b);
            if(e.type==='runtime-approvals-changed')void this.approvalRelay.sync().catch(()=>{});
            if(e.type==='skills-changed')this.skillUpdates.invalidate();
            if(e.type==='commands'){this.workbench.defaultWorkspaces.invalidate();void this.scheduler.tick().catch(()=>{});void this.skillExchange.pump().catch(()=>{});void this.workbench.pump().catch(()=>{});await this.pump();}
            if(e.type==='session-history')await this.readHistoryRequest(e);
            if(e.type==='session-output-upload')void this.localOutputs.uploadRequested(e).catch(()=>{});
            if(e.type==='cancel'){
              const task=this.busy.get(e.commandId);
              if(task){this.cancelledCommands ||= new Set();this.cancelledCommands.add(e.commandId);await this.adapter(task.provider).cancel(task.localId);}
            }
          }catch{}
        });
        socket.on('error',()=>{});
        socket.on('close',()=>{
          if(!current()||this.ws!==socket)return;
          this.notify({type:'bridge-status',online:false});this.retryConnection(4000);
        });
      }catch(error){
        if(!current())return;
        this.notify({type:'bridge-status',online:false,error:error.message});
        if(error.status===401&&this.recoverBinding){
          this.started=false;
          await this.recoverBinding(true).catch(()=>{});
        }
        if(current())this.retryConnection(5000);
      }
    })().finally(()=>{if(this.connecting===job)this.connecting=null;});
    this.connecting=job;return job;
  }
  reportGroupChat(){if(this.ws?.readyState===1)this.ws.send(JSON.stringify({type:'group-chat-state',...groupChatState(this)}));}
  async pump() {
    if (this.stopped) return;
    // Preserve wakeups received while a previous queue snapshot is in flight.
    if (this.pumping) { this.pumpRequested = true; return; }
    if(!this.skillUpdates.available){void this.skillUpdates.tick().catch(()=>{});return;}
    this.pumping = true;
    try {
      do {
        this.pumpRequested = false;
        const commands = await this.request(
          "/api/bridge/commands",
          "GET",
          undefined,
          true,
        );
        for (const c of commands) {
          const m = await this.resolveMapping(c.session_id,c.provider,c.local_id).catch(()=>null);
          const running=[...this.busy.entries()].find(([,t])=>t.provider===c.provider&&t.localId===c.local_id);
          if(running&&c.options?.delivery!=='steer')continue;
          let claimed;try{claimed=await this.request(`/api/bridge/commands/${c.id}/claim`,'POST',{revision:c.options?.queueRevision},true);}catch(error){if(error.status===409)continue;throw error;}
          if(claimed.taskDispatch)c.options={...c.options,taskDispatch:claimed.taskDispatch};
          if(claimed.steer){
            try{if(!running||!m)throw Error('Turn has finished');const prepared=await prepareCommand(this,c,m);await this.adapter(m.provider).steer(m.localId,prepared.prompt,prepared.options);await this.request(`/api/bridge/commands/${c.id}/steered`,'POST',{},true);}
            catch{await this.request(`/api/bridge/commands/${c.id}/steered`,'POST',{retry:true},true);}
            continue;
          }
          if (!m || m.localId !== c.local_id || m.provider !== c.provider) {
            await this.request(
              `/api/bridge/commands/${c.id}/finish`,
              "POST",
              {
                status: "failed",
                error: "此会话尚未在本机确认导入，请在本机重新导入",
              },
              true,
            );
            continue;
          }
          this.busy.set(c.id, m);this.reportGroupChat();
          this.execute(c, m).catch(() => {});
        }
      } while (this.pumpRequested && !this.stopped && this.skillUpdates.available);
    } finally {
      this.pumping = false;
    }
  }
  async execute(c, m) {
    let result = { status: "done" };
    const encrypted=!!(m.encryptedChat||c.options?.groupChat?.encryptedMessage||c.options?.taskDispatch?.secureTask||c.options?.secureCommand),finals=new Map();
    try {
      authorizeDispatchedCommand(this,c,m);
      if (
        m.provider === "codex" &&
        m.fresh &&
        !this.adapter("codex").fresh.has(m.localId)
      ) {
        const localId = await this.adapter("codex").create(m.cwd,c.options);
        await this.request(
          `/api/bridge/sessions/${c.session_id}/local-id`,
          "POST",
          { localId },
          true,
        );
        m.localId = localId;
        this.persist();
      }
      if (m.provider === "claude")
        this.adapter(m.provider).dirs.set(m.localId, m.cwd);
      const prepared=await prepareCommand(this,c,m);
      if(this.cancelledCommands?.has(c.id))throw Object.assign(Error('任务已停止 / Task stopped'),{code:'WANWU_CANCELLED'});
      const run = await this.adapter(m.provider).run(
        m.localId,
        prepared.prompt,
        (p) => {
          if(!p)return;
          if(encrypted&&p.role==='assistant'&&p.id&&['message','delta'].includes(p.kind)){const previous=finals.get(p.id);finals.set(p.id,{phase:p.phase||previous?.phase,text:p.kind==='delta'?(previous?.text||'')+(p.text||''):(p.text||'')});}
          this.enqueue(c.session_id, {...p, commandId:p.commandId||c.id});
          if(!encrypted&&(c.options?.groupChat||requestsImageChatDelivery(c.prompt))&&(generatedImageEvent(p)||p.activity==='connection'))void this.catalogOutputs(c);
        },
        prepared.options,
      );
      m.fresh = false;
      result.status = run?.cancelled ? "cancelled" : "done";
      if(encrypted&&!run?.cancelled&&(c.options?.groupChat||c.options?.taskDispatch?.returnToChat)){const rows=[...finals.values()].filter(m=>m.text&&m.phase!=='commentary'),answer=(rows.filter(m=>m.phase==='final_answer').at(-1)||rows.at(-1))?.text||'任务已结束 / Task finished';this.store.encryptedChatFinals||={};this.store.encryptedChatFinals[c.id]={c,text:answer};this.save();await this.chatEncryption.final(c,answer);delete this.store.encryptedChatFinals[c.id];this.save();}

    } catch (e) {
      try {
        await this.adapter(m.provider).metadata(m.localId);
        m.fresh = false;
      } catch {}
      result = { status: e.code==='WANWU_CANCELLED'?"cancelled":"failed", error: encrypted?'加密群聊任务未完成，请在原电脑检查 / Encrypted chat task failed; check the source device':e.message.slice(0, 2000) };
    } finally {
      this.skillExchange.release(c.id);
      this.busy.delete(c.id);this.reportGroupChat();
      this.cancelledCommands?.delete(c.id);
      this.persist();
      try {
        // Catalog the current run's outputs even if nobody opened its transcript.
        // Contents stay local until the group-chat recovery path requests them.
        if(!encrypted&&(c.options?.groupChat||requestsImageChatDelivery(c.prompt)))try{result.outputs=(await this.localOutputs.list({projectId:c.project_id,sessionId:c.session_id,hydrate:false})).filter(f=>f.size<=500*1024*1024).slice(-200).map(({path,...file})=>file);}catch{}
        if(this.store.encryptedChatFinals?.[c.id])throw Error('Encrypted final reply is waiting to sync');
        await this.flush();
        if (this.outbox.length) throw Error('Task messages are still waiting to sync');
        await this.request(
          `/api/bridge/commands/${c.id}/finish`,
          "POST",
          result,
          true,
        );
      } catch {
        this.store.pendingFinish ||= {};
        this.store.pendingFinish[c.id] = result;
        this.save();
      }
      if(!encrypted)void this.syncSessionTitle(c.session_id,m);
      this.pump().catch(() => {});
    }
  }
  async catalogOutputs(c) {
    this.outputCatalogs ||= new Map();
    if(this.outputCatalogs.has(c.id)){this.outputCatalogs.get(c.id).again=true;return;}
    const state={again:false};this.outputCatalogs.set(c.id,state);
    try {
      do {
        state.again=false;
        const files=(await this.localOutputs.list({projectId:c.project_id,sessionId:c.session_id,hydrate:false})).filter(f=>f.size<=500*1024*1024).slice(-200).map(({path,...file})=>file);
        await this.flush();
        if(files.length)await this.request(`/api/bridge/sessions/${c.session_id}/outputs`,'POST',{commandId:c.id,files},true);
      } while(state.again&&!this.stopped);
    } catch {/* Completion/reconnection retries the catalog without rerunning the model. */}
    finally {this.outputCatalogs.delete(c.id);}
  }
  async syncSessionTitle(sessionId,m) {
    if(!m.autoTitle||m.localId.startsWith('pending-'))return;
    try {
      const info=await this.adapter(m.provider).metadata(m.localId);
      // Only use Runtime titles, never the wrapped first prompt with sender metadata.
      const title=(m.provider==='codex'?info.name:info.customTitle||info.summary)?.trim().slice(0,160);
      if(title&&title!==m.syncedTitle){this.enqueue(sessionId,{kind:'session-title',title});m.syncedTitle=title;this.persist();}
    } catch { /* A missing title must not change the result of the user's task. */ }
  }
  async observe() {
    if (this.observing || this.stopped) return;
    this.observing = true;
    try {
      for (const [id, result] of Object.entries(
        this.store.pendingFinish || {},
      )) {
        try {
          // Retry the encrypted reply while its command is still authorized.
          const pending=this.store.encryptedChatFinals?.[id];if(pending){await this.chatEncryption.final(pending.c,pending.text);delete this.store.encryptedChatFinals[id];result.status='done';delete result.error;this.save();}
          // Retry the transcript first as well, including after a network failure.
          await this.flush();
          if (this.outbox.length) return;
          await this.request(
            `/api/bridge/commands/${id}/finish`,
            "POST",
            result,
            true,
          );
          delete this.store.pendingFinish[id];
          this.save();
        } catch (e) {
          if ([403,404,409].includes(e.status)) {
            delete this.store.encryptedChatFinals?.[id];
            delete this.store.pendingFinish[id];
            this.save();
          }
        }
      }
    } finally {
      this.observing = false;
    }
  }
  stop() {
    this.skillUpdates.stop();
    this.skillExchange.stop();
    this.skills.stop();
    this.announcements.stop();
    this.stopped = true;
    this.connectionGeneration=(this.connectionGeneration||0)+1;
    this.starting=null;this.connecting=null;
    clearInterval(this.interval);this.interval=null;
    clearTimeout(this.reconnect);
    const socket=this.ws;this.ws=null;socket?.close();
    for (const a of Object.values(this.adapters)) a.close();
    this.approvals.close();
    this.started = false;
  }
}
