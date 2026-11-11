// Custom pages are separate from the declarative wanwu.ui.json extension API.
// No credentials, project APIs or executable host capabilities cross this boundary.
export const INTERACTION_HTML_LIMIT=256*1024;
export function interactionJson(value,limit=16384){
 const json=JSON.stringify(value??{});
 if(!json||json.length>limit)throw Error('交互数据过大 / Interaction data is too large');
 const result=JSON.parse(json);
 if(!result||typeof result!=='object'||Array.isArray(result))throw Error('交互数据须为对象 / Interaction data must be an object');
 let nodes=0;const inspect=(v,depth)=>{if(++nodes>1000||depth>8)throw Error('交互数据结构过深 / Interaction data is too deeply nested');if(v&&typeof v==='object')for(const child of Object.values(v))inspect(child,depth+1);};inspect(result,0);
 return result;
}
export function skillInteraction(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid interaction');
 const allowed=['version','title','display','size','html','initialState','capabilities','timeoutMs'];
 if(Object.keys(input).some(k=>!allowed.includes(k)))throw Error('Unknown interaction field');
 const {version=1,title,display='session',size='compact',html,capabilities={},timeoutMs=900000}=input;
 if(version!==1||typeof title!=='string'||!title.trim()||title.length>120||!['session','global'].includes(display)||!['compact','wide'].includes(size))throw Error('Invalid interaction presentation');
 if(typeof html!=='string'||!html.trim()||new TextEncoder().encode(html).length>INTERACTION_HTML_LIMIT)throw Error('交互页面须为不超过 256 KB 的 HTML / Supply an HTML page up to 256 KB');
 if(!Number.isInteger(timeoutMs)||timeoutMs<60000||timeoutMs>1800000)throw Error('Interaction timeout must be 1–30 minutes');
 if(!capabilities||typeof capabilities!=='object'||Array.isArray(capabilities)||Object.entries(capabilities).some(([k,v])=>!['files','motion'].includes(k)||typeof v!=='boolean'))throw Error('Invalid interaction capabilities');
 return {version,title:title.trim(),display,size,html,initialState:interactionJson(input.initialState),capabilities:{files:capabilities.files===true,motion:capabilities.motion===true},timeoutMs};
}
export function interactionAnswer(input){
 if(input===false)return false;
 if(!input||typeof input!=='object'||Object.keys(input).some(k=>!['text','values','files','submissionId'].includes(k)))throw Error('Invalid interaction answer');
 const {text='',files=[],submissionId}=input;
 if(typeof text!=='string'||text.length>12000||!Array.isArray(files)||files.length>30||!text.trim()&&!Object.keys(input.values||{}).length&&!files.length)throw Error('请填写内容或添加附件 / Add a response or an attachment');
 if(typeof submissionId!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(submissionId))throw Error('Invalid submission ID');
 const values=interactionJson(input.values);
 for(const f of files)if(!f||Object.keys(f).some(k=>!['name','mime','size'].includes(k))||typeof f.name!=='string'||!f.name||f.name.length>255||typeof f.mime!=='string'||f.mime.length>200||!Number.isSafeInteger(f.size)||f.size<0||f.size>1024**3)throw Error('Invalid interaction attachment');
 return {text:text.trim(),values,files,submissionId};
}
export function interactionPrompt(title,answer){
 return [title,answer.text,Object.keys(answer.values||{}).length?JSON.stringify(answer.values):''].filter(Boolean).join('\n\n');
}
