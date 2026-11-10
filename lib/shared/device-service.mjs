import {z} from 'zod';
const key=z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/);
const unique=items=>new Set(items.map(i=>i.name)).size===items.length;
const field=z.object({name:key,type:z.enum(['string','number','boolean']),required:z.boolean().default(false)}).strict();
const action=z.object({name:key,title:z.string().trim().min(1).max(100),mode:z.enum(['read','write']),fields:z.array(field).max(24).refine(unique).default([])}).strict();
export const deviceService=z.object({canvasId:z.string().uuid(),name:key,title:z.string().trim().min(1).max(100),actions:z.array(action).min(1).max(24).refine(unique),members:z.array(z.string().uuid()).max(64).default([])}).strict();
export function serviceArgs(action,input={}){
 const value=z.record(z.string(),z.union([z.string().max(2048),z.number().finite(),z.boolean()])).parse(input);
 if(Object.keys(value).some(k=>!action.fields.some(f=>f.name===k))||action.fields.some(f=>Object.hasOwn(value,f.name)?typeof value[f.name]!==f.type:f.required))throw Error('设备动作参数不匹配 / Invalid action parameters');
 return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)));
}
