// Presentation copies only. Never apply this to an executable prompt, tool input,
// provider history or attachment bytes. The mask deliberately reveals no length.
export const SECRET_MASK = '***';
// The shared preview is deliberately bounded: only the first three Unicode
// characters, followed by a fixed mask (never the original secret's length).
export function maskedSubmissionPreview(value) {
  const text = typeof value === 'string' ? value : '';
  const characters = Array.from(text);
  return (characters.length > 3 && !/^\*+$/.test(text) ? characters.slice(0,3).join('') : '') + '********';
}
const label = String.raw`(?:密码|口令|密钥|(?:[a-z][a-z0-9]*[_-])*(?:password|passwd|pwd|api[_ -]?key|access[_ -]?key|secret[_ -]?key)|key)`;
const assignment = new RegExp(String.raw`((?<![\w-])${label}["'\x60]?\s*(?:(?:[:=：]|\bis\b|为|是)\s*|[ \t]+))(["'\x60])((?:\\[\s\S]|(?!\2)[^\r\n])*)(\2|(?=\r?\n|$))`, 'gi');
const bare = new RegExp(String.raw`((?<![\w-])${label}["'\x60]?[ \t]*(?:(?:[:=：]|\bis\b|为|是)[ \t\r\n]*|[ \t]+))([^\s,;，；。！？<>"'\x60}\]\)]+)`, 'gi');
const field = new RegExp(`^(?:${label})$`, 'i');
const discussion = /^(?:是什么|怎么|如何|输入框|功能|验证|管理|设置|修改|重置|保护|加密|检查|不要|不能|可以|需要|支持|不|未|已|请|的|和|或|是|为|reset|validation|field|input|settings|required|optional|must|should|is|are|and|or|please|use|the|a|an|to|for|with|without)$/i;
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Literal keyword presence is enough, including ordinary questions and multiline
// submissions. The body stays masked; only maskedPreview may keep its bounded prefix.
const submissionTrigger = /密码|password|key|sk-[a-z0-9_-]+/i;
export function redactSecrets(value, options = {}) {
  if (typeof value !== 'string') return value;
  const redacted = redactSecretValues(value, options);
  return submissionTrigger.test(value) || redacted !== value ? SECRET_MASK : value;
}

// Diagnostics are not user submissions: keep their useful explanation while
// retaining the existing credential-value protection.
export function redactSecretValues(value, {secrets = [], collect, streaming = false} = {}) {
  if (typeof value !== 'string') return value;
  const hide = secret => { if (secret && !/^\*+$/.test(secret)) collect?.(secret); return SECRET_MASK; };
  let text = value.replace(assignment, (_, prefix, quote, secret, closing) => {if(quote==='"'&&closing)try{collect?.(JSON.parse(quote+secret+quote));}catch{}return prefix + quote + hide(secret) + closing;});
  text = text.replace(bare, (whole, prefix, secret) => {
    // A bare keyword in a question is not a credential assignment.
    if (!/[:=：]|\bis\b|为|是/i.test(prefix) && (discussion.test(secret) || /^[\p{Script=Han}]+$/u.test(secret))) return whole;
    if (/^(?:什么|多少|啥|怎么|如何)(?:吗|呢)?$/.test(secret)) return whole;
    return prefix + hide(secret);
  });
  text = text.replace(/\bsk-[a-z0-9_-]+/gi, hide);
  // A value supplied earlier in this session stays private when echoed without
  // its label (including streamed prefixes and JSON/string escaped echoes).
  for (const secret of [...secrets].filter(s => typeof s === 'string' && s.length >= 3).sort((a,b)=>b.length-a.length)) {
    let encoded=secret;try{encoded=encodeURIComponent(secret);}catch{/* Invalid Unicode must not interrupt display. */}
    for (const form of new Set([secret, JSON.stringify(secret).slice(1,-1), encoded])) {
      text = text.replace(new RegExp(escape(form), 'g'), SECRET_MASK);
      if (streaming) for (let n = Math.min(form.length - 1, text.length); n > 0; n--) {
        if (text.endsWith(form.slice(0,n))) { text = text.slice(0,-n) + SECRET_MASK; break; }
      }
    }
  }
  return text;
}

