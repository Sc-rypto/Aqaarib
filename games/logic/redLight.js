/**
 * Aqaarib Motion Engine - Red Light Game Logic
 * Evaluates motion thresholds, vertical lanes, grace periods, and finish crossing.
 */

export const LIGHT_STATES = {
  GREEN: 'GREEN',
  YELLOW: 'YELLOW',
  RED: 'RED'
};

export function calculateThresholds(calibration) {
  const noiseFloor = Math.max(0, calibration?.noiseFloor || 0.01);
  const walkingSpeed = Math.max(noiseFloor, calibration?.walkingSpeed || 0.1);

  const rawRed = Math.max(3 * noiseFloor, 0.08 * walkingSpeed);
  const rawYellow = 0.40 * walkingSpeed;

  return {
    noiseFloor: Number(noiseFloor.toFixed(4)),
    walkingSpeed: Number(walkingSpeed.toFixed(4)),
    redLimit: Number(rawRed.toFixed(4)),
    yellowCap: Number(rawYellow.toFixed(4))
  };
}

export function getLaneBoundaries(numLanes = 3) {
  const count = Math.min(4, Math.max(2, Math.floor(numLanes)));
  const lanes = [];
  const width = 1.0 / count;

  for (let i = 0; i < count; i++) {
    const minX = i * width;
    const maxX = (i + 1) * width;
    lanes.push({
      index: i + 1,
      minX,
      maxX,
      centerX: (minX + maxX) / 2
    });
  }
  return lanes;
}

export function getLaneForX(torsoX, numLanes = 3) {
  const count = Math.min(4, Math.max(2, Math.floor(numLanes)));
  const clamped = Math.max(0, Math.min(0.9999, torsoX));
  return Math.floor(clamped * count) + 1;
}

export function isInsideLane(torsoX, assignedLane, numLanes = 3, padding = 0.02) {
  const lanes = getLaneBoundaries(numLanes);
  const lane = lanes.find(l => l.index === assignedLane);
  if (!lane) return false;
  return torsoX >= (lane.minX - padding) && torsoX <= (lane.maxX + padding);
}

export function checkMidHipFinish(landmarks, finishLineY = 0.80, boundingBox = null, torsoCenter = null) {
  // 1. Check MediaPipe mid-hip landmarks if present
  if (landmarks && landmarks.length >= 25) {
    const leftHip = landmarks[23];
    const rightHip = landmarks[24];
    if (leftHip && rightHip && leftHip.y !== undefined && rightHip.y !== undefined) {
      const midHipY = (leftHip.y + rightHip.y) / 2;
      if (midHipY >= finishLineY) return true;
    }
  }

  // 2. Check torso center if available (torso center is anatomically higher than hips by ~0.10)
  if (torsoCenter && torsoCenter.y !== undefined && torsoCenter.y !== null) {
    if (torsoCenter.y >= finishLineY - 0.10) return true;
  }

  // 3. Check bounding box lower boundary (person has advanced to finish line)
  if (boundingBox && boundingBox.y !== undefined && boundingBox.height !== undefined) {
    const bottomY = boundingBox.y + boundingBox.height;
    if (bottomY >= finishLineY) return true;
    if (boundingBox.height >= 0.70 && boundingBox.y >= 0.08) return true;
  }

  return false;
}

export function generatePlainReason({ playerName, type, light, motion, limit, durationSec }) {
  if (type === 'STRIKE_RED_MOTION') {
    const ratio = limit > 0 ? (motion / limit).toFixed(1) : '3';
    return `${playerName} kept moving during Red, about ${ratio} times over the limit`;
  }
  if (type === 'STRIKE_YELLOW_SPEED') {
    const ratio = limit > 0 ? (motion / limit).toFixed(1) : '1.5';
    return `${playerName} exceeded the Yellow slow-motion speed cap (${ratio}x cap)`;
  }
  if (type === 'STRIKE_LANE_VIOLATION') {
    const dur = durationSec ? durationSec.toFixed(2) : '0.4';
    return `${playerName} strayed outside assigned lane for ${dur} seconds`;
  }
  if (type === 'OUT_OF_GAME') {
    return `${playerName} received 3 strikes and is out for this round`;
  }
  if (type === 'FINISH') {
    return `${playerName} crossed the finish line!`;
  }
  return `${playerName} triggered an event`;
}

