export const TEXT_PREVIEW_BYTES=1024*1024;
export function isTextPreview(name,mime='') {
 return /\.(txt|md|markdown|json|jsonl|ndjson|csv|tsv|log|yaml|yml|toml|ini|conf|xml|html?|css|scss|js|mjs|cjs|jsx|ts|tsx|py|sh|sql|svg)$/i.test(name)||/^text\//i.test(mime)||/^application\/(?:json|[\w.+-]+\+json|xml|[\w.+-]+\+xml|javascript)(?:;|$)/i.test(mime);
}
export function decodeTextPreview(bytes,name,truncated=false) {
 let encoding='utf-8';if(bytes[0]===255&&bytes[1]===254)encoding='utf-16le';else if(bytes[0]===254&&bytes[1]===255)encoding='utf-16be';
 const decoder=new TextDecoder(encoding,{fatal:true});let text;
 try{text=decoder.decode(bytes,{stream:truncated});}catch{throw Error('TEXT_ENCODING');}
 if(/[\u0000-\u0008\u000e-\u001f]/.test(text))throw Error('TEXT_BINARY');
 let formatted=false;
 if(!truncated&&/\.json$/i.test(name)){try{const pretty=JSON.stringify(JSON.parse(text),null,2);if(pretty.length<=TEXT_PREVIEW_BYTES*2){text=pretty;formatted=true;}}catch{/* Invalid or incomplete JSON stays readable as original text. */}}
 return {text,truncated,formatted};
}
// Bound memory even when a server ignores Range; abort the remaining body.
export async function readTextResponse(response,name) {
 if(!response.ok)throw Error(`HTTP ${response.status}`);
 const reader=response.body?.getReader();if(!reader)throw Error('TEXT_UNAVAILABLE');
 const chunks=[];let size=0,truncated=false;
 try{while(size<=TEXT_PREVIEW_BYTES){const {value,done}=await reader.read();if(done)break;const part=value.subarray(0,TEXT_PREVIEW_BYTES+1-size);chunks.push(part);size+=part.length;if(size>TEXT_PREVIEW_BYTES){truncated=true;break;}}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const total=Number(response.headers.get('content-range')?.match(/\/(\d+)$/)?.[1]||response.headers.get('content-length'));
 truncated ||= total>TEXT_PREVIEW_BYTES;
 const bytes=new Uint8Array(Math.min(size,TEXT_PREVIEW_BYTES));let offset=0;
 for(const part of chunks){const kept=part.subarray(0,bytes.length-offset);bytes.set(kept,offset);offset+=kept.length;}
 return decodeTextPreview(bytes,name,truncated);
}
