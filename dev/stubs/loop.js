/**
 * Aqaarib Engine - Loop Runner
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

      this.renderFn(now);

      const elapsed = now - this.lastVisionTime;
      if (elapsed >= this.frameInterval) {
        this.lastVisionTime = now - (elapsed % this.frameInterval);
        try {
          this.updateFn(now);
        } catch (err) {
          console.error('Loop update error:', err);
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
