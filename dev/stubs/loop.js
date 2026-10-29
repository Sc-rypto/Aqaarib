/**
 * Core Stub: loop.js
 * Stand-in for Person A's /core/loop.js (Frozen API)
 * DO NOT MOVE TO /core - Keep in /dev/stubs until merge.
 */

export class GameLoop {
  constructor(options = {}) {
    this.updateFn = options.update || (() => {});
    this.renderFn = options.render || (() => {});
    this.fps = options.fps || 15;
    this.frameInterval = 1000 / this.fps;

    this.rafId = null;
    this.lastVisionTime = 0;
    this.active = false;
  }

  setFps(fps) {
    this.fps = fps;
    this.frameInterval = 1000 / fps;
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.lastVisionTime = performance.now();

    const loop = (now) => {
      if (!this.active) return;

      // Render at screen refresh rate
      this.renderFn(now);

      // Throttle heavy vision inference to specified FPS (e.g. 15 fps)
      const elapsed = now - this.lastVisionTime;
      if (elapsed >= this.frameInterval) {
        this.lastVisionTime = now - (elapsed % this.frameInterval);
        try {
          this.updateFn(now);
        } catch (err) {
          console.error('Error during loop update step:', err);
        }
      }

      this.rafId = requestAnimationFrame(loop);
    };

    this.rafId = requestAnimationFrame(loop);
  }

  stop() {
    this.active = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  isRunning() {
    return this.active;
  }
}

export function createLoop(options) {
  return new GameLoop(options);
}
