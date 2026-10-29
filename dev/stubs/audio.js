/**
 * Core Stub: audio.js
 * Stand-in for Person A's /core/audio.js (Frozen API)
 * DO NOT MOVE TO /core - Keep in /dev/stubs until merge.
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

  /**
   * Plays a synthesized beep tone.
   */
  beep(options = {}) {
    const ctx = this._getAudioContext();
    if (!ctx) return;

    const freq = options.frequency || 659.25; // E5
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
    } catch (e) {
      // Audio autoplay policy or context error
    }
  }

  /**
   * Speaks out loud using Web Speech API synthesis.
   * If not supported or quiet mode, emits a friendly chime.
   * @param {string} text
   */
  speak(text) {
    if (this.speechSynthesis) {
      try {
        this.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.05;
        utterance.pitch = 1.0;
        this.speechSynthesis.speak(utterance);
        return;
      } catch (e) {
        // Fallback to chime
      }
    }
    this.beep({ frequency: 523.25, duration: 0.2, type: 'triangle' });
  }

  /**
   * Accelerating ticking sequence for Hot Potato.
   * Interval gradually drops from 1000ms down to 80ms as time counts down.
   */
  startAcceleratingBeeps({ totalDurationMs = 15000, onTick = () => {}, onComplete = () => {} }) {
    this.stopTicking();

    const startTime = Date.now();
    const minInterval = 90;
    const maxInterval = 1000;

    const scheduleNext = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(1.0, elapsed / totalDurationMs);

      if (progress >= 1.0) {
        this.beep({ frequency: 880, duration: 0.4, type: 'sawtooth', volume: 0.4 });
        onComplete();
        return;
      }

      // Linear interpolation to accelerating speed
      const currentInterval = maxInterval - (maxInterval - minInterval) * Math.pow(progress, 1.6);

      // Pitch also increases slightly towards the end for suspense!
      const freq = 440 + progress * 440;
      this.beep({ frequency: freq, duration: 0.08, type: 'sine', volume: 0.2 + progress * 0.2 });
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
