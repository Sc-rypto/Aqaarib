import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIGHT_STATES,
  calculateThresholds,
  getLaneBoundaries,
  isInsideLane,
  checkMidHipFinish,
  calculateScores,
  generatePlainReason,
  RedLightJudge
} from '../games/logic/redLight.js';

describe('Red Light Logic - Unit Tests', () => {
  test('calculateThresholds applies 3*noiseFloor or 8% walking speed', () => {
    // Case 1: 3 * noiseFloor is larger
    const t1 = calculateThresholds({ noiseFloor: 0.05, walkingSpeed: 0.5 });
    // 3 * 0.05 = 0.15; 0.08 * 0.5 = 0.04 -> redLimit should be 0.15
    assert.equal(t1.redLimit, 0.15);
    assert.equal(t1.yellowCap, 0.20); // 0.4 * 0.5

    // Case 2: 8% walking speed is larger
    const t2 = calculateThresholds({ noiseFloor: 0.01, walkingSpeed: 1.0 });
    // 3 * 0.01 = 0.03; 0.08 * 1.0 = 0.08 -> redLimit should be 0.08
    assert.equal(t2.redLimit, 0.08);
    assert.equal(t2.yellowCap, 0.40);
  });

  test('Lane boundaries divide space cleanly for 2 to 4 lanes', () => {
    const lanes3 = getLaneBoundaries(3);
    assert.equal(lanes3.length, 3);
    assert.equal(lanes3[0].minX, 0);
    assert.equal(lanes3[0].maxX.toFixed(2), '0.33');
    assert.equal(lanes3[1].minX.toFixed(2), '0.33');
    assert.equal(lanes3[2].maxX, 1.0);

    // Test inside lane with padding
    assert.equal(isInsideLane(0.15, 1, 3), true);
    assert.equal(isInsideLane(0.50, 1, 3), false); // Clearly outside lane 1
    assert.equal(isInsideLane(0.50, 2, 3), true);  // Inside lane 2
  });

  test('Finish line triggers when mid hip height is >= finishLineY', () => {
    // MediaPipe landmarks: 23 = left_hip, 24 = right_hip
    const mockLandmarksBefore = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5 }));
    mockLandmarksBefore[23] = { x: 0.48, y: 0.75 };
    mockLandmarksBefore[24] = { x: 0.52, y: 0.77 }; // avg = 0.76 < 0.80
    assert.equal(checkMidHipFinish(mockLandmarksBefore, 0.80), false);

    const mockLandmarksAfter = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5 }));
    mockLandmarksAfter[23] = { x: 0.48, y: 0.81 };
    mockLandmarksAfter[24] = { x: 0.52, y: 0.83 }; // avg = 0.82 >= 0.80
    assert.equal(checkMidHipFinish(mockLandmarksAfter, 0.80), true);
  });

  test('Scoring calculates finish rank minus strikes, never below 0', () => {
    const finishOrder = ['p1', 'p2', 'p3', 'p4'];
    const strikes = { p1: 1, p2: 0, p3: 2, p4: 3 };
    const allPlayers = ['p1', 'p2', 'p3', 'p4'];

    const scores = calculateScores(finishOrder, strikes, allPlayers);
    // p1: 1st (3 pts) - 1 strike = 2
    assert.equal(scores.p1, 2);
    // p2: 2nd (2 pts) - 0 strikes = 2
    assert.equal(scores.p2, 2);
    // p3: 3rd (1 pt) - 2 strikes = max(0, -1) = 0
    assert.equal(scores.p3, 0);
    // p4: 4th (0 pts) - 3 strikes = 0
    assert.equal(scores.p4, 0);
  });

  test('RedLightJudge: Grace period suppresses motion violations for 0.5s', () => {
    const judge = new RedLightJudge({
      calibration: { noiseFloor: 0.02, walkingSpeed: 0.5 },
      gracePeriodMs: 500
    });

    const lightChangeTime = 1000;

    // Frame at 1200ms (within 500ms grace period) with excessive motion on RED
    const res = judge.evaluateFrame({
      timestampMs: 1200,
      currentLight: LIGHT_STATES.RED,
      lightChangeTimeMs: lightChangeTime,
      players: [
        {
          id: 'player1',
          name: 'Sara',
          assignedLane: 1,
          isDetected: true,
          torsoCenter: { x: 0.16, y: 0.5 },
          motion: 0.99, // very high motion
          landmarks: []
        }
      ]
    });

    assert.equal(res.newStrikes.length, 0, 'No strike during grace period');
    assert.equal(judge.playerStates['player1'].consecutiveViolationFrames, 0);
  });

  test('RedLightJudge: Violation requires 3 consecutive frames to issue a strike', () => {
    const judge = new RedLightJudge({
      calibration: { noiseFloor: 0.02, walkingSpeed: 0.5 },
      gracePeriodMs: 500,
      consecutiveFramesRequired: 3
    });

    const lightChangeTime = 1000;

    // Frame 1 past grace (t = 1600): Motion violation frame 1
    judge.evaluateFrame({
      timestampMs: 1600,
      currentLight: LIGHT_STATES.RED,
      lightChangeTimeMs: lightChangeTime,
      players: [{ id: 'p1', name: 'Sara', assignedLane: 1, isDetected: true, torsoCenter: { x: 0.16, y: 0.5 }, motion: 0.5 }]
    });
    assert.equal(judge.playerStates['p1'].strikes, 0);
    assert.equal(judge.playerStates['p1'].consecutiveViolationFrames, 1);

    // Frame 2 (t = 1666): Motion violation frame 2
    judge.evaluateFrame({
      timestampMs: 1666,
      currentLight: LIGHT_STATES.RED,
      lightChangeTimeMs: lightChangeTime,
      players: [{ id: 'p1', name: 'Sara', assignedLane: 1, isDetected: true, torsoCenter: { x: 0.16, y: 0.5 }, motion: 0.5 }]
    });
    assert.equal(judge.playerStates['p1'].strikes, 0);
    assert.equal(judge.playerStates['p1'].consecutiveViolationFrames, 2);

    // Frame 3 (t = 1733): Motion violation frame 3 -> Strike!
    const res3 = judge.evaluateFrame({
      timestampMs: 1733,
      currentLight: LIGHT_STATES.RED,
      lightChangeTimeMs: lightChangeTime,
      players: [{ id: 'p1', name: 'Sara', assignedLane: 1, isDetected: true, torsoCenter: { x: 0.16, y: 0.5 }, motion: 0.5 }]
    });
    assert.equal(res3.newStrikes.length, 1);
    assert.equal(judge.playerStates['p1'].strikes, 1);
    assert.match(res3.newStrikes[0].reason, /Sara kept moving during Red/);
  });

  test('RedLightJudge: Lost detection resets consecutive violation count (never punished)', () => {
    const judge = new RedLightJudge({
      calibration: { noiseFloor: 0.02, walkingSpeed: 0.5 },
      gracePeriodMs: 500
    });

    const lightChangeTime = 1000;

    // Frame 1 & 2: 2 violations
    judge.evaluateFrame({
      timestampMs: 1600,
      currentLight: LIGHT_STATES.RED,
      lightChangeTimeMs: lightChangeTime,
      players: [{ id: 'p1', name: 'Sara', assignedLane: 1, isDetected: true, torsoCenter: { x: 0.16, y: 0.5 }, motion: 0.5 }]
    });
    judge.evaluateFrame({
      timestampMs: 1666,
      currentLight: LIGHT_STATES.RED,
      lightChangeTimeMs: lightChangeTime,
      players: [{ id: 'p1', name: 'Sara', assignedLane: 1, isDetected: true, torsoCenter: { x: 0.16, y: 0.5 }, motion: 0.5 }]
    });
    assert.equal(judge.playerStates['p1'].consecutiveViolationFrames, 2);

    // Frame 3: Lost detection!
    judge.evaluateFrame({
      timestampMs: 1733,
      currentLight: LIGHT_STATES.RED,
      lightChangeTimeMs: lightChangeTime,
      players: [{ id: 'p1', name: 'Sara', assignedLane: 1, isDetected: false }]
    });
    assert.equal(judge.playerStates['p1'].consecutiveViolationFrames, 0, 'Consecutive violations reset on lost detection');
    assert.equal(judge.playerStates['p1'].strikes, 0, 'No strike issued');
  });

  test('RedLightJudge: Lane violation triggers strike when out of lane for > 0.4s', () => {
    const judge = new RedLightJudge({
      numLanes: 3,
      laneViolationMsThreshold: 400
    });

    // Lane 1 range is approx [0, 0.33]. Torso at 0.65 is clearly in lane 2.
    // t = 1000: first detected out of lane
    judge.evaluateFrame({
      timestampMs: 1000,
      currentLight: LIGHT_STATES.GREEN,
      lightChangeTimeMs: 500,
      players: [{ id: 'p1', name: 'Sara', assignedLane: 1, isDetected: true, torsoCenter: { x: 0.65, y: 0.5 }, motion: 0.1 }]
    });
    assert.equal(judge.playerStates['p1'].strikes, 0);

    // t = 1300: 300ms out of lane (< 400ms threshold)
    judge.evaluateFrame({
      timestampMs: 1300,
      currentLight: LIGHT_STATES.GREEN,
      lightChangeTimeMs: 500,
      players: [{ id: 'p1', name: 'Sara', assignedLane: 1, isDetected: true, torsoCenter: { x: 0.65, y: 0.5 }, motion: 0.1 }]
    });
    assert.equal(judge.playerStates['p1'].strikes, 0);

    // t = 1450: 450ms out of lane (>= 400ms) -> Lane Strike!
    const res = judge.evaluateFrame({
      timestampMs: 1450,
      currentLight: LIGHT_STATES.GREEN,
      lightChangeTimeMs: 500,
      players: [{ id: 'p1', name: 'Sara', assignedLane: 1, isDetected: true, torsoCenter: { x: 0.65, y: 0.5 }, motion: 0.1 }]
    });
    assert.equal(res.newStrikes.length, 1);
    assert.equal(judge.playerStates['p1'].strikes, 1);
    assert.match(res.newStrikes[0].reason, /strayed outside assigned lane/);
  });

  test('RedLightJudge: 3 strikes marks player OUT', () => {
    const judge = new RedLightJudge({
      calibration: { noiseFloor: 0.01, walkingSpeed: 0.5 },
      gracePeriodMs: 0,
      consecutiveFramesRequired: 1
    });

    const triggerStrike = (t) => judge.evaluateFrame({
      timestampMs: t,
      currentLight: LIGHT_STATES.RED,
      lightChangeTimeMs: 0,
      players: [{ id: 'p1', name: 'Sara', assignedLane: 1, isDetected: true, torsoCenter: { x: 0.16, y: 0.5 }, motion: 0.9 }]
    });

    triggerStrike(100);
    assert.equal(judge.playerStates['p1'].strikes, 1);
    assert.equal(judge.playerStates['p1'].isOut, false);

    triggerStrike(200);
    assert.equal(judge.playerStates['p1'].strikes, 2);
    assert.equal(judge.playerStates['p1'].isOut, false);

    const res = triggerStrike(300);
    assert.equal(judge.playerStates['p1'].strikes, 3);
    assert.equal(judge.playerStates['p1'].isOut, true);
    assert.ok(res.newEvents.some(e => e.type === 'OUT'));
  });
});
