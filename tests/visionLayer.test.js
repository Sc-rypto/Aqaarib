import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { calculateRawMotion, MotionTracker } from '../vision/motion.js';
import { cosineSimilarity } from '../vision/faceMatch.js';

describe('Vision Layer - Motion & Math Tests', () => {
  test('calculateRawMotion divides displacement by shoulder width for scale invariance', () => {
    // Subject A: Far away (shoulder width = 0.1)
    // Left shoulder (11): x: 0.45, y: 0.3. Right shoulder (12): x: 0.55, y: 0.3 -> width = 0.10
    const prevA = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5 }));
    prevA[11] = { x: 0.45, y: 0.3 };
    prevA[12] = { x: 0.55, y: 0.3 };
    const currA = Array.from({ length: 33 }, () => ({ x: 0.52, y: 0.5 })); // moved by 0.02
    currA[11] = { x: 0.47, y: 0.3 };
    currA[12] = { x: 0.57, y: 0.3 };

    const scoreA = calculateRawMotion(prevA, currA);

    // Subject B: Up close (shoulder width = 0.30 - 3x bigger)
    // Displacements are also 3x bigger (0.06 vs 0.02)
    const prevB = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5 }));
    prevB[11] = { x: 0.35, y: 0.3 };
    prevB[12] = { x: 0.65, y: 0.3 };
    const currB = Array.from({ length: 33 }, () => ({ x: 0.56, y: 0.5 })); // moved by 0.06
    currB[11] = { x: 0.41, y: 0.3 };
    currB[12] = { x: 0.71, y: 0.3 };

    const scoreB = calculateRawMotion(prevB, currB);

    // Both scores should be approximately equal because displacement was proportional to shoulder width!
    assert.ok(Math.abs(scoreA - scoreB) < 0.05, `Expected scale invariance: scoreA=${scoreA}, scoreB=${scoreB}`);
  });

  test('MotionTracker applies rolling moving average smoothing', () => {
    const tracker = new MotionTracker({ windowSize: 3 });
    const p1 = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5 }));
    const p2 = Array.from({ length: 33 }, () => ({ x: 0.55, y: 0.5 }));

    const s0 = tracker.update('p1', p1);
    assert.equal(s0, 0); // First frame is baseline

    const s1 = tracker.update('p1', p2);
    assert.ok(s1 > 0);
  });

  test('cosineSimilarity correctly scores identical and orthogonal vectors', () => {
    const v1 = [1, 0, 0, 1];
    const v2 = [1, 0, 0, 1];
    assert.equal(cosineSimilarity(v1, v2), 1.0);

    const vOrthogonal = [0, 1, 1, 0];
    assert.equal(cosineSimilarity(v1, vOrthogonal), 0);
  });
});
