// Opt in from the actual user request, never from an assistant's tool output.
export function requestsImageChatDelivery(prompt) {
  const text=String(prompt||'').trim();
  if(/(?:不要|别|不必|无需|不能|不要自动).{0,12}(?:发|分享)|\b(?:do not|don't|never|without)\s+(?:send|post|shar)/iu.test(text))return false;
  return /(?:生成|画|制作|绘制)|\b(?:generate|create|draw|make)\b/iu.test(text)
    && /(?:发(?:送)?|分享)(?:一下|出去)?(?:到|至|进|在|给)?(?:当前|这个|本项目|项目|团队|我们)?(?:的)?(?:群聊|群里|群中)|\b(?:send|post|share)\b.{0,60}\b(?:to|in|with)\s+(?:(?:the|our|this|current)\s+)?(?:group|team)(?:\s+chat)?\b/iu.test(text);
}

export function generatedImageEvent(event) {
  return event?.kind==='tool'&&event.status==='completed'
    &&(event.activity==='imageGeneration'||event.activity==='commandExecution'&&String(event.text).includes('--output'));
}
