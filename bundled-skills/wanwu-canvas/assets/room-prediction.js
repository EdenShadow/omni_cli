// Create one instance per connection and controlled entity. State and inputs
// are immutable; step is a pure simulation step with no rendering or network I/O.
globalThis.createRoomPrediction = function createRoomPrediction({step, maxPending = 32}) {
  if (typeof step !== 'function' || !Number.isSafeInteger(maxPending) || maxPending < 1 || maxPending > 256) {
    throw new TypeError('Invalid prediction settings');
  }

  let state, lastSnapshot = -1, lastProcessed = 0, nextSeq = 0;
  let droppedThrough = 0;
  const pending = [];

  function reconcile({sequence, processedSeq, authoritative}) {
    if (!Number.isSafeInteger(sequence) || sequence <= lastSnapshot ||
        !Number.isSafeInteger(processedSeq) || processedSeq < lastProcessed) return false;
    lastSnapshot = sequence;
    lastProcessed = processedSeq;
    nextSeq = Math.max(nextSeq, processedSeq);
    while (pending.length && pending[0].seq <= processedSeq) pending.shift();
    state = authoritative;
    if (processedSeq >= droppedThrough) {
      for (const command of pending) state = step(state, command.input);
    }
    return true;
  }

  function issue(input) {
    if (lastSnapshot < 0) throw new Error('Wait for the first authoritative snapshot');
    const command = {seq: ++nextSeq, input};
    pending.push(command);
    if (pending.length > maxPending) {
      droppedThrough = pending.shift().seq;
      // Freeze at the last predicted pose until the next authoritative frame.
    } else if (lastProcessed >= droppedThrough) {
      state = step(state, input);
    }
    return command;
  }

  return {issue, reconcile, get state() { return state; }};
};
