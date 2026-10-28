export class SkillUpdateBarrier {
  constructor(bridge){this.bridge=bridge;this.state={status:'checking'};this.pending=true;this.verified=false;this.closed=false;}
  emit(state){this.state=state;this.bridge.notify({type:'device-skills',...state});}
  get busy(){const b=this.bridge;return !!this.leases||!!b.skillExchange?.activeNative||b.busy.size>0||b.pumping||b.generationJobs.size>0||b.skills.jobs.size>0||b.announcements.jobs.size>0||Object.keys(b.store.pendingFinish||{}).length>0;}
  get available(){return this.verified&&!this.pending&&!this.running&&!this.closed;}
  assertAvailable(){if(this.bridge.store.deviceToken&&!this.available)throw Error('项目技能正在更新，请稍后再开始 / Project skills are updating. Please wait.');}
  async localWork(action){this.assertAvailable();this.leases=(this.leases||0)+1;try{return await action();}finally{this.leases--;}}
  invalidate(){this.changeSequence=(this.changeSequence||0)+1;this.pending=true;this.retryAt=0;void this.tick().catch(()=>{});}
  stop(){this.closed=true;}
  async manual(action){
    if(this.manualJob)throw Error('已有技能更新正在进行，请稍后重试 / An update is already in progress');
    this.pending=true;this.manualJob=true;
    try{
      while(this.running||this.busy){if(this.closed)throw Error('技能同步已停止 / Skill sync stopped');this.emit({status:'draining'});await new Promise(r=>setTimeout(r,250));}
      const plan=await this.bridge.request('/api/bridge/skills-sync','GET',undefined,true);
      await this.bridge.request('/api/bridge/skills-sync','POST',{revision:plan.revision,status:'syncing'},true);
      this.emit({status:'syncing'});
      return await action();
    }finally{this.manualJob=false;this.retryAt=0;void this.tick().catch(()=>{});}
  }
  async tick(){
    const b=this.bridge;
    if(this.running||this.manualJob||this.closed||b.stopped||!b.store.deviceToken||Date.now()<(this.retryAt||0))return;
    this.running=true;
    const sequence=this.changeSequence||0;
    let plan;
    try{
      plan=await b.request('/api/bridge/skills-sync','GET',undefined,true);
      if(this.closed)return;
      if(!this.pending&&this.verified&&plan.revision===this.revision&&plan.state.status==='ready')return;
      this.pending=true;
      // Two projects sharing a global skill must agree on its content. Never
      // silently replace one project's version with another project's version.
      const versions=new Map();
      for(const p of plan.projects)for(const s of p.skills){
        const prior=versions.get(s.name);if(prior&&prior.sha256!==s.sha256){if(this.busy){this.emit({status:'draining'});return;}throw Error(`Project skill version conflict / 项目技能版本冲突：${s.name}（${prior.project} / ${p.name}）。请在项目 Skills 中选择一致版本后重试 / Select matching versions in project Skills and retry.`);}
        versions.set(s.name,{...s,project:p.name});
      }
      // Startup, project navigation and reconnects invalidate the check, not the
      // installed skills. Verify local content before showing an update barrier.
      if(await b.skills.verifyPlan?.(plan)){
        if(this.closed)return;
        if(plan.state.status!=='ready'){
          // Verification/receipts do not replace files or restart adapters.
          // A running sibling session must not block this read-only fast path.
          try{await b.request('/api/bridge/skills-sync','POST',{revision:plan.revision,status:'ready'},true);}
          catch(e){
            if(e.status!==409)throw e;
            // A newly joined project may reuse skills already installed for
            // another project but still need its own server-side receipts.
            const latest=await b.request('/api/bridge/skills-sync','GET',undefined,true);
            if(latest.revision!==plan.revision)throw e;
            await b.skills.recordPlan(plan);
            if(this.closed)return;
            await b.request('/api/bridge/skills-sync','POST',{revision:plan.revision,status:'ready'},true);
          }
        }
        if((this.changeSequence||0)!==sequence)return;
        this.revision=plan.revision;this.pending=false;this.verified=true;this.retryAt=0;
        this.emit({status:'ready'});return;
      }
      if(this.busy){this.emit({status:'draining'});return;}
      await b.request('/api/bridge/skills-sync','POST',{revision:plan.revision,status:'syncing'},true);
      this.emit({status:'syncing',completed:0,total:plan.projects.length});
      if(plan.projects.some(p=>p.skills.length)){
        for(const adapter of Object.values(b.adapters||{}))adapter.close();
        b.adapters={};
      }
      for(let i=0;i<plan.projects.length;i++){
        if(this.closed)throw Error('技能同步已停止 / Skill sync stopped');
        const p=plan.projects[i];
        if(!p.skills.length){this.emit({status:'syncing',completed:i+1,total:plan.projects.length});continue;}
        const result=await b.skills.syncAll({projectId:p.id,checkSources:false,barrier:true});
        if(plan.runtimes?.some(provider=>!result.runtimes.includes(provider)))throw Error('已绑定的 AI 终端不可用，请检查安装后重试 / A bound AI runtime is unavailable. Check its installation and retry.');
        if(result.errors.length)throw Error(result.errors.map(e=>`${e.name}: ${e.message}`).join('\n'));
        this.emit({status:'syncing',projectName:p.name,completed:i+1,total:plan.projects.length});
      }
      if(this.closed)return;
      await b.request('/api/bridge/skills-sync','POST',{revision:plan.revision,status:'ready'},true);
      if((this.changeSequence||0)!==sequence)return;
      this.revision=plan.revision;this.pending=false;this.verified=true;this.retryAt=0;
      this.emit({status:'ready'});
    }catch(e){
      if(this.closed)return;
      this.pending=true;
      if(e.status===409){this.retryAt=0;this.emit({status:'draining'});}
      else{
        this.retryAt=Date.now()+30000;this.emit({status:'error',error:e.message});
        if(plan)await b.request('/api/bridge/skills-sync','POST',{revision:plan.revision,status:'error',error:e.message},true).catch(()=>{});
      }
    }finally{
      this.running=false;
      if(this.available)queueMicrotask(()=>void b.pump().catch(()=>{}));
    }
  }
}
