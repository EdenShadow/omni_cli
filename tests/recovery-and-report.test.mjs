import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequest} from '../src/api.mjs';
import {createBindingRecovery} from '../lib/desktop/binding-recovery.mjs';
import {submitSecurityReport,retrySecurityReports} from '../lib/desktop/command-security.mjs';

test('authenticated recovery coalesces reconnects, honors cooldown and stops on revocation',async()=>{
  const store={endpoint:'https://example.org',installation:'install',userId:'account',token:'first'};
  const {version}=JSON.parse(readFileSync(new URL('../package.json',import.meta.url)));
  let calls=0,now=0,status=429;
  const request=createRequest(store,async(url,options)=>{
    calls++;
    assert.equal(url.pathname,'/api/devices/restore');
    assert.equal(options.headers['X-Wanwu-Client-Version'],version);
    assert.equal(options.headers['X-Wanwu-Reported-User-Id'],store.userId);
    return Response.json(status===200?{deviceBinding:{device:{userId:'account'},deviceToken:'new-device'}}:{error:'fixture'},{status,headers:{'Retry-After':'1200'}});
  });
  const restore=createBindingRecovery({store,request,save(){},notify(){},isCurrent:()=>true,now:()=>now});
  await Promise.all([assert.rejects(restore()),assert.rejects(restore(true))]);
  now=1199999;await assert.rejects(restore(true));assert.equal(calls,1);
  now++;status=401;await assert.rejects(restore(true));assert.equal(calls,2);
  now+=86400000;await assert.rejects(restore());assert.equal(calls,2);
  store.token='second';status=200;await restore();assert.equal(store.deviceToken,'new-device');
  store.token=null;await restore(true);await assert.rejects(request('/api/devices/restore','POST',{}));assert.equal(calls,3);
});

test('bridge queues only a reason and replays a failed report once',async()=>{
  const id='fixture',bridge={store:{},save(){},request:async()=>{throw Error('offline');}};
  await assert.rejects(submitSecurityReport(bridge,id,'private-file-read'),{code:'WANWU_SECURITY_BLOCKED'});
  assert.deepEqual(bridge.store.pendingSecurityReports,{fixture:{reason:'private-file-read'}});
  let calls=0;bridge.request=async(route,method,body,device)=>{
    calls++;assert.equal(route,'/api/bridge/commands/fixture/security-report');
    assert.deepEqual([method,body,device],['POST',{reason:'private-file-read'},true]);
  };
  await retrySecurityReports(bridge);await retrySecurityReports(bridge);assert.equal(calls,1);
});
