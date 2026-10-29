import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createReport, validateReport } from '../dev/stubs/report.js';

describe('Report Validation - Unit Tests', () => {
  test('createReport constructs a well-formed report with default winner', () => {
    const report = createReport({
      gameName: 'Red Light',
      durationSec: 35.2,
      players: [
        { id: 'p1', name: 'Sara' },
        { id: 'p2', name: 'Leo' }
      ],
      scores: { p1: 3, p2: 1 },
      strikes: { p1: 0, p2: 2 },
      events: [{ reason: 'Leo moved during Red' }]
    });

    assert.equal(report.gameName, 'Red Light');
    assert.equal(report.winner.id, 'p1');
    assert.equal(report.winner.score, 3);

    const validation = validateReport(report);
    assert.equal(validation.valid, true);
    assert.equal(validation.errors.length, 0);
  });

  test('validateReport catches missing player score entries and invalid structures', () => {
    // Missing score for p2
    const invalidReport = {
      gameName: 'Hot Potato',
      sessionTimestamp: Date.now(),
      durationSec: 20,
      players: [{ id: 'p1', name: 'Sara' }, { id: 'p2', name: 'Omar' }],
      scores: { p1: 1 }, // missing p2
      strikes: {},
      events: [{ reason: 'Round 1 completed' }],
      evidence: []
    };

    const validation = validateReport(invalidReport);
    assert.equal(validation.valid, false);
    assert.ok(validation.errors.some(e => e.includes('numeric entry for player p2')));
  });

  test('validateReport rejects events lacking plain reason string', () => {
    const invalidEventReport = {
      gameName: 'Red Light',
      sessionTimestamp: Date.now(),
      durationSec: 10,
      players: [{ id: 'p1', name: 'Sara' }],
      scores: { p1: 3 },
      strikes: { p1: 0 },
      events: [{ type: 'STRIKE' }], // missing reason
      evidence: []
    };

    const validation = validateReport(invalidEventReport);
    assert.equal(validation.valid, false);
    assert.ok(validation.errors.some(e => e.includes('plain string reason')));
  });
});
