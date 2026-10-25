import {PROVIDERS} from './providers.mjs';
import {z} from 'zod';
const uuid=z.string().uuid();
export const toolName=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.+-]{0,63}$/);
export const dispatchTask=z.object({
 key:z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),deviceId:uuid,
 sessionId:uuid.optional(),folderId:uuid.optional(),
 folder:z.object({parent:z.string().min(1).max(4000),name:z.string().min(1).max(160).regex(/^[^\\/\u0000-\u001f]+$/),provider:z.enum(PROVIDERS)}).strict().optional(),
 secureTask:z.object({v:z.literal(1),keyId:z.string().regex(/^[A-Za-z0-9+/]{43}=$/),iv:z.string().length(16),data:z.string().max(256*1024)}).strict().optional(),
 title:z.string().trim().min(1).max(160).optional(),prompt:z.string().trim().min(1).max(30000),
 dependsOn:z.array(z.string().max(64)).max(32).default([]),requireIdle:z.boolean().default(false),
 tools:z.array(toolName).max(20).default([]),model:z.string().max(180).optional(),effort:z.string().max(40).optional(),
 attachments:z.array(z.union([z.object({uploadId:uuid}).strict(),z.object({folderArchiveId:uuid}).strict()])).max(5).default([]),
}).strict().refine(t=>[t.sessionId,t.folderId,t.folder].filter(Boolean).length===1,'Choose exactly one session, folder or new folder');
export const dispatchPlan=z.object({id:uuid,tasks:z.array(dispatchTask).min(1).max(32),returnToChat:z.boolean().default(false),locale:z.enum(['zh','en']).default('zh')}).strict().superRefine((plan,ctx)=>{
 const keys=new Set(plan.tasks.map(t=>t.key));if(keys.size!==plan.tasks.length)ctx.addIssue({code:'custom',message:'Duplicate task key'});
 const visiting=new Set(),done=new Set();
 function visit(key){if(visiting.has(key))throw Error('Dependencies contain a cycle');if(done.has(key))return;visiting.add(key);for(const dep of plan.tasks.find(t=>t.key===key)?.dependsOn||[]){if(!keys.has(dep))throw Error('Unknown dependency: '+dep);visit(dep);}visiting.delete(key);done.add(key);}
 try{for(const key of keys)visit(key);}catch(e){ctx.addIssue({code:'custom',message:e.message});}
});
