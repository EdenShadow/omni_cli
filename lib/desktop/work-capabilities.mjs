import {accessSync,constants,statSync} from 'node:fs';
import path from 'node:path';
import {runtimePath} from './runtimes.mjs';
// Probe executable presence only. Tool names are data, never shell commands;
// no install, login, arbitrary --version script or credentials are involved.
export function inspectTools(names){
 return names.map(name=>{
  if(!/^[A-Za-z0-9][A-Za-z0-9_.+-]{0,63}$/.test(name))throw Error('Invalid tool name');
  const extensions=process.platform==='win32'?['','.exe','.cmd','.bat']:[''];
  const available=runtimePath().split(path.delimiter).filter(Boolean).some(dir=>extensions.some(ext=>{try{const file=path.join(dir,name+ext);accessSync(file,constants.X_OK);return statSync(file).isFile();}catch{return false;}}));
  return {name,available};
 });
}
