import {isOfficialSkill} from './official-skills.mjs';
// Self-contained SVG miniatures remain legible on a 40 px project board.
export const skillIconBrief = `Create assets/skill-icon.svg as a polished, original miniature app illustration, not a thin outline glyph. Every new skill needs its own purpose-specific illustration: presentation slides for PPT, a picture for image creation, a clapperboard for video, etc. Do not reuse a generic briefcase, toolbox, sparkle or an unchanged category icon; distinguish the actual task with a concrete subject and composition. Reference the saved file in SKILL.md metadata.icon or agents/openai.yaml interface.icon_large. Use a 128x128 viewBox, a rounded-square colored field (radius 28), one large filled subject occupying about 80% of the canvas, and 3–5 harmonious colors with strong foreground contrast. Show volume with an offset solid shadow, one side face and one simple highlight. Keep details readable at 40px: no text, letters, hairline strokes, tiny decorations or stock icon traced over a pastel tile. Leave 8px safety space. Use plain paths, rectangles, circles and ellipses only; no scripts, external references, fonts, embedded images, filters, gradients, CSS, animation or url() references. Inspect the result at 40px and 76px before finishing.`;

export function skillIconSubject(name, description = '') {
  // Prefer the skill's identity; descriptions often mention incidental formats/tools.
  // English word boundaries avoid "art" in "start" and "code" in "decode".
  const rules = [
    ['presentation', /\b(pptx?|powerpoint|slides?|presentation|keynote)\b|幻灯片|演示文稿/i],
    ['billing', /\b(bill(?:ing|s)?|reconcil\w*|invoices?|finance)\b|账单|对账|财务|成本|利润/i],
    ['account', /\b(subaccounts?|accounts?|oauth)\b|账号|账户|开户|授权登录/i],
    ['character', /\b(characters?|avatars?)\b|角色|人物|形象/i],
    ['space', /\b(office|space|scene|layout)\b|场景|办公室|布局/i],
    ['video', /\b(video|film|movie|animation|remotion)\b|视频|剪辑|动画/i],
    ['audio', /\b(audio|music|voice|speech|suno|podcast)\b|音频|音乐|语音|播客/i],
    ['image', /\b(image\d*|photo|picture|poster|screenshot|ocr)\b|图片|图像|生图|海报|截图/i],
    ['calendar', /\b(calendar|schedule|reminder|todo)\b|日历|日程|提醒|待办/i],
    ['translation', /\b(translat\w*|localiz\w*|language)\b|翻译|多语言|本地化/i],
    ['security', /\b(security|password|encrypt\w*|privacy)\b|安全|密码|加密|隐私/i],
    ['chat', /\b(chat|message|email|mail|slack)\b|群聊|消息|邮件/i],
    ['web', /\b(web|website|browser|html)\b|网页|网站|浏览器/i],
    ['code', /\b(code|coding|develop\w*|debug\w*|cli)\b|代码|开发|编程|调试/i],
    ['research', /\b(search|research)\b|搜索|研究|检索/i],
    ['writing', /\b(reports?|writ\w*|docs?|documents?|notes?)\b|文档|写作|周报|日报|总结/i],
    ['data', /\b(data|charts?|analysis|analytics|spreadsheet|excel)\b|分析|数据|表格/i],
    ['design', /\b(design\w*|art|svg|figma)\b|设计|绘画/i],
    ['automation', /\b(automat\w*|workflow|sync|download|upload)\b|自动化|工作流|同步|下载|上传/i],
  ];
  for (const text of [name, description]) {
    const normalized=String(text||'').replaceAll('_',' ');
    const match=rules.find(([,pattern])=>pattern.test(normalized));
    if(match)return match[0];
  }
  return 'identity';
}