export function calculateScores(finishOrder = [], strikesMap = {}, allPlayerIds = []) {
  const scores = {};
  const rankPoints = [3, 2, 1, 0];

  allPlayerIds.forEach(id => {
    scores[id] = 0;
  });

  finishOrder.forEach((id, index) => {
    const basePts = index < rankPoints.length ? rankPoints[index] : 0;
    const strikes = strikesMap[id] || 0;
    scores[id] = Math.max(0, basePts - strikes);
  });

  return scores;
}

export class RedLightJudge {
  constructor(config = {}) {
    this.numLanes = config.numLanes || 3;
    this.finishLineY = config.finishLineY !== undefined ? config.finishLineY : 0.80;
    this.gracePeriodMs = config.gracePeriodMs !== undefined ? config.gracePeriodMs : 500;
    this.consecutiveFramesRequired = config.consecutiveFramesRequired || 3;
    this.laneViolationMsThreshold = config.laneViolationMsThreshold || 400;

    const thresholds = calculateThresholds(config.calibration || {});
    this.redLimit = thresholds.redLimit;
    this.yellowCap = thresholds.yellowCap;

    this.playerStates = {};
    this.finishOrder = [];
    this.events = [];
  }

  _getPlayerState(playerId, playerName, assignedLane) {
    if (!this.playerStates[playerId]) {
      this.playerStates[playerId] = {
        id: playerId,
        name: playerName || `Player ${playerId}`,
        assignedLane: assignedLane || 1,
        strikes: 0,
        isOut: false,
        hasFinished: false,
        finishRank: null,
        consecutiveViolationFrames: 0,
        violationType: null,
        outOfLaneStartTimeMs: null,
        lastSeenTimeMs: null
      };
    }
    return this.playerStates[playerId];
  }

