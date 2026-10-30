import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

// Invoke npm's JS entry directly so Windows does not need a shell for npm.cmd.
export function runNpm(args,options={}) {
 const entry=[process.env.npm_execpath,path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js')]
  .find(file=>file&&file.endsWith('.js')&&fs.existsSync(file));
 if(entry)return execFileSync(process.execPath,[entry,...args],options);
 if(process.platform==='win32')throw Error('Run this command with npm run so the npm CLI entry can be located');
 return execFileSync('npm',args,options);
}
