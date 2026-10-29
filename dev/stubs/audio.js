/**
 * Aqaarib Audio Engine
 * High-fidelity synthesis for game tones, ticking countdowns, and voice briefing.
 */

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.tickingTimer = null;
    this.speechSynthesis = typeof window !== 'undefined' ? window.speechSynthesis : null;
  }

  _getAudioContext() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  beep(options = {}) {
    const ctx = this._getAudioContext();
    if (!ctx) return;

    const freq = options.frequency || 659.25;
    const duration = options.duration || 0.12;
    const type = options.type || 'sine';
    const volume = options.volume !== undefined ? options.volume : 0.25;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);

      gain.gain.setValueAtTime(volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (e) {}
  }

  /**
   * Speaks narration text clearly using browser speech synthesis.
   * Resolves a Promise when speaking ends.
   */
  speak(text) {
    return new Promise((resolve) => {
      if (this.speechSynthesis) {
        try {
          this.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.rate = 1.0;
          utterance.pitch = 1.0;
          utterance.onend = () => resolve();
          utterance.onerror = () => resolve();
          this.speechSynthesis.speak(utterance);
          return;
        } catch (e) {}
      }
      this.beep({ frequency: 523.25, duration: 0.2, type: 'triangle' });
      resolve();
    });
  }

  /**
   * Fast accelerating ticking sequence for Hot Potato.
   */
  startAcceleratingBeeps({ totalDurationMs = 8000, onTick = () => {}, onComplete = () => {} }) {
    this.stopTicking();

    const startTime = Date.now();
    const minInterval = 75;
    const maxInterval = 850;

    const scheduleNext = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(1.0, elapsed / totalDurationMs);

      if (progress >= 1.0) {
        this.beep({ frequency: 880, duration: 0.45, type: 'sawtooth', volume: 0.4 });
        onComplete();
        return;
      }

      const currentInterval = maxInterval - (maxInterval - minInterval) * Math.pow(progress, 1.8);
      const freq = 440 + progress * 520;
      this.beep({ frequency: freq, duration: 0.07, type: 'sine', volume: 0.2 + progress * 0.25 });
      onTick(Math.round(totalDurationMs - elapsed));

      this.tickingTimer = setTimeout(scheduleNext, Math.max(minInterval, currentInterval));
    };

    scheduleNext();
  }

  stopTicking() {
    if (this.tickingTimer) {
      clearTimeout(this.tickingTimer);
      this.tickingTimer = null;
    }
  }

  stopAll() {
    this.stopTicking();
    if (this.speechSynthesis) {
      try {
        this.speechSynthesis.cancel();
      } catch (e) {}
    }
  }
}

export const soundEngine = new SoundEngine();
export const audio = soundEngine;
