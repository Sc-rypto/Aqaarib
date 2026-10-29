import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  POTATO_MODES,
  isPersonVisible,
  isPointInZone,
  matchPeopleToPlayers,
  judgeFramePure,
  calculateHotPotatoTournamentScores,
  generateHotPotatoReason
} from '../games/logic/hotPotato.js';

describe('Hot Potato Logic - Unit Tests', () => {
  test('isPersonVisible requires at least 4 shoulder/hip landmarks OR a detected face', () => {
    // 1. With face detected -> always visible
    assert.equal(isPersonVisible([], true), true);

    // 2. Mock 33 landmarks: 11, 12 = shoulders, 23, 24 = hips
    const makeLandmarks = (visibles) => {
      const arr = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.1 }));
      visibles.forEach(idx => {
        arr[idx] = { x: 0.5, y: 0.5, visibility: 0.9 };
      });
      return arr;
    };

    // 3 keypoints visible (not enough)
    const lms3 = makeLandmarks([11, 12, 23]);
    assert.equal(isPersonVisible(lms3, false, 0.5), false);

    // 4 keypoints visible (both shoulders & both hips)
    const lms4 = makeLandmarks([11, 12, 23, 24]);
    assert.equal(isPersonVisible(lms4, false, 0.5), true);
  });

  test('isPointInZone correctly evaluates 2D bounding rectangle', () => {
    const zone = { x: 0.2, y: 0.2, width: 0.4, height: 0.4 }; // [0.2 -> 0.6, 0.2 -> 0.6]

    assert.equal(isPointInZone({ x: 0.3, y: 0.4 }, zone), true);
    assert.equal(isPointInZone({ x: 0.15, y: 0.4 }, zone), false); // to the left
    assert.equal(isPointInZone({ x: 0.5, y: 0.7 }, zone), false);  // below
  });

  test('matchPeopleToPlayers matches recognized face to nearest person', () => {
    const enrolled = [
      { id: 'p1', name: 'Omar' },
      { id: 'p2', name: 'Sara' }
    ];

    const detectedPeople = [
      {
        id: 0,
        torsoCenter: { x: 0.2, y: 0.5 },
        landmarks: [{ x: 0.2, y: 0.2 }], // head near x: 0.2
        boundingBox: { x: 0.1, y: 0.1, width: 0.2, height: 0.8 }
      },
      {
        id: 1,
        torsoCenter: { x: 0.7, y: 0.5 },
        landmarks: [{ x: 0.7, y: 0.2 }], // head near x: 0.7
        boundingBox: { x: 0.6, y: 0.1, width: 0.2, height: 0.8 }
      }
    ];

    const detectedFaces = [
      {
        name: 'Omar',
        similarity: 0.95,
        box: { x: 0.18, y: 0.15, width: 0.08, height: 0.08 }
      },
      {
        name: 'Sara',
        similarity: 0.91,
        box: { x: 0.68, y: 0.15, width: 0.08, height: 0.08 }
      }
    ];

    const matchResult = matchPeopleToPlayers(detectedPeople, detectedFaces, enrolled);
    assert.equal(matchResult.matched.length, 2);
    assert.equal(matchResult.unmatchedPeople.length, 0);

    const omarMatch = matchResult.matched.find(m => m.playerName === 'Omar');
    assert.equal(omarMatch.person.id, 0);

    const saraMatch = matchResult.matched.find(m => m.playerName === 'Sara');
    assert.equal(saraMatch.person.id, 1);
  });

  test('judgeFramePure: HIDE mode marks any visible person as OUT', () => {
    const enrolled = [
      { id: 'p1', name: 'Omar' },
      { id: 'p2', name: 'Sara' }
    ];

    // Omar is visible with face; Sara is not in frame
    const detectedPeople = [
      {
        id: 0,
        torsoCenter: { x: 0.3, y: 0.5 },
        landmarks: [{ x: 0.3, y: 0.2 }],
        boundingBox: { x: 0.2, y: 0.1, width: 0.2, height: 0.8 }
      }
    ];
    const detectedFaces = [
      { name: 'Omar', similarity: 0.9, box: { x: 0.28, y: 0.18, width: 0.05, height: 0.05 } }
    ];

    const verdict = judgeFramePure({
      mode: POTATO_MODES.HIDE,
      detectedPeople,
      detectedFaces,
      enrolledPlayers: enrolled
    });

    const omar = verdict.results.find(r => r.playerName === 'Omar');
    assert.equal(omar.isOut, true, 'Omar should be caught in HIDE mode');
    assert.match(omar.reason, /Omar was caught visible/);

    const sara = verdict.results.find(r => r.playerName === 'Sara');
    assert.equal(sara.isOut, false, 'Sara was not seen and is safe in HIDE mode');
    assert.match(sara.reason, /Sara successfully stayed hidden/);
  });

  test('judgeFramePure: ZONE mode allows staying in frame as long as outside danger zone', () => {
    const enrolled = [
      { id: 'p1', name: 'Omar' },
      { id: 'p2', name: 'Sara' }
    ];

    const dangerZone = { x: 0.1, y: 0.1, width: 0.3, height: 0.8 }; // x: 0.1 to 0.4

    // Omar is at x: 0.25 (inside zone), Sara is at x: 0.75 (outside zone, but visible in frame!)
    const detectedPeople = [
      {
        id: 0,
        torsoCenter: { x: 0.25, y: 0.5 },
        landmarks: [{ x: 0.25, y: 0.2 }],
        boundingBox: { x: 0.15, y: 0.1, width: 0.2, height: 0.8 }
      },
      {
        id: 1,
        torsoCenter: { x: 0.75, y: 0.5 },
        landmarks: [{ x: 0.75, y: 0.2 }],
        boundingBox: { x: 0.65, y: 0.1, width: 0.2, height: 0.8 }
      }
    ];
    const detectedFaces = [
      { name: 'Omar', similarity: 0.9, box: { x: 0.23, y: 0.18, width: 0.05, height: 0.05 } },
      { name: 'Sara', similarity: 0.9, box: { x: 0.73, y: 0.18, width: 0.05, height: 0.05 } }
    ];

    const verdict = judgeFramePure({
      mode: POTATO_MODES.ZONE,
      zone: dangerZone,
      detectedPeople,
      detectedFaces,
      enrolledPlayers: enrolled
    });

    const omar = verdict.results.find(r => r.playerName === 'Omar');
    assert.equal(omar.isOut, true, 'Omar is in the zone and OUT');
    assert.match(omar.reason, /Omar was in the danger zone/);

    const sara = verdict.results.find(r => r.playerName === 'Sara');
    assert.equal(sara.isOut, false, 'Sara is outside the zone and SAFE');
    assert.match(sara.reason, /Sara was safely outside the danger zone/);
  });

  test('judgeFramePure: Unmatched person triggers host assignment requirement', () => {
    const enrolled = [{ id: 'p1', name: 'Omar' }];

    // A person is detected, but no matching face found
    const detectedPeople = [
      {
        id: 0,
        torsoCenter: { x: 0.5, y: 0.5 },
        landmarks: Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 })),
        boundingBox: { x: 0.4, y: 0.2, width: 0.2, height: 0.6 }
      }
    ];

    const verdict = judgeFramePure({
      mode: POTATO_MODES.HIDE,
      detectedPeople,
      detectedFaces: [], // no faces matched
      enrolledPlayers: enrolled
    });

    assert.equal(verdict.needsHostAssignment, true);
    assert.equal(verdict.unmatchedPeople.length, 1);

    // Host manually assigns personIndex 0 to 'p1' (Omar)
    const resolved = judgeFramePure({
      mode: POTATO_MODES.HIDE,
      detectedPeople,
      detectedFaces: [],
      enrolledPlayers: enrolled,
      manualAssignments: { 0: 'p1' }
    });

    assert.equal(resolved.needsHostAssignment, false);
    const omar = resolved.results.find(r => r.playerId === 'p1');
    assert.equal(omar.isOut, true);
    assert.equal(omar.manual, true);
  });

  test('calculateHotPotatoTournamentScores: 1 pt per survived round, fewest catches breaks tie', () => {
    const players = [
      { id: 'p1', name: 'Omar' },
      { id: 'p2', name: 'Sara' },
      { id: 'p3', name: 'Leo' }
    ];

    // 3 rounds
    // Round 1: Omar out, Sara safe, Leo safe
    // Round 2: Omar safe, Sara out, Leo safe
    // Round 3: Omar safe, Sara safe, Leo out
    // Scores: Omar (2 pts, 1 catch), Sara (2 pts, 1 catch), Leo (2 pts, 1 catch)
    // Let's create an asymmetrical case:
    // Round 1: Omar out, Sara safe, Leo out
    // Round 2: Omar safe, Sara safe, Leo out
    // Round 3: Omar safe, Sara safe, Leo safe
    // Scores:
    // Sara: 3 pts, 0 catches (Rank 1)
    // Omar: 2 pts, 1 catch (Rank 2)
    // Leo: 1 pt, 2 catches (Rank 3)
    const round1 = [{ playerId: 'p1', isOut: true }, { playerId: 'p2', isOut: false }, { playerId: 'p3', isOut: true }];
    const round2 = [{ playerId: 'p1', isOut: false }, { playerId: 'p2', isOut: false }, { playerId: 'p3', isOut: true }];
    const round3 = [{ playerId: 'p1', isOut: false }, { playerId: 'p2', isOut: false }, { playerId: 'p3', isOut: false }];

    const tournament = calculateHotPotatoTournamentScores([round1, round2, round3], players);

    assert.equal(tournament[0].name, 'Sara');
    assert.equal(tournament[0].points, 3);
    assert.equal(tournament[0].catches, 0);
    assert.equal(tournament[0].rank, 1);

    assert.equal(tournament[1].name, 'Omar');
    assert.equal(tournament[1].points, 2);
    assert.equal(tournament[1].catches, 1);
    assert.equal(tournament[1].rank, 2);

    assert.equal(tournament[2].name, 'Leo');
    assert.equal(tournament[2].points, 1);
    assert.equal(tournament[2].catches, 2);
    assert.equal(tournament[2].rank, 3);
  });
});
