// Snapshot and render timestamps are milliseconds. Payloads must be immutable.
globalThis.createRoomMotion = function createRoomMotion({intervalMs, maxPredictMs = 100}) {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0 || !Number.isFinite(maxPredictMs) || maxPredictMs < 0) {
    throw new RangeError('Invalid snapshot timing');
  }

  const frames = [];
  let cursor, lastFrame, epoch;
  let jitter = 0;

  function reset() {
    frames.length = 0;
    cursor = undefined;
    lastFrame = undefined;
    jitter = 0;
  }

  function push(time, state, arrival, generation) {
    if (!Number.isFinite(time) || !Number.isFinite(arrival)) return false;
    if (epoch !== generation) {
      reset();
      epoch = generation;
    }
    const previous = frames.at(-1);
    if (previous && time < previous.time) return false;
    if (previous && (arrival - previous.arrival > 1500 || time - previous.time > 1500)) {
      reset();
    } else if (previous) {
      if (time === previous.time) {
        frames[frames.length - 1] = {...previous, state};
        return true;
      }
      const variation = Math.abs((arrival - previous.arrival) - (time - previous.time));
      jitter += (Math.min(250, variation) - jitter) * 0.15;
    }
    frames.push({time, state, arrival});
    if (frames.length > 32) frames.shift();
    return true;
  }

  function sample(now) {
    const newest = frames.at(-1);
    if (!newest || !Number.isFinite(now)) return null;
    const delayMs = Math.min(350, intervalMs * 1.5 + jitter * 2);
    const desired = newest.time + Math.max(0, now - newest.arrival) - delayMs;
    const elapsed = now - lastFrame;
    if (cursor === undefined || elapsed > 500) {
      cursor = desired;
    } else {
      const step = Math.max(0, elapsed);
      const correction = Math.max(-0.12, Math.min(0.12, (desired - cursor - step) / 400));
      cursor += step * (1 + correction);
    }
    lastFrame = now;
    cursor = Math.min(cursor, newest.time + maxPredictMs);
    const time = Math.max(frames[0].time, cursor);
    while (frames.length > 1 && frames[1].time <= time) frames.shift();
    const from = frames[0], to = frames[1] || from;
    const t = from === to ? 0 : (time - from.time) / (to.time - from.time);
    return {from, to, t, time, predictionMs: Math.max(0, time - newest.time), delayMs};
  }

  return {push, sample, reset};
};
