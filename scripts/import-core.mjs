// Maintainer tool: copy the reviewed, headless protocol dependency graph only.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const source=path.resolve(process.argv[2]||'../wanwu_ai');
const target=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
function transform(name,s){
  if(name==='desktop/bridge.mjs'){
    s=s.slice(0,s.indexOf('  async generate({'))+s.slice(s.indexOf('  stop() {'));
    for(const module of ['builtin-runtime','remote-desktop','creation-models','creation-jobs','assets'])s=s.replace(new RegExp('^import .*?[\x27\x22]\\./'+module+'\\.mjs[\x27\x22];\\r?\\n','gm'),'');
    for(const module of ['character-actions','prop-animation','device-appearance','office-floorplan','office-furnishing','prop-interactions','project-scene','default-characters','character-context'])s=s.replace(new RegExp('^import .*?[\x27\x22]\\.\\./shared/'+module+'\\.mjs[\x27\x22];\\r?\\n','gm'),'');
    s=s.replace(/^.*this\.remoteDesktop.*\r?\n/gm,'').replace(/^.*this\.builtinRuntime.*\r?\n/gm,'').replace(/^.*this\.creations =.*\r?\n/gm,'');
    // Remove the built-in branch in its entirety, leaving only installed providers.
    s=s.replace("this.adapters[provider] = provider==='wanwu'\n",'');
    s=s.replace(/this\.adapters\[provider\] = provider==='wanwu'\r?\n\s*: provider==='dsh'/,"this.adapters[provider] = provider==='dsh'");
    s=s.replace(/\s*: provider==='dsh' \? new DshAdapter/,"\n      this.adapters[provider] = provider==='dsh' ? new DshAdapter");
    s=s.replace(",'remote-desktop-v1'",'');
    s=s.replace('this.skills = new DesktopSkills(this);',"this.skills = new DesktopSkills(this,{detect:()=>detectRuntimes().filter(r=>this.store.device?.runtimes?.includes(r.provider))});");
    s=s.replace('name: hostname(),','name: this.store.deviceName || hostname(),');
  }
  if(name==='shared/providers.mjs')s=s.replace("'wanwu',",'');
  if(name==='desktop/runtimes.mjs'){
    s=s.replace(/^import \{bundledDshEntry\}.*\r?\n/m,'');
    s=s.replace(/return \[\{provider:'wanwu'.*?\.\.\.\["codex", "claude", "dsh"\]/,'return ["codex", "claude", "dsh"]');
    s=s.replace('  })];','  });');
    s=s.replace('"announcement-designer", "wanwu-skills-sync"','"announcement-designer", "wanwu-skills-sync", "wanwu-canvas"');
  }
  if(name==='desktop/dsh-paths.mjs')return `import path from 'node:path';\nimport {homedir} from 'node:os';\nimport {fileURLToPath} from 'node:url';\nexport const dshHome=()=>process.env.DSH_HOME||path.join(homedir(),'.dsh');\nexport const dshHostPlugin=()=>fileURLToPath(new URL('./dsh-host-plugin.mjs',import.meta.url));\nexport const bundledNode=()=>{throw Error('Omni CLI does not bundle an AI runtime');};\n`;
  if(name==='desktop/canvas-capture.mjs')return "export async function captureCanvas(){throw Error('Headless CLI cannot render canvas covers; upload a generated cover with canvas APIs instead.');}\n";
  if(name==='desktop/skills/exchange.mjs')s=s.replace('canvasCapture:!!result.capabilities.canvas','canvasCapture:false');
  if(name==='desktop/skills/runtime-discovery.mjs')s=s.replace("!PROVIDERS.includes(body.provider)","(!PROVIDERS.includes(body.provider)||!b.store.device.runtimes.includes(body.provider))");
  return s;
}
const seen=new Set(),external=new Set();
function copy(name){
  name=name.replaceAll('\\','/');if(seen.has(name))return;seen.add(name);
  if(!/^(desktop|shared)\//.test(name)||name.includes('..'))throw Error('Outside core: '+name);
  const s=transform(name,fs.readFileSync(path.join(source,name),'utf8'));
  const dest=path.join(target,'lib',name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,s);
  for(const match of s.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)['"]([^'"]+)['"]/g)){
    const ref=match[1];if(ref.startsWith('.'))copy(path.posix.normalize(path.posix.join(path.posix.dirname(name),ref)));else if(!ref.startsWith('node:')&&/^[@\w/-]+$/.test(ref))external.add(ref);
  }
}
copy('desktop/bridge.mjs');copy('desktop/dsh-host-plugin.mjs');
for(const name of ['announcement-designer','office-character-studio','office-space-designer','wanwu-canvas','wanwu-skills-sync'])fs.cpSync(path.join(source,'bundled-skills',name),path.join(target,'bundled-skills',name),{recursive:true,filter:p=>!p.includes('__pycache__')&&!p.endsWith('.pyc')});
// Let pending HTTP handles close normally; forced exit can crash libuv on Windows.
for(const name of ['wanwu-skills-sync/scripts/sync.mjs','wanwu-canvas/scripts/canvas.mjs']){
  const file=path.join(target,'bundled-skills',name);
  const s=fs.readFileSync(file,'utf8').replace(/^try\{/m,'async function main(){\ntry{').replace('process.exit(0);','return;');
  fs.writeFileSync(file,s+'\n}\nawait main();\n');
}
for(const name of ['office-character-studio/scripts/validate_character.py','wanwu-canvas/references/protocol.md']){
  const file=path.join(target,'bundled-skills',name);fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace(/[\t ]+$/gm,'').trimEnd()+'\n');
}
fs.writeFileSync(path.join(target,'CORE_SOURCE.json'),JSON.stringify({repository:'EdenShadow/wanwu_ai',commit:execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim(),modules:[...seen].sort(),dependencies:[...external].sort()},null,2)+'\n');
console.log(JSON.stringify({modules:seen.size,dependencies:[...external]}));
