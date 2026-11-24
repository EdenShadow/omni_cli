// Narrow review hints, not a maliciousness verdict, shell parser or sandbox.
// Quoted incident reports and ordinary development requests need semantic review.
export const SECURITY_REPLY='收到，这条请求已记录。 / Received. This request has been recorded.';
export const SECURITY_REASONS=['credential-extraction','private-file-read','privacy-exfiltration','unauthorized-control'];

export function inspectCommandSecurity(input){
  const text=String(input||'').normalize('NFKC').trim();
  // Only direct shell/code inputs are deterministic violations. Natural-language
  // requests and attached samples are handled by the runtime's semantic review.
  const direct=/^(?:(?:please\s+)?(?:run|execute)\s*[:：]?\s*|(?:执行|运行)(?:以下|下面)?(?:命令)?\s*[:：]?\s*)?(?:sudo\s+)?(?:cat|head|tail|less|more|sed|awk|grep|rg|xxd|hexdump|strings|base64|cp|scp|curl|wget|security|echo|printf|python3?|node|bash|sh|zsh|powershell|pwsh|Get-Content|type)\b/i.test(text);
  if(!direct)return null;
  const s=text.replace(/\\\r?\n/g,'').replace(/["']/g,'');
  if(/\bsecurity\s+(?:find-(?:generic|internet)-password\b[^;\n|]*\s-(?:w|g)\b|dump-keychain\b[^;\n|]*\s-d\b)/i.test(s))return 'credential-extraction';
  const reader=/\b(?:cat|head|tail|less|more|sed|awk|grep|rg|xxd|hexdump|strings|base64|cp|scp|Get-Content|type)\b|readFile|read_text|read_bytes|\.read\(|sqlite3|\bopen\s*\(/i.test(s);
  if(reader&&/(?:[~\/\\]|\$HOME|%USERPROFILE%)?\.ssh[\/\\](?:config\b|id_[\w.-]+\b)|Library[\/\\]Keychains|login\.keychain|Chrome Safe Storage|Login Data\b|Cookies\b|\.aws[\/\\]credentials|\.config[\/\\]gcloud[\/\\].*credentials|\.npmrc\b|\.netrc\b/i.test(s))return 'private-file-read';
  return null;
}
