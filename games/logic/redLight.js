/**
 * Red Light, Green Light - Pure Game Logic
 * Person B Implementation
 *
 * Rules:
 * - Green: walk
 * - Yellow: slow motion only (cap = 40% walking speed)
 * - Red: freeze (limit = max(3 * noiseFloor, 8% walking speed))
 * - Grace: 0.5s after any light change
 * - Violations must persist for 3 consecutive frames
 * - Lost detection is never punished
 * - Lane violation: torso center outside lane for > 0.4s
 * - 3 strikes = OUT
 * - Finish line: mid-hip height >= finishLineY (default 0.80)
 * - Points: 3, 2, 1, 0 minus 1 per strike (min 0)
 */

export const LIGHT_STATES = {
  GREEN: 'GREEN',
  YELLOW: 'YELLOW',
  RED: 'RED'
};

/**
 * Calculates Red and Yellow thresholds from calibration results.
 * @param {Object} calibration - { noiseFloor, walkingSpeed }
 * @returns {Object} - { redLimit, yellowCap }
 */
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

/**
 * Returns lane boundaries for 2 to 4 lanes dividing [0, 1].
 * @param {number} numLanes - 2, 3, or 4
 * @returns {Array<{ index: number, minX: number, maxX: number, centerX: number }>}
 */
export function getLaneBoundaries(numLanes = 3) {
  const count = Math.min(4, Math.max(2, Math.floor(numLanes)));
  const lanes = [];
  const width = 1.0 / count;

  for (let i = 0; i < count; i++) {
    const minX = i * width;
    const maxX = (i + 1) * width;
    lanes.push({
      index: i + 1, // 1-based index
      minX,
      maxX,
      centerX: (minX + maxX) / 2
    });
  }
  return lanes;
}

/**
 * Determines which lane an x coordinate belongs to.
 * @param {number} torsoX - Normalized x [0, 1]
 * @param {number} numLanes - Number of lanes
 * @returns {number} 1-based lane index
 */
export function getLaneForX(torsoX, numLanes = 3) {
  const count = Math.min(4, Math.max(2, Math.floor(numLanes)));
  const clamped = Math.max(0, Math.min(0.9999, torsoX));
  return Math.floor(clamped * count) + 1;
}

/**
 * Checks if a player's torso center is within their assigned lane.
 * Includes a small forgiving padding (default 2% of screen width).
 * @param {number} torsoX
 * @param {number} assignedLane - 1-based index
 * @param {number} numLanes
 * @param {number} padding - Normalized margin
 * @returns {boolean}
 */
export function isInsideLane(torsoX, assignedLane, numLanes = 3, padding = 0.02) {
  const lanes = getLaneBoundaries(numLanes);
  const lane = lanes.find(l => l.index === assignedLane);
  if (!lane) return false;
  return torsoX >= (lane.minX - padding) && torsoX <= (lane.maxX + padding);
}

/**
 * Checks if a player's mid-hip height has crossed the finish line.
 * MediaPipe landmarks: 23 = left_hip, 24 = right_hip.
 * Normalized y goes 0.0 (top) to 1.0 (bottom).
 * Crossing finish line means hip y >= finishLineY.
 * @param {Array<{ x: number, y: number }>} landmarks
 * @param {number} finishLineY - default 0.80
 * @returns {boolean}
 */
export function checkMidHipFinish(landmarks, finishLineY = 0.80) {
  if (!landmarks || landmarks.length < 25) return false;
  const leftHip = landmarks[23];
  const rightHip = landmarks[24];
  if (!leftHip || !rightHip) return false;

  const midHipY = (leftHip.y + rightHip.y) / 2;
  return midHipY >= finishLineY;
}

/**
 * Generates humanized plain reason for events.
 */
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

/**
 * Calculates final scores based on finish order and strikes.
 * Finishing order points: 1st: 3, 2nd: 2, 3rd: 1, 4th: 0.
 * Minus 1 per strike, never below 0.
 * @param {Array<string>} finishOrder - Player IDs in order of finish
 * @param {Object} strikesMap - { [playerId]: strikeCount }
 * @param {Array<string>} allPlayerIds - All registered player IDs
 * @returns {Object} - { [playerId]: score }
 */
export function calculateScores(finishOrder = [], strikesMap = {}, allPlayerIds = []) {
  const scores = {};
  const rankPoints = [3, 2, 1, 0];

  // Initialize all players with 0
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

/**
 * Pure Game Judge State Machine for Red Light.
 * Tracks per-player consecutive frames, lane exit duration, strikes, and finish status.
 */
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

  /**
   * Initializes or gets state for a player.
   */
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

  /**
   * Evaluates one frame of game state.
   * @param {Object} frame
   *   - timestampMs: Current frame timestamp in ms
   *   - currentLight: 'GREEN' | 'YELLOW' | 'RED'
   *   - lightChangeTimeMs: Timestamp when current light was turned on
   *   - players: Array of {
   *       id: string,
   *       name: string,
   *       assignedLane: number,
   *       isDetected: boolean,
   *       landmarks: Array<{x, y}>,
   *       torsoCenter: {x, y},
   *       motion: number
   *     }
   * @returns {Object} { strikes: Array, finishes: Array, events: Array, scores: Object }
   */
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

      // Skip already eliminated or finished players
      if (state.isOut || state.hasFinished) continue;

      // RULE: "a briefly lost detection is never punished"
      if (!playerInput.isDetected) {
        state.consecutiveViolationFrames = 0;
        state.violationType = null;
        state.outOfLaneStartTimeMs = null;
        continue;
      }

      state.lastSeenTimeMs = timestampMs;

      // 1. Check Finish Line
      if (checkMidHipFinish(playerInput.landmarks, this.finishLineY)) {
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
            // Lane Strike
            state.strikes += 1;
            state.outOfLaneStartTimeMs = null; // reset after strike
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
        // Player is back inside their lane, reset lane timer
        state.outOfLaneStartTimeMs = null;
      }

      // 3. Motion Judging during Red / Yellow (Skip during grace period)
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

        // RULE: "A violation must last 3 consecutive frames to count"
        if (state.consecutiveViolationFrames >= this.consecutiveFramesRequired) {
          state.strikes += 1;
          state.consecutiveViolationFrames = 0; // reset counter after strike issued
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
        // Reset consecutive violation counter when within legal movement bounds
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
