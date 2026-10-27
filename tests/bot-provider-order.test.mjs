import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeBotProviderOrder} from '../lib/shared/bot-provider-order.mjs';
import {botProviderOrder,saveBotProviderOrder} from '../lib/desktop/bot-provider-order.mjs';

test('priority defaults and untrusted reports retain every known runtime once',()=>{
 assert.deepEqual(normalizeBotProviderOrder(null),['codex','claude','dsh','wanwu']);
 assert.deepEqual(normalizeBotProviderOrder(['dsh','invalid','dsh','codex']),['dsh','codex','claude','wanwu']);
});
test('priority persists per account and endpoint and rolls back on save failure',()=>{
 const store={endpoint:'https://one.test',userId:'alice'},order=['claude','dsh','codex','wanwu'];let disk;
 saveBotProviderOrder(store,()=>{disk=JSON.stringify(store);},order);
 assert.deepEqual(botProviderOrder(JSON.parse(disk)),order);
 assert.deepEqual(botProviderOrder({...store,userId:'bob'}),normalizeBotProviderOrder(null));
 assert.deepEqual(botProviderOrder({...store,endpoint:'https://two.test'}),normalizeBotProviderOrder(null));
 assert.throws(()=>saveBotProviderOrder(store,()=>{throw Error('disk');},['wanwu','codex','claude','dsh']),/disk/);
 assert.deepEqual(botProviderOrder(store),order);
 for(const invalid of [['claude'],['claude','claude','dsh','wanwu'],['evil','codex','claude','dsh'],null])assert.throws(()=>saveBotProviderOrder(store,()=>{},invalid));
 assert.throws(()=>saveBotProviderOrder({},()=>{},order));
});