// Preserve routing IDs, encryption envelopes, media and cursor tokens verbatim.
// Only user-visible content and nested tool/raw content are presentation data.
const textFields = new Set(['text','prompt','title','summary','description','label','error','message','output','result','command','arguments','input','content','note','name','query','detail','sessionTitle']);
const nestedFields = new Set(['raw','payload','items','events','messages','activity','replies','prompts','details','author','attachments','files']);
const bodyFields = new Set(['text','prompt','content','input','message','query']);
// Carry only the existing routing UUID out of the prompt before hiding it, so
// history and the shared command still resolve to one bubble after redaction.
export function submissionCommandId(text) {
  if(typeof text!=='string')return undefined;
  return [...text.matchAll(/^<wanwu scope="([0-9a-f-]{36})"(?: from="[^\n]*")? \/>$/gm)].at(-1)?.[1] || text.match(/\[wanwu-message:([0-9a-f-]{36})\]/)?.[1];
}
function bodyText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(bodyText).join('');
  if (!value || typeof value !== 'object') return '';
  return Object.entries(value).filter(([key])=>bodyFields.has(key)||key==='raw'||field.test(key)).map(([key,child])=>(field.test(key)?key+':':'')+bodyText(child)).join('');
}
export function redactPresentation(value, options = {}, raw = false) {
  if (typeof value === 'string') return redactSecrets(value,options);
  if (Array.isArray(value)) return value.map(item=>redactPresentation(item,options,raw));
  if (!value || typeof value !== 'object') return value;
  const result = {...value};
  if(isUserSubmission(value)&&!value.commandId){const commandId=submissionCommandId(value.text||value.prompt);if(commandId)result.commandId=commandId;}
  // A multipart user message is one submission. A trigger in any block must
  // also hide unlabelled blocks and the duplicate provider raw representation.
  const body = isUserSubmission(value) ? bodyText(value) : '';
  const hideSubmission = body && redactSecrets(body, options) !== body;
  if (hideSubmission) result.maskedPreview = maskedSubmissionPreview(value.text || value.prompt || body);
  else if (value.maskedPreview !== undefined) result.maskedPreview = maskedSubmissionPreview(value.maskedPreview);
  for (const [key, child] of Object.entries(value)) {
    if (key === 'maskedPreview') continue;
    if (/^(?:secure|cipher|nonce|iv|base64|cursor|endpoint|id$)/i.test(key) || !raw && /^(?:data|url|path)/i.test(key)) continue;
    if (hideSubmission && key === 'raw') delete result.raw;
    else if (hideSubmission && bodyFields.has(key)) result[key]=SECRET_MASK;
    else if (raw && field.test(key) && typeof child === 'string') {options.collect?.(child);result[key]=SECRET_MASK;}
    else if (textFields.has(key) || nestedFields.has(key) || raw) result[key]=redactPresentation(child,options,raw||key==='raw'||key==='input'||key==='arguments');
  }
  return result;
}

// Only human submissions are masked. Assistant replies, tool output and progress
// retain their exact content, even when they repeat a submitted credential.
export function isUserSubmission(value) {
  return value?.role !== 'assistant' && value?.kind !== 'tool' &&
    (value?.role === 'user' || value?.kind === 'command');
}
export function redactUserSubmission(value, options = {}) {
  return isUserSubmission(value) ? redactPresentation(value, options) : value;
}

export class ConversationPrivacy {
  constructor() { this.secrets = new Set(); this.streams = new Map(); this.fragments = new Map(); }
  learn(value) { redactPresentation(value,{collect:s=>{if(s.length>=3&&this.secrets.size<1000)this.secrets.add(s);}}); }
  view(value, streaming = false) { return redactPresentation(value,{secrets:this.secrets,streaming}); }
  page(page) { for(const item of page.items||[])if(isUserSubmission(item))this.learn(item);return {...page,items:(page.items||[]).map(item=>isUserSubmission(item)?this.view(item):item)}; }
  event(payload) {
    if (!payload || payload.secureEvent) return payload;
    if (payload.kind === 'fragment') {
      const {group,index,total,data}=payload;
      if(typeof group!=='string'||!Number.isInteger(index)||!Number.isInteger(total)||total<1||total>10000||index<0||index>=total||typeof data!=='string')return null;
      let state=this.fragments.get(group);
      if(!state){if(this.fragments.size>=32)this.fragments.delete(this.fragments.keys().next().value);state={parts:new Map(),bytes:0,total};this.fragments.set(group,state);}
      if(state.total!==total)return null;
      state.bytes+=data.length-(state.parts.get(index)?.length||0);state.parts.set(index,data);
      if(state.bytes>8*1024*1024){this.fragments.delete(group);return {kind:'diagnostic',id:group,text:SECRET_MASK,privacyVersion:3};}
      if(state.parts.size!==total)return null;
      this.fragments.delete(group);
      try{return this.event(JSON.parse(Array.from({length:total},(_,i)=>state.parts.get(i)).join('')));}catch{return null;}
    }
    if(!isUserSubmission(payload))return payload;
    const id=payload.id||payload.commandId+':'+(payload.role||'system');
    if(payload.kind==='delta') {
      const previous=this.streams.get(id)||{},text=(previous.text||'')+(payload.text||'');
      const snapshot={...previous,...payload,kind:payload.role==='system'?'tool':'message',text,streaming:true};
      // Raw delta JSON contains the unlabelled suffix: use the assembled content.
      delete snapshot.raw;
      if(text.length>2*1024*1024){snapshot.text=SECRET_MASK;snapshot.privacyTruncated=true;}
      if(previous.privacyTruncated)snapshot.text=SECRET_MASK;
      delete snapshot.displayText;
      this.streams.set(id,snapshot);
      if(this.streams.size>200)this.streams.delete(this.streams.keys().next().value);
      // A later chunk may contain the keyword. Do not publish any prefix of a
      // human submission before its complete message can be checked. Commands
      // and complete provider messages already carry the full submitted prompt.
      return null;
    }
    if(payload.streaming===true||payload.status==='inProgress')return null;
    if(payload.kind==='message'&&payload.text===undefined&&this.streams.has(id))payload={...payload,text:this.streams.get(id).text};
    if(payload.id&&payload.kind==='message')this.streams.delete(id);
    if(!payload.streaming&&payload.status!=='inProgress')this.learn(payload);
    return {...this.view(payload),privacyVersion:3};
  }
}

// User delta suffixes cannot be safely filtered independently on legacy replay.
// Assistant events are always passed through; full user history is masked separately.
export function publicConversationEvent(payload, privacy = new ConversationPrivacy()) {
  if(!isUserSubmission(payload))return payload;
  // Version 2 could leave unlabelled lines in standalone deltas. Omit every
  // legacy human delta; the command/history snapshot supplies the safe message.
  if(payload?.kind==='delta'||payload?.streaming===true||payload?.status==='inProgress')return {kind:'privacy-omitted',privacyVersion:3};
  return privacy.view(payload);
}