const artwork = {
  presentation: {
    background: '#7960B2',
    art: `<path d="M64 84v22m-19 5 19-8 19 8" fill="none" stroke="#EDE4F5" stroke-width="7" stroke-linecap="round"/><rect x="21" y="26" width="93" height="66" rx="9" fill="#4E407D"/><rect x="14" y="19" width="93" height="66" rx="9" fill="#FFF3DB"/><path d="M28 35h38M28 49h23M28 63h17" stroke="#AE94CC" stroke-width="6" stroke-linecap="round"/><rect x="64" y="43" width="47" height="49" rx="7" fill="#E9B76D"/><rect x="70" y="49" width="35" height="34" rx="4" fill="#FFF3DB"/><circle cx="94" cy="58" r="5" fill="#E9B76D"/><path d="m70 78 12-16 9 12 6-8 8 12v5H70Z" fill="#70ACA0"/>`,
  },
  image: {
    background: '#558D87',
    art: `<rect x="25" y="26" width="88" height="80" rx="12" fill="#346960"/><rect x="16" y="18" width="88" height="80" rx="12" fill="#FFF2DA"/><rect x="24" y="27" width="72" height="62" rx="7" fill="#B9DAD5"/><circle cx="77" cy="43" r="10" fill="#EDB96B"/><path d="m24 77 23-29 24 32 12-16 13 15v10H24Z" fill="#5B9C8F"/><path d="m69 101 31-38 10 8-31 38-16 6Z" fill="#E9B76D"/><path d="m63 115 6-14 10 8Z" fill="#FFF2DA"/>`,
  },
  video: {
    background: '#AB697A',
    art: `<rect x="23" y="43" width="90" height="65" rx="10" fill="#74495D"/><rect x="16" y="36" width="90" height="65" rx="10" fill="#FAE8D4"/><path d="M16 36h90v20H16Z" fill="#424C68"/><path d="m24 36 12 20m13-20 12 20m13-20 12 20" stroke="#FAE8D4" stroke-width="10"/><path d="m17 30 84-18 4 18-84 18Z" fill="#424C68"/><path d="m27 28 15 15m9-20 15 15m9-20 15 15" stroke="#FAE8D4" stroke-width="8"/><circle cx="61" cy="77" r="18" fill="#D38A92"/><path d="m56 66 16 11-16 11Z" fill="#FAE8D4"/>`,
  },
  audio: {
    background: '#6766A3',
    art: `<ellipse cx="65" cy="109" rx="30" ry="7" fill="#46487A"/><rect x="49" y="18" width="37" height="59" rx="18" fill="#46487A"/><rect x="42" y="12" width="37" height="59" rx="18" fill="#FFF1D7"/><path d="M43 33h14m-14 13h14m-13 13h13" stroke="#C5B1D4" stroke-width="5" stroke-linecap="round"/><path d="M32 54v9q0 24 29 24t29-24v-9M61 87v20m-17 0h34" fill="none" stroke="#E9B86E" stroke-width="7" stroke-linecap="round"/><path d="M103 28v27m10-19v12" stroke="#A1D2C3" stroke-width="5" stroke-linecap="round"/>`,
  },
  calendar: {
    background: '#5B8A9B',
    art: `<rect x="24" y="29" width="87" height="80" rx="12" fill="#386579"/><rect x="17" y="22" width="87" height="80" rx="12" fill="#FFF0D6"/><path d="M17 34q0-12 12-12h63q12 0 12 12v15H17Z" fill="#DD9D87"/><path d="M38 16v17m44-17v17" stroke="#FFF0D6" stroke-width="7" stroke-linecap="round"/><path d="M32 62h7m14 0h7m14 0h7M32 78h7m14 0h7" stroke="#9EABC0" stroke-width="7" stroke-linecap="round"/><circle cx="89" cy="91" r="21" fill="#74B2A1"/><path d="m78 91 7 7 14-16" fill="none" stroke="#FFF0D6" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  translation: {
    background: '#749A86',
    art: `<path d="M22 24h66q10 0 10 10v38q0 10-10 10H51L31 96V82h-9q-10 0-10-10V34q0-10 10-10Z" fill="#395F61"/><path d="M22 17h61q10 0 10 10v35q0 10-10 10H46L27 86V72h-5q-10 0-10-10V27q0-10 10-10Z" fill="#F7EAD2"/><circle cx="52" cy="44" r="19" fill="#A4CDC3"/><ellipse cx="52" cy="44" rx="8" ry="19" fill="none" stroke="#4B827C" stroke-width="3"/><path d="M33 44h38" stroke="#4B827C" stroke-width="3"/><path d="M70 64h33q10 0 10 10v21q0 9-10 9h-4v11l-17-11H70q-10 0-10-9V74q0-10 10-10Z" fill="#E8B778"/><path d="M72 78h28m-28 12h19" stroke="#F7EAD2" stroke-width="5" stroke-linecap="round"/>`,
  },
  security: {
    background: '#657C9B',
    art: `<path d="m67 21 41 17v30q0 28-41 48Q26 96 26 68V38Z" fill="#3D526E"/><path d="m61 14 41 17v30q0 28-41 48Q20 89 20 61V31Z" fill="#E7EADC"/><path d="m61 24 31 13v24q0 22-31 36Z" fill="#A0C8BD"/><path d="M47 59V48q0-14 14-14t14 14v11" fill="none" stroke="#506A85" stroke-width="7"/><rect x="39" y="55" width="44" height="31" rx="8" fill="#E4B66C"/><path d="M61 66v9" stroke="#FFF2D6" stroke-width="6" stroke-linecap="round"/>`,
  },
  chat: {
    background: '#698CBA',
    art: `<path d="M28 25h70q12 0 12 12v40q0 12-12 12H60l-23 18V89h-9q-12 0-12-12V37q0-12 12-12Z" fill="#405E8C"/><path d="M24 18h70q12 0 12 12v40q0 12-12 12H55l-23 18V82h-8q-12 0-12-12V30q0-12 12-12Z" fill="#FFF1D8"/><circle cx="36" cy="49" r="6" fill="#9A8ABD"/><circle cx="59" cy="49" r="6" fill="#9A8ABD"/><circle cx="82" cy="49" r="6" fill="#9A8ABD"/><path d="m82 99 28-14-9 27-6-11Z" fill="#E9B878"/>`,
  },
  web: {
    background: '#658FAD',
    art: `<rect x="22" y="29" width="92" height="75" rx="11" fill="#3E607D"/><rect x="15" y="22" width="92" height="75" rx="11" fill="#FFF0D8"/><path d="M15 43h92" stroke="#C5CFD9" stroke-width="5"/><circle cx="28" cy="33" r="3" fill="#DA9D8A"/><circle cx="39" cy="33" r="3" fill="#E1BB76"/><circle cx="50" cy="33" r="3" fill="#83B6A7"/><circle cx="60" cy="69" r="20" fill="#ACD1C8"/><ellipse cx="60" cy="69" rx="9" ry="20" fill="none" stroke="#558F8A" stroke-width="3"/><path d="M40 69h40" stroke="#558F8A" stroke-width="3"/><path d="m87 78 23 17-13 2-5 13Z" fill="#DCA869"/>`,
  },
  automation: {
    background: '#628E90',
    art: `<path d="M37 39h52v49H37Z" fill="none" stroke="#BCD6CA" stroke-width="8" stroke-linejoin="round"/><rect x="16" y="19" width="42" height="37" rx="9" fill="#365F6B"/><rect x="12" y="15" width="42" height="37" rx="9" fill="#FFF0D6"/><rect x="70" y="68" width="42" height="37" rx="9" fill="#365F6B"/><rect x="66" y="64" width="42" height="37" rx="9" fill="#E9B574"/><path d="m81 34 8 9 8-9m-52 59-8-9-8 9" fill="none" stroke="#FFF0D6" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="33" cy="34" r="8" fill="#8AAABB"/><path d="m79 82 6 6 12-14" fill="none" stroke="#FFF0D6" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  billing: {
    background: '#A88156',
    art: `<rect x="25" y="21" width="66" height="90" rx="11" fill="#765D48"/><rect x="18" y="14" width="66" height="90" rx="11" fill="#FFF1D8"/><rect x="33" y="11" width="35" height="14" rx="5" fill="#E0AF70"/><path d="M32 41h35M32 54h20M32 67h20M32 80h15" stroke="#C0A78A" stroke-width="5" stroke-linecap="round"/><rect x="64" y="52" width="48" height="59" rx="9" fill="#6A655E"/><rect x="59" y="46" width="48" height="59" rx="9" fill="#88AFA7"/><rect x="67" y="55" width="32" height="13" rx="3" fill="#EDF4DF"/><path d="M68 80h4m11 0h4m11 0h1M68 92h4m11 0h4m11 0h1" stroke="#F6F0DD" stroke-width="6" stroke-linecap="round"/>`,
  },
  account: {
    background: '#667BA7',
    art: `<rect x="22" y="29" width="89" height="75" rx="13" fill="#455774"/><rect x="15" y="22" width="89" height="75" rx="13" fill="#EAF0FA"/><path d="M28 80v-7q0-14 17-14t17 14v7Z" fill="#8496CB"/><circle cx="45" cy="45" r="13" fill="#ADBBE1"/><path d="M74 41h17M74 53h12" stroke="#BAC5D9" stroke-width="5" stroke-linecap="round"/><circle cx="85" cy="88" r="23" fill="#3D6573"/><circle cx="82" cy="84" r="23" fill="#EBC578"/><path d="M72 84h20m-5 0v7m5-7v5" stroke="#FFF5D8" stroke-width="6" stroke-linecap="round"/><circle cx="71" cy="84" r="7" fill="#EBC578" stroke="#FFF5D8" stroke-width="5"/>`,
  },
  character: {
    background: '#7460CD',
    art: `<ellipse cx="66" cy="109" rx="36" ry="7" fill="#54439B"/>
      <path d="M32 70h66v24q0 13-15 13H47q-15 0-15-13Z" fill="#F1AC83"/>
      <path d="M80 70h18v24q0 13-15 13h-8q9-8 5-37" fill="#CD7E67"/>
      <rect x="40" y="98" width="15" height="13" rx="5" fill="#34324E"/><rect x="76" y="98" width="15" height="13" rx="5" fill="#34324E"/>
      <path d="M25 50 27 27q1-8 9-4l16 9q13-4 25 0l15-9q8-4 9 4l3 23v24q0 20-22 20H48q-23 0-23-20Z" fill="#574399"/>
      <path d="M21 44 23 22q1-8 9-4l16 10q14-5 26 0l16-10q8-4 9 4l2 22v24q0 20-22 20H44q-23 0-23-20Z" fill="#F4EBFF"/>
      <path d="m29 28 2 15 12-7Zm62 0-13 8 12 7Z" fill="#C4A3E7"/>
      <rect x="40" y="49" width="8" height="14" rx="4" fill="#38334F"/><rect x="74" y="49" width="8" height="14" rx="4" fill="#38334F"/>
      <ellipse cx="35" cy="68" rx="7" ry="4" fill="#EDB0B4"/><ellipse cx="88" cy="68" rx="7" ry="4" fill="#EDB0B4"/>
      <path d="M53 69q8 9 16 0" fill="none" stroke="#78608D" stroke-width="4" stroke-linecap="round"/>
      <path d="m109 39 3 8 8 3-8 3-3 8-3-8-8-3 8-3Z" fill="#FFE9A3"/>`,
  },
  space: {
    background: '#45968C',
    art: `<path d="m18 95 50 23 45-25-51-22Z" fill="#2C706B"/>
      <path d="M18 37 62 16l48 23v52L65 113 18 90Z" fill="#DBE9D2"/>
      <path d="m62 16 48 23v52L62 69Z" fill="#A9C9AF"/>
      <path d="m18 90 44-21 48 22-45 22Z" fill="#F4DEAE"/>
      <path d="m18 90 47 23v6L18 96Zm47 23 45-22v6l-45 22Z" fill="#BDAC88"/>
      <path d="m27 39 26-12v29L27 68Z" fill="#F8F6DC"/><path d="m31 41 18-8v20l-18 9Z" fill="#80C6C7"/>
      <path d="M40 38v20m-9-7 18-8" stroke="#F8F6DC" stroke-width="3"/>
      <path d="m28 73 26-12 27 13-26 13Z" fill="#B6A0D9"/><path d="m28 73 27 14v14L28 87Z" fill="#7961A6"/><path d="m55 87 26-13v14l-26 13Z" fill="#9477BE"/>
      <path d="m28 66 25-12 4 7-26 12Zm31 16 25-12 3 7-25 12Z" fill="#D4C2ED"/>
      <path d="m83 70 13-7 11 6-13 7Z" fill="#FFEFCA"/><path d="m94 76 13-7v6l-13 7Zm-11-6 11 6v6l-11-6Z" fill="#BA9472"/>
      <path d="m86 42 11 5v16l-11-5Z" fill="#435B67"/><path d="m89 47 5 2v8l-5-2Z" fill="#C2E8D9"/>
      <path d="M78 32v13" stroke="#488065" stroke-width="4"/><ellipse cx="74" cy="31" rx="7" ry="4" fill="#E3EDBB"/><ellipse cx="82" cy="26" rx="4" ry="7" fill="#D4E59D"/>`,
  },
  writing: {
    background: '#628ECA',
    art: `<path d="M31 24h63v85H31Z" fill="#41679C"/><rect x="24" y="17" width="65" height="87" rx="9" fill="#FFF4D9"/><path d="M24 26q0-9 9-9h5v87H24Z" fill="#B6D5EB"/><path d="M48 39h28M48 52h28M48 65h19" stroke="#9EA4B9" stroke-width="5" stroke-linecap="round"/><path d="m75 94 22-55 13 5-22 55-14 9Z" fill="#B68143"/><path d="m70 90 22-55 13 5-22 55-14 9Z" fill="#F5BF58"/><path d="m92 35 3-8q2-5 8-3l5 2q5 2 3 7l-3 8Z" fill="#EA9595"/><path d="m69 104 1-14 13 5Z" fill="#FFF1D0"/><path d="m69 104 1-7 6 3Z" fill="#414863"/>`,
  },
  code: {
    background: '#414E72',
    art: `<rect x="20" y="31" width="95" height="76" rx="13" fill="#293652"/><rect x="13" y="23" width="95" height="76" rx="13" fill="#E2E8F5"/><path d="M13 49h95v38q0 12-13 12H26q-13 0-13-12Z" fill="#60769E"/><circle cx="27" cy="36" r="4" fill="#EF9B91"/><circle cx="40" cy="36" r="4" fill="#F4D488"/><circle cx="53" cy="36" r="4" fill="#82C9B1"/><path d="m39 60-13 13 13 13m43-26 13 13-13 13m-14-28-11 32" fill="none" stroke="#E1FAEE" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  design: {
    background: '#D98276',
    art: `<path d="M67 24c-35 0-51 22-46 50s36 40 59 26c12-8-7-19 2-25 9-7 28 1 27-17-1-20-19-34-42-34Z" fill="#AC605E"/><path d="M61 17c-35 0-51 22-46 50s36 40 59 26c12-8-7-19 2-25 9-7 28 1 27-17-1-20-19-34-42-34Z" fill="#FFF0D1"/><circle cx="32" cy="50" r="9" fill="#7D6AC2"/><circle cx="51" cy="34" r="8" fill="#7CB9AA"/><circle cx="76" cy="37" r="8" fill="#ECB95F"/><circle cx="34" cy="76" r="8" fill="#E59D9D"/><path d="m61 101 31-51 9 6-29 53Z" fill="#4C5472"/><path d="m93 48 10-15q4-6 9-2t1 10l-10 14Z" fill="#A6D4D0"/><path d="M61 100q-16 0-12 17 8-8 18-8Z" fill="#FFF0D1"/>`,
  },
  data: {
    background: '#708266',
    art: `<rect x="23" y="26" width="90" height="81" rx="12" fill="#4F6552"/><rect x="15" y="18" width="90" height="81" rx="12" fill="#F5EDD5"/><path d="M29 38h28" stroke="#B9BCA3" stroke-width="5" stroke-linecap="round"/><rect x="29" y="62" width="13" height="22" rx="3" fill="#DEA078"/><rect x="50" y="51" width="13" height="33" rx="3" fill="#9E8AC7"/><rect x="71" y="35" width="16" height="49" rx="3" fill="#69A59A"/><path d="M76 42h6v7h-6Z" fill="#AEE1C4"/>`,
  },
  research: {
    background: '#BD9952',
    art: `<rect x="20" y="19" width="62" height="84" rx="9" fill="#EEDDAD"/><path d="M30 35h27M30 48h27M30 61h18" stroke="#AE956A" stroke-width="5" stroke-linecap="round"/><path d="m85 85 22 24" stroke="#72597D" stroke-width="16" stroke-linecap="round"/><circle cx="72" cy="68" r="30" fill="#6C567B"/><circle cx="69" cy="64" r="27" fill="#B6D8D7"/><circle cx="69" cy="64" r="20" fill="#E4F0E7"/><path d="M57 56q4-8 13-7" fill="none" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round"/>`,
  },
  toolkit: {
    background: '#6C96A5',
    art: `<rect x="21" y="51" width="92" height="56" rx="10" fill="#477282"/><path d="M44 43V31q0-9 9-9h25q9 0 9 9v12" fill="none" stroke="#EEDCBA" stroke-width="9"/><rect x="14" y="41" width="92" height="59" rx="10" fill="#ECAA7D"/><path d="M14 60h92v9q-45 14-92 0Z" fill="#F7C794"/><rect x="51" y="62" width="18" height="18" rx="4" fill="#FFF1CF"/><path d="M26 49h22" stroke="#FFDBB1" stroke-width="4" stroke-linecap="round"/>`,
  },
};

function renderIcon({background,art}, marker='') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"${marker}><rect width="128" height="128" rx="28" fill="${background}"/><path d="M28 2h72q25 0 26 25v8q-4-26-28-26H30Q8 9 2 35v-7Q2 2 28 2Z" fill="#FFFFFF" opacity=".16"/>${art}</svg>`;
}
// Exact byte matching only: never replace artwork provided or edited by a user.
const legacyIcons = new Set(['character','space','writing','code','design','data','research','toolkit'].map(subject=>renderIcon(artwork[subject])));
const hues={billing:32,account:224,character:267,space:170,writing:209,code:231,design:12,data:148,research:39,toolkit:195,presentation:267,image:170,video:340,audio:248,calendar:201,translation:155,security:217,chat:220,web:205,automation:182,identity:260};
function nameHash(name){
  let hash=2166136261;for(const c of name)hash=Math.imul(hash^c.codePointAt(0),16777619)>>>0;
  return hash;
}
function backgroundFor(subject,hash){
  const hue=(hues[subject]+hash%49-24+360)%360;
  return `hsl(${hue} ${28+(hash>>>8)%13}% ${42+(hash>>>16)%11}%)`;
}
export function isLegacyGeneratedSkillIcon(svg,name=''){
  if(legacyIcons.has(svg))return true;
  if(!name||!svg.includes('data-wanwu-generated="2"'))return false;
  const hash=nameHash(name);
  return ['billing','account','character','space','writing','code','design','data','research','toolkit'].some(subject=>
    svg===renderIcon({...artwork[subject],background:backgroundFor(subject,hash)},' data-wanwu-generated="2"'));
}
function identityArt(hash){
  // No semantic match: make a stable geometric identity instead of a shared briefcase.
  const colors=['#FFF1D6','#A8D7CC','#E8B87A','#D1BDE8'];
  return [[18,18],[67,18],[18,67],[67,67]].map(([x,y],i)=>{
    const variant=(hash>>>(i*6))&3,color=colors[((hash>>>(i*6+2))&3)];
    const dx=((hash>>>(i*6+4))&1)*3,dy=((hash>>>(i*6+5))&1)*3;
    const shape=variant===0?`<circle cx="20" cy="20" r="19" fill="${color}"/><circle cx="20" cy="20" r="8" fill="#4C4C71"/>`:
      variant===1?`<rect width="40" height="40" rx="10" fill="${color}"/><path d="M10 20h20" stroke="#4C4C71" stroke-width="6" stroke-linecap="round"/>`:
      variant===2?`<path d="m20 0 20 20-20 20L0 20Z" fill="${color}"/>`:
      `<path d="M0 0h40v19q0 21-21 21H0Z" fill="${color}"/>`;
    return `<g transform="translate(${x+dx} ${y+dy})"><rect x="3" y="4" width="40" height="40" rx="11" fill="#4C4C71"/>${shape}</g>`;
  }).join('');
}
export function generatedSkillIcon(name, description = '') {
  // Preserve the bundled identities independently of future category changes.
  if(isOfficialSkill(name))return renderIcon(artwork[{
    'office-character-studio':'character','office-space-designer':'space',
    'announcement-designer':'design','wanwu-skills-sync':'toolkit','wanwu-canvas':'toolkit',
  }[name]]);
  const hash=nameHash(name),subject=skillIconSubject(name,description);
  const drawing=subject==='identity'?{art:identityArt(hash)}:artwork[subject];
  return renderIcon({...drawing,background:backgroundFor(subject,hash)},' data-wanwu-generated="3"');
}
