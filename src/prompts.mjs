import {createInterface} from 'node:readline/promises';
import {emitKeypressEvents} from 'node:readline';
export async function ask(label,fallback=''){
  if(!process.stdin.isTTY)throw Error('Interactive setup requires a terminal');
  const rl=createInterface({input:process.stdin,output:process.stdout});
  try{return (await rl.question(label+(fallback?` [${fallback}]`:'')+': ')).trim()||fallback;}finally{rl.close();}
}
export function password(){
  if(!process.stdin.isTTY)throw Error('Enter the password in an interactive terminal; command-line passwords are not accepted');
  process.stdout.write('密码 / Password (hidden): ');
  emitKeypressEvents(process.stdin);const prior=process.stdin.isRaw;process.stdin.setRawMode(true);process.stdin.resume();
  return new Promise((resolve,reject)=>{
    let value='';
    const done=(error)=>{process.stdin.removeListener('keypress',onKey);process.stdin.setRawMode(!!prior);process.stdin.pause();process.stdout.write('\n');error?reject(error):resolve(value);value='';};
    const onKey=(text,key={})=>{
      if(key.ctrl&&key.name==='c')return done(Error('Cancelled'));
      if(key.name==='return')return done();
      if(key.name==='backspace'){value=Array.from(value).slice(0,-1).join('');return;}
      if(text&&!key.ctrl&&!key.meta&&!/[\x00-\x1f\x7f]/.test(text))value+=text;
    };
    process.stdin.on('keypress',onKey);
  });
}
