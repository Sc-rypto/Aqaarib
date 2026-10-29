import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPointInBusZone,
  evaluateBoardingStep,
  evaluatePassengerHeadcount,
  calculateBusTournamentScores,
  BUS_SIGNALS
} from '../games/logic/busCount.js';

test('isPointInBusZone evaluates 2D rectangle accurately', () => {
  const zone = { x: 0.35, y: 0.20, w: 0.50, h: 0.60 };

  assert.equal(isPointInBusZone({ x: 0.40, y: 0.30 }, zone), true);
  assert.equal(isPointInBusZone({ x: 0.20, y: 0.30 }, zone), false);
  assert.equal(isPointInBusZone({ x: 0.50, y: 0.90 }, zone), false);
});

test('evaluateBoardingStep awards point during green signal', () => {
  const player = { id: 'p1', name: 'Sara' };
  const res = evaluateBoardingStep({
    player,
    prevX: 0.25,
    currentX: 0.45,
    doorLineX: 0.35,
    signal: BUS_SIGNALS.GREEN,
    timestampSec: 4.2
  });

  assert.equal(res.eventType, 'BOARD_SAFE');
  assert.equal(res.points, 1);
  assert.equal(res.reason, 'Sara boarded the bus on time. One point scored.');
  // Friendly referee rules: no emojis and no dashes used as punctuation
  assert.equal(/[-–—]/.test(res.reason), false);
  assert.equal(/[\u{1F300}-\u{1F9FF}]/u.test(res.reason), false);
});

test('evaluateBoardingStep penalizes boarding during red signal', () => {
  const player = { id: 'p2', name: 'Omar' };
  const res = evaluateBoardingStep({
    player,
    prevX: 0.25,
    currentX: 0.40,
    doorLineX: 0.35,
    signal: BUS_SIGNALS.RED,
    timestampSec: 9.0
  });

  assert.equal(res.eventType, 'BOARD_FOUL');
  assert.equal(res.points, -1);
  assert.equal(res.reason, 'Omar crossed after the doors closed. Boarding foul called.');
  assert.equal(/[-–—]/.test(res.reason), false);
});

test('evaluatePassengerHeadcount counts players inside passenger zone', () => {
  const zone = { x: 0.3, y: 0.1, w: 0.6, h: 0.8 };
  const detected = [
    { torsoCenter: { x: 0.4, y: 0.5 }, playerId: 'p1' },
    { torsoCenter: { x: 0.7, y: 0.6 }, playerId: 'p2' },
    { torsoCenter: { x: 0.1, y: 0.5 }, playerId: 'p3' } // outside
  ];

  const headcount = evaluatePassengerHeadcount({ detectedPeople: detected, busZone: zone });
  assert.equal(headcount.count, 2);
  assert.deepEqual(headcount.passengerIds, ['p1', 'p2']);
});

test('calculateBusTournamentScores awards win to team with most points', () => {
  const players = [
    { id: 'p1', name: 'Sara', team: 'A' },
    { id: 'p2', name: 'Omar', team: 'B' }
  ];
  const events = [
    { player: 'p1', team: 'A', points: 1 },
    { player: 'p1', team: 'A', points: 1 },
    { player: 'p2', team: 'B', points: 1 }
  ];

  const result = calculateBusTournamentScores({ events, players, mode: 'team' });
  assert.equal(result.teamScores.A, 2);
  assert.equal(result.teamScores.B, 1);
  assert.equal(result.winner.kind, 'team');
  assert.equal(result.winner.id, 'A');
});
