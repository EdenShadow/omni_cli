// Optional protocol integration against a local Wanwu source checkout. Its
// fixture creates a disposable server, accounts and fake AI adapters: no live
// team messages, paid model calls or production credentials are used.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createChat} from '../src/chat.mjs';
import {chatStore} from '../src/chat-store.mjs';
import {loadState} from '../src/state.mjs';

test('Wanwu server: encrypted send, fake AI dispatch, correlated reply, deduplication and revoked membership', {skip:!process.env.OMNI_WANWU_SOURCE,timeout:60000},async()=>{
  const {fixture,until}=await import(pathToFileURL(path.join(process.env.OMNI_WANWU_SOURCE,'tests/helpers/scene-assistant-fixture.mjs')));
  const f=await fixture({requireEncryptedChat:true});
  try{
    const state=loadState(path.join(f.dir,'cli'));
    Object.assign(state.store,{endpoint:'http://localhost',token:f.owner.token,userId:f.owner.user.id});state.save();
    const request=(p,m,b)=>f.call(p.slice(4),f.owner.token,m,b),storage=chatStore(state,request),events=[];
    const chat=createChat({request,storage,userId:f.owner.user.id,emit:e=>events.push(e)});
    for(const [i,d] of f.devices.entries()){
      d.b.documentsPath=path.join(f.dir,'Documents-'+i);fs.mkdirSync(d.b.documentsPath);
      d.b.store.fileAccessByUser={[f.owner.user.id]:'all'};d.b.reportGroupChat();
      const adapter=d.b.adapter('codex');adapter.run=async(id,prompt,emit)=>{d.runs.push({id,prompt});emit({id:'answer',kind:'message',role:'assistant',phase:'final_answer',text:'CLI_FAKE_AI_REPLY'});return {};};
    }
    await until(async()=>{
      const ready=await storage.exclusive(({ring})=>ring.sync(f.project.id));
      for(const d of f.devices)await d.b.chatEncryption.sync();return ready.ready;
    });
    const input={id:randomUUID(),text:'@Bot CLI_PRIVATE_PROMPT'},sent=await chat.send(f.project.id,input);
    const again=await chat.send(f.project.id,input);assert.equal(sent.id,again.id);
    await until(async()=>{
      await f.app.groupChatBot.tick();
      for(const d of f.devices){await d.b.chatEncryption.sync();d.b.reportGroupChat();await d.b.workbench.pump();await d.b.pump();}
      return f.app.db.prepare('SELECT status FROM group_chat_jobs WHERE id=?').get(sent.id)?.status==='done';
    });
    assert.equal(await chat.wait(f.project.id,sent.id),'done');
    assert.ok(events.some(e=>e.type==='message'&&e.message.text==='CLI_FAKE_AI_REPLY'));
    assert.equal(f.devices.reduce((n,d)=>n+d.runs.length,0),1);
    assert.equal((await chat.list(f.project.id)).messages[0].text,input.text);
    const raw=JSON.stringify(f.app.db.prepare('SELECT * FROM team_chat').all());assert.ok(!raw.includes('CLI_PRIVATE_PROMPT'));assert.ok(!raw.includes('CLI_FAKE_AI_REPLY'));
    await assert.rejects(request(`/api/projects/${f.project.id}/chat`,'POST',{id:randomUUID(),text:'no plaintext'}),{status:426});
    f.app.db.prepare('DELETE FROM members WHERE project_id=? AND user_id=?').run(f.project.id,f.owner.user.id);
    await assert.rejects(chat.list(f.project.id),{status:403});
    await assert.rejects(chat.send(f.project.id,input),{status:403});
  }finally{await f.close();}
});
