import {z} from 'zod';

export const SKILL_UI_MANIFEST='wanwu.ui.json';
export const UI_SLOTS=['project.toolbar','chat.toolbar','chat.composer.actions','canvas.toolbar','skills.toolbar'];
export const UI_COMPOSER_COMMANDS=['mentions','attachments','emoji','focus'];
export const UI_HOOKS=['chat.title','chat.placeholder','canvas.title','skills.title'];
const id=z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),text=z.string().trim().min(1).max(80);
const action=z.discriminatedUnion('type',[
 z.object({id,type:z.literal('open-panel'),panelId:id}).strict(),
 z.object({id,type:z.literal('open-canvas'),canvasId:z.string().uuid()}).strict(),
 z.object({id,type:z.literal('open-skill'),skill:id.optional()}).strict(),
 z.object({id,type:z.literal('navigate'),page:z.enum(['chat','canvases','skills','announcement','todos'])}).strict(),
 z.object({id,type:z.literal('compose-chat'),text:z.string().trim().min(1).max(4000)}).strict(),
 z.object({id,type:z.literal('chat-input'),command:z.enum(UI_COMPOSER_COMMANDS),filter:z.enum(['all','bot','member','session']).optional()}).strict(),
]);
const button=z.object({id,label:text,icon:z.enum(['puzzle','sparkles','clipboard','calendar','chart','message','canvas','play','at','bot','paperclip','smile']).default('puzzle'),action:id}).strict();
const field=z.object({id,label:text,type:z.enum(['text','textarea','select']).default('text'),required:z.boolean().default(false),placeholder:z.string().max(120).optional(),options:z.array(text).min(1).max(30).optional()}).strict();
const panel=z.object({id,title:text,description:z.string().max(2000).optional(),fields:z.array(field).max(12).default([]),buttons:z.array(button).min(1).max(8)}).strict();
const schema=z.object({schemaVersion:z.literal(1),skill:id,buttons:z.array(button.extend({slot:z.enum(UI_SLOTS)})).max(12).default([]),hooks:z.array(z.object({target:z.enum(UI_HOOKS),text:z.string().trim().min(1).max(120)}).strict()).max(4).default([]),panels:z.array(panel).max(6).default([]),actions:z.array(action).max(24).default([])}).strict();
const unique=(items,kind)=>{if(new Set(items.map(v=>v.id)).size!==items.length)throw Error('界面扩展 '+kind+' ID 重复');};
export function validateSkillUi(input,name){
 let doc;try{doc=schema.parse(input);}catch(e){throw Error('wanwu.ui.json 无效：'+e.issues?.map(i=>i.path.join('.')+' '+i.message).slice(0,3).join(';'));}
 if(doc.skill!==name)throw Error('界面扩展的 skill 必须与技能名称一致');
 unique(doc.actions,'action');unique(doc.panels,'panel');unique(doc.buttons,'button');
 for(const a of doc.actions)if(a.type==='chat-input'&&a.filter&&a.command!=='mentions')throw Error('filter 仅用于 mentions 动作');
 if(new Set(doc.hooks.map(h=>h.target)).size!==doc.hooks.length)throw Error('同一个技能不可重复修改相同 UI 元素');
 const actions=new Map(doc.actions.map(a=>[a.id,a])),panels=new Map(doc.panels.map(p=>[p.id,p]));
 const checkButton=(b,fields=[])=>{const a=actions.get(b.action);if(!a)throw Error('按钮引用的 action 不存在：'+b.action);if(a.type==='compose-chat')for(const token of a.text.matchAll(/\{\{([^{}]+)\}\}/g)){if(!['project.name','user.name'].includes(token[1])&&!fields.some(f=>'field.'+f.id===token[1]))throw Error('按钮模板引用了未声明的字段：'+token[1]);}};
 for(const a of doc.actions)if(a.type==='open-panel'&&!panels.has(a.panelId))throw Error('action 引用的 panel 不存在');
 doc.buttons.forEach(b=>checkButton(b));
 for(const p of doc.panels){unique(p.fields,'field');unique(p.buttons,'panel button');for(const f of p.fields)if((f.type==='select')!==!!f.options)throw Error('select 字段必须提供 options，其他字段不能提供 options');p.buttons.forEach(b=>checkButton(b,p.fields));}
 const used=new Set([...doc.buttons,...doc.panels.flatMap(p=>p.buttons)].map(b=>b.action));
 if(doc.actions.some(a=>!used.has(a.id)))throw Error('界面扩展包含没有按钮入口的 action');
 return doc;
}
export function skillUiManifest(pkg){
 const file=pkg.files.find(f=>f.path.toLowerCase()===SKILL_UI_MANIFEST);
 if(!file)return null;
 if(file.path!==SKILL_UI_MANIFEST||Buffer.byteLength(file.data,'base64')>65536)throw Error('wanwu.ui.json 名称或大小无效（最多 64 KB）');
 let input;try{input=JSON.parse(Buffer.from(file.data,'base64').toString('utf8'));}catch{throw Error('wanwu.ui.json 必须是有效 JSON');}
 return validateSkillUi(input,pkg.name);
}
export function expandSkillUiAction(manifest,actionId,panelId,values={},context={}){
 const panel=panelId?manifest.panels.find(p=>p.id===panelId):null;
 if(panelId&&!panel)throw Error('扩展面板不存在');
 if(!(panel?.buttons||manifest.buttons).some(b=>b.action===actionId))throw Error('此入口不提供该动作');
 const action=manifest.actions.find(a=>a.id===actionId);if(!action)throw Error('扩展动作不存在');
 if(action.type!=='compose-chat')return action;
 if(!values||typeof values!=='object'||Array.isArray(values))throw Error('表单内容无效');
 const fields=panel?.fields||[];
 if(Object.keys(values).some(k=>!fields.some(f=>f.id===k)))throw Error('表单包含未声明的字段');
 for(const f of fields){const v=values[f.id]??'';if(typeof v!=='string'||v.length>2000)throw Error('字段内容过长或类型无效：'+f.label);if(f.required&&!v.trim())throw Error('请填写：'+f.label);if(v&&f.type==='select'&&!f.options.includes(v))throw Error('请选择有效选项：'+f.label);}
 const text=action.text.replace(/\{\{([^{}]+)\}\}/g,(_,key)=>key==='project.name'?context.projectName||'':key==='user.name'?context.userName||'':values[key.slice(6)]||'');
 if(text.length>4000)throw Error('生成的消息超过 4000 字，请缩短表单内容');
 return {...action,text};
}
export const skillUiBrief=`When the user requests project interface extensions, add wanwu.ui.json (schemaVersion: 1, skill: exact skill name). The host accepts declarative UI only: buttons in project.toolbar/chat.toolbar/chat.composer.actions/canvas.toolbar/skills.toolbar; text hooks for chat.title/chat.placeholder/canvas.title/skills.title; panels with text/textarea/select fields; actions open-panel/open-canvas/open-skill/navigate/compose-chat/chat-input. Use chat.composer.actions for buttons beside the microphone; chat-input commands mentions (filter all/bot/member/session), attachments, emoji and focus open native composer controls. Query capabilities.skillUi for supported slots and composerCommands before publishing. No DOM selectors, JS, CSS, HTML, arbitrary API calls or startup side effects. Read wanwu-skills-sync/references/ui-extensions.md for the exact schema and an example. Publishing activates the selected skill version for project members; deletion, version changes and project switching automatically reconcile the UI. Preserve existing extensions when editing unrelated skill behavior. Do not add an extension when the user did not request one.`;
