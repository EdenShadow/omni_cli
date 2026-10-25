import path from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
export const dshHome=()=>process.env.DSH_HOME||path.join(homedir(),'.dsh');
export const dshHostPlugin=()=>fileURLToPath(new URL('./dsh-host-plugin.mjs',import.meta.url));
export const bundledNode=()=>{throw Error('Omni CLI does not bundle an AI runtime');};
