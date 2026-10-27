import {createHash} from 'node:crypto';
export function textQuestionId(commandId,itemId){const h=createHash('sha256').update(JSON.stringify(['wanwu-text-question',commandId,itemId])).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;}