  evaluateFrame(frame) {
    const { timestampMs, currentLight, lightChangeTimeMs, players } = frame;
    const timeSinceLightChange = timestampMs - lightChangeTimeMs;
    const inGracePeriod = timeSinceLightChange >= 0 && timeSinceLightChange < this.gracePeriodMs;

    const newStrikes = [];
    const newFinishes = [];
    const newEvents = [];

    for (const playerInput of players) {
      const state = this._getPlayerState(
        playerInput.id,
        playerInput.name,
        playerInput.assignedLane
      );

      if (state.isOut || state.hasFinished) continue;

      if (!playerInput.isDetected) {
        state.consecutiveViolationFrames = 0;
        state.violationType = null;
        state.outOfLaneStartTimeMs = null;
        continue;
      }

      state.lastSeenTimeMs = timestampMs;

      // 1. Check Finish Line (hips, torso center, or bounding box)
      if (checkMidHipFinish(playerInput.landmarks, this.finishLineY, playerInput.boundingBox, playerInput.torsoCenter)) {
        state.hasFinished = true;
        this.finishOrder.push(state.id);
        state.finishRank = this.finishOrder.length;

        const reason = generatePlainReason({
          playerName: state.name,
          type: 'FINISH'
        });
        const finishEvent = {
          type: 'FINISH',
          playerId: state.id,
          playerName: state.name,
          rank: state.finishRank,
          timestampMs,
          reason
        };
        newFinishes.push(finishEvent);
        newEvents.push(finishEvent);
        this.events.push(finishEvent);
        continue;
      }

      // 2. Check Lane Violation (> 0.4s consecutive duration)
      const inLane = isInsideLane(
        playerInput.torsoCenter?.x ?? 0.5,
        state.assignedLane,
        this.numLanes
      );

      if (!inLane) {
        if (state.outOfLaneStartTimeMs === null) {
          state.outOfLaneStartTimeMs = timestampMs;
        } else {
          const outDuration = timestampMs - state.outOfLaneStartTimeMs;
          if (outDuration >= this.laneViolationMsThreshold) {
            state.strikes += 1;
            state.outOfLaneStartTimeMs = null;
            const reason = generatePlainReason({
              playerName: state.name,
              type: 'STRIKE_LANE_VIOLATION',
              durationSec: outDuration / 1000
            });
            const strikeEvent = {
              type: 'STRIKE',
              subType: 'LANE_VIOLATION',
              playerId: state.id,
              playerName: state.name,
              strikes: state.strikes,
              timestampMs,
              reason
            };
            newStrikes.push(strikeEvent);
            newEvents.push(strikeEvent);
            this.events.push(strikeEvent);

            if (state.strikes >= 3) {
              state.isOut = true;
              const outEvent = {
                type: 'OUT',
                playerId: state.id,
                playerName: state.name,
                timestampMs,
                reason: generatePlainReason({ playerName: state.name, type: 'OUT_OF_GAME' })
              };
              newEvents.push(outEvent);
              this.events.push(outEvent);
            }
          }
        }
      } else {
        state.outOfLaneStartTimeMs = null;
      }

      // 3. Motion Judging during Red / Yellow
      if (inGracePeriod) {
        state.consecutiveViolationFrames = 0;
        state.violationType = null;
        continue;
      }

      let frameHasViolation = false;
      let currentViolationType = null;
      const motion = playerInput.motion || 0;

      if (currentLight === LIGHT_STATES.RED) {
        if (motion > this.redLimit) {
          frameHasViolation = true;
          currentViolationType = 'STRIKE_RED_MOTION';
        }
      } else if (currentLight === LIGHT_STATES.YELLOW) {
        if (motion > this.yellowCap) {
          frameHasViolation = true;
          currentViolationType = 'STRIKE_YELLOW_SPEED';
        }
      }

      if (frameHasViolation) {
        if (state.violationType === currentViolationType) {
          state.consecutiveViolationFrames += 1;
        } else {
          state.violationType = currentViolationType;
          state.consecutiveViolationFrames = 1;
        }

        if (state.consecutiveViolationFrames >= this.consecutiveFramesRequired) {
          state.strikes += 1;
          state.consecutiveViolationFrames = 0;
          state.violationType = null;

          const limit = currentLight === LIGHT_STATES.RED ? this.redLimit : this.yellowCap;
          const reason = generatePlainReason({
            playerName: state.name,
            type: currentViolationType,
            light: currentLight,
            motion,
            limit
          });

          const strikeEvent = {
            type: 'STRIKE',
            subType: currentViolationType,
            playerId: state.id,
            playerName: state.name,
            strikes: state.strikes,
            motion,
            limit,
            timestampMs,
            reason
          };
          newStrikes.push(strikeEvent);
          newEvents.push(strikeEvent);
          this.events.push(strikeEvent);

          if (state.strikes >= 3) {
            state.isOut = true;
            const outEvent = {
              type: 'OUT',
              playerId: state.id,
              playerName: state.name,
              timestampMs,
              reason: generatePlainReason({ playerName: state.name, type: 'OUT_OF_GAME' })
            };
            newEvents.push(outEvent);
            this.events.push(outEvent);
          }
        }
      } else {
        state.consecutiveViolationFrames = 0;
        state.violationType = null;
      }
    }

    const strikesMap = {};
    const allIds = Object.keys(this.playerStates);
    allIds.forEach(id => {
      strikesMap[id] = this.playerStates[id].strikes;
    });

    const scores = calculateScores(this.finishOrder, strikesMap, allIds);

    return {
      newStrikes,
      newFinishes,
      newEvents,
      playerStates: { ...this.playerStates },
      finishOrder: [...this.finishOrder],
      scores
    };
  }
}
