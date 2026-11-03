export const DEFAULT_NAS_HTTP_PORT = 54758;

// Limit automatic LAN services to numeric private IPv4 destinations.
export function privateLanIp(ip) {
 if(typeof ip!=='string')return false;
 const bytes=ip.split('.');
 if(bytes.length!==4||bytes.some(b=>!/^\d{1,3}$/.test(b)||String(Number(b))!==b||Number(b)>255))return false;
 const [a,b]=bytes.map(Number);
 return a===10||a===172&&b>=16&&b<=31||a===192&&b===168;
}
export function lanUrl(value){
 try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&privateLanIp(u.hostname)&&!u.username&&!u.password&&!u.search&&!u.hash?u:null;}catch{return null;}
}
