import test from 'node:test';
import assert from 'node:assert/strict';
import { buildResult, verifySignedReport, computeHmacSha256 } from '../core/report.js';
import { createEvidenceStore } from '../core/evidence.js';

test('buildResult generates valid majlis-result/1 schema', () => {
  const res = buildResult({
    game: 'bus_count',
    players: [
      { id: 'p1', name: 'Sara', team: 'A' },
      { id: 'p2', name: 'Omar', team: 'B' }
    ],
    events: [
      { t: 3.2, type: 'BOARD_SAFE', player: 'p1', team: 'A', points: 1, reason: 'Sara boarded on green.' },
      { t: 7.5, type: 'BOARD_SAFE', player: 'p2', team: 'B', points: 1, reason: 'Omar boarded on green.' }
    ]
  });

  assert.equal(res.schema, 'majlis-result/1');
  assert.equal(res.game, 'bus_count');
  assert.equal(res.scores.teams.A, 1);
  assert.equal(res.scores.teams.B, 1);
  assert.equal(res.winner.kind, 'tie');
});

test('verifySignedReport verifies authentic HMAC signature', async () => {
  const secret = 'family-game-secret-key';
  const payloadObj = buildResult({
    game: 'balloon',
    players: [{ id: 'p1', name: 'Grandma', team: null }],
    events: [{ t: 1.0, type: 'KEEP_UP', player: 'p1', team: null, points: 5, reason: 'Grandma kept balloon aloft.' }]
  });

  const payloadString = JSON.stringify(payloadObj);
  const signature = await computeHmacSha256(payloadString, secret);

  const signedEnvelope = JSON.stringify({
    payload: payloadString,
    hmac: signature
  });

  const verified = await verifySignedReport(signedEnvelope, secret);
  assert.equal(verified.ok, true);
  assert.equal(verified.reason, null);
  assert.equal(verified.result.game, 'balloon');
});

test('verifySignedReport rejects tampered payload', async () => {
  const secret = 'referee-key';
  const payloadObj = buildResult({
    game: 'football',
    players: [{ id: 'p1', name: 'Tariq', team: 'A' }]
  });

  const payloadString = JSON.stringify(payloadObj);
  const signature = await computeHmacSha256(payloadString, secret);

  // Tamper with payload string
  const tamperedPayload = payloadString.replace('Tariq', 'Cheater');

  const signedEnvelope = JSON.stringify({
    payload: tamperedPayload,
    hmac: signature
  });

  const verified = await verifySignedReport(signedEnvelope, secret);
  assert.equal(verified.ok, false);
  assert.match(verified.reason, /invalid|changed/i);
});

test('createEvidenceStore enforces max 12 items and removes data url prefix', () => {
  const store = createEvidenceStore();

  for (let i = 0; i < 15; i++) {
    store.addText(i, `Snapshot note ${i}`, `Caption ${i}`);
  }

  const list = store.list();
  assert.equal(list.length, 12);
  assert.equal(list[list.length - 1].caption, 'Caption 14');
});
