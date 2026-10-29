/**
 * Game Loop Runner
 * /core/loop.js
 *
 * Contract: runLoop(fn, fps) returns a stop function. fn receives time in seconds.
 */

export function runLoop(fn, fps = 15) {
  let isRunning = true;
  const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const targetIntervalMs = 1000 / Math.max(1, fps);
  let lastFrameTime = startTime;
  let handle = null;

  function tick() {
    if (!isRunning) return;

    const currentTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const elapsedSinceLast = currentTime - lastFrameTime;

    if (elapsedSinceLast >= targetIntervalMs) {
      lastFrameTime = currentTime - (elapsedSinceLast % targetIntervalMs);
      const timeInSeconds = Number(((currentTime - startTime) / 1000).toFixed(2));
      try {
        fn(timeInSeconds);
      } catch (err) {
        console.error('Error in game loop tick:', err);
      }
    }

    if (isRunning) {
      if (typeof requestAnimationFrame !== 'undefined') {
        handle = requestAnimationFrame(tick);
      } else {
        handle = setTimeout(tick, Math.max(5, targetIntervalMs / 2));
      }
    }
  }

  if (typeof requestAnimationFrame !== 'undefined') {
    handle = requestAnimationFrame(tick);
  } else {
    handle = setTimeout(tick, 0);
  }

  return function stop() {
    isRunning = false;
    if (handle !== null) {
      if (typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(handle);
      } else {
        clearTimeout(handle);
      }
      handle = null;
    }
  };
}
