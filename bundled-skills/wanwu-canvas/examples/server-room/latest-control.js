// For replaceable steering / aiming samples. Send one-shot actions independently.
globalThis.createLatestControl = function createLatestControl(send, onError) {
 let epoch = 0, busy = false, pending;
 async function flush() {
  if (busy || pending === undefined) return;
  const value = pending, started = epoch;
  pending = undefined;
  busy = true;
  try { await send(value); }
  catch (error) { if (started === epoch) onError(error); }
  finally {
   if (started === epoch) {
    busy = false;
    if (pending !== undefined) void flush();
   }
  }
 }
 return {
  offer(value) { pending = value; void flush(); },
  reset() { epoch++; pending = undefined; busy = false; }
 };
};
