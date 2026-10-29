/**
 * Aqaarib Vision Engine - Scale-Invariant Motion Metrics
 * Measures joint displacement normalized by shoulder width.
 */

export const MOTION_KEYPOINT_INDICES = [11, 12, 15, 16, 23, 24, 27, 28];

export function calculateRawMotion(prevLandmarks, currLandmarks) {
  if (!prevLandmarks || !currLandmarks) return 0;
  if (prevLandmarks.length < 29 || currLandmarks.length < 29) return 0;

  const l11 = currLandmarks[11];
  const l12 = currLandmarks[12];
  let shoulderWidth = Math.hypot(l11.x - l12.x, l11.y - l12.y);

  if (shoulderWidth < 0.02) {
    const l23 = currLandmarks[23];
    const l24 = currLandmarks[24];
    shoulderWidth = Math.hypot(l23.x - l24.x, l23.y - l24.y);
  }

  const scale = Math.max(0.04, shoulderWidth);

  let totalDisplacement = 0;
  let validPoints = 0;

  for (const idx of MOTION_KEYPOINT_INDICES) {
    const p1 = prevLandmarks[idx];
    const p2 = currLandmarks[idx];
    if (p1 && p2) {
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      totalDisplacement += dist;
      validPoints++;
    }
  }

  if (validPoints === 0) return 0;

  const meanDisplacement = totalDisplacement / validPoints;
  const score = meanDisplacement / scale;
  return Number(score.toFixed(4));
}

export class MotionTracker {
  constructor(options = {}) {
    this.windowSize = options.windowSize || 4;
    this.playerHistories = new Map();
  }

  update(playerId, currentLandmarks) {
    if (!currentLandmarks) return 0;

    let history = this.playerHistories.get(playerId);
    if (!history) {
      history = {
        lastLandmarks: currentLandmarks,
        samples: []
      };
      this.playerHistories.set(playerId, history);
      return 0;
    }

    const rawScore = calculateRawMotion(history.lastLandmarks, currentLandmarks);
    history.lastLandmarks = currentLandmarks;

    history.samples.push(rawScore);
    if (history.samples.length > this.windowSize) {
      history.samples.shift();
    }

    const sum = history.samples.reduce((acc, v) => acc + v, 0);
    const smoothed = sum / history.samples.length;
    return Number(smoothed.toFixed(4));
  }

  reset(playerId = null) {
    if (playerId !== null) {
      this.playerHistories.delete(playerId);
    } else {
      this.playerHistories.clear();
    }
  }
}

export async function calibrate(options = {}) {
  const { getLandmarks = () => null, onProgress = () => {} } = options;
  const tracker = new MotionTracker({ windowSize: 3 });

  // Phase 1: Stand Still for 3 seconds
  const stillSamples = [];
  const stillDurationMs = 3000;
  const stillStart = Date.now();

  while (Date.now() - stillStart < stillDurationMs) {
    const lms = getLandmarks();
    if (lms) {
      const motion = tracker.update('calib', lms);
      stillSamples.push(motion);
      const remainingSec = Math.ceil((stillDurationMs - (Date.now() - stillStart)) / 1000);
      onProgress({ phase: 'STILL', secondsLeft: remainingSec, currentMotion: motion });
    }
    await new Promise(r => setTimeout(r, 66));
  }

  // Phase 2: Walk Normally for 3 seconds
  tracker.reset();
  const walkSamples = [];
  const walkDurationMs = 3000;
  const walkStart = Date.now();

  while (Date.now() - walkStart < walkDurationMs) {
    const lms = getLandmarks();
    if (lms) {
      const motion = tracker.update('calib', lms);
      walkSamples.push(motion);
      const remainingSec = Math.ceil((walkDurationMs - (Date.now() - walkStart)) / 1000);
      onProgress({ phase: 'WALKING', secondsLeft: remainingSec, currentMotion: motion });
    }
    await new Promise(r => setTimeout(r, 66));
  }

  let noiseFloor = 0.02;
  if (stillSamples.length > 5) {
    const sorted = [...stillSamples].sort((a, b) => a - b);
    const idx = Math.floor(sorted.length * 0.85);
    noiseFloor = Math.max(0.01, sorted[idx]);
  }

  let walkingSpeed = 0.25;
  if (walkSamples.length > 5) {
    const sorted = [...walkSamples].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    walkingSpeed = Math.max(noiseFloor * 2.5, sorted[mid]);
  }

  return {
    noiseFloor: Number(noiseFloor.toFixed(4)),
    walkingSpeed: Number(walkingSpeed.toFixed(4))
  };
}

export const motionTracker = new MotionTracker();
