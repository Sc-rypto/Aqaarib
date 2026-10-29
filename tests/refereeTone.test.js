import test from 'node:test';
import assert from 'node:assert/strict';
import { GAME_CATALOG } from '../data/gameCatalog.js';
import busCountModule from '../games/bus_count.js';
import reportGamesModule from '../games/report_games.js';
import { sanitizeRefereeText, buildResult } from '../core/report.js';
import fs from 'node:fs';

const EMOJI_REGEX = /[\u{1F300}-\u{1F9FF}|[\u{2600}-\u{26FF}]/u;
const DASH_REGEX = /[-–—]/;

test('GAME_CATALOG rulesText has no emojis and no dash punctuation', () => {
  GAME_CATALOG.forEach((game) => {
    game.rulesText.forEach((rule) => {
      assert.equal(
        EMOJI_REGEX.test(rule),
        false,
        `Game ${game.id} rule contains emoji: ${rule}`
      );
      assert.equal(
        DASH_REGEX.test(rule),
        false,
        `Game ${game.id} rule contains dash punctuation: ${rule}`
      );
    });
  });
});

test('bus_count rulesText has no emojis and no dash punctuation', () => {
  busCountModule.rulesText.forEach((rule) => {
    assert.equal(EMOJI_REGEX.test(rule), false, `Rule contains emoji: ${rule}`);
    assert.equal(DASH_REGEX.test(rule), false, `Rule contains dash: ${rule}`);
  });
});

test('report_games rulesText has no emojis and no dash punctuation', () => {
  reportGamesModule.rulesText.forEach((rule) => {
    assert.equal(EMOJI_REGEX.test(rule), false, `Rule contains emoji: ${rule}`);
    assert.equal(DASH_REGEX.test(rule), false, `Rule contains dash: ${rule}`);
  });
});

test('sanitizeRefereeText cleanly removes emojis and dashes', () => {
  const dirty = 'Sara scored a goal! 🏆 — Amazing kick - round 1.';
  const cleaned = sanitizeRefereeText(dirty);
  assert.equal(EMOJI_REGEX.test(cleaned), false);
  assert.equal(DASH_REGEX.test(cleaned), false);
  assert.equal(cleaned, 'Sara scored a goal! Amazing kick round 1.');
});

test('Signed report fixtures have no emojis or dash punctuation in reasons', () => {
  const balloonRaw = JSON.parse(fs.readFileSync('fixtures/balloon_signed_report.json', 'utf8'));
  const balloonPayload = JSON.parse(balloonRaw.payload);

  balloonPayload.events.forEach((ev) => {
    assert.equal(EMOJI_REGEX.test(ev.reason), false, `Balloon event reason has emoji: ${ev.reason}`);
    assert.equal(DASH_REGEX.test(ev.reason), false, `Balloon event reason has dash: ${ev.reason}`);
  });

  const footballRaw = JSON.parse(fs.readFileSync('fixtures/football_signed_report.json', 'utf8'));
  const footballPayload = JSON.parse(footballRaw.payload);

  footballPayload.events.forEach((ev) => {
    assert.equal(EMOJI_REGEX.test(ev.reason), false, `Football event reason has emoji: ${ev.reason}`);
    assert.equal(DASH_REGEX.test(ev.reason), false, `Football event reason has dash: ${ev.reason}`);
  });
});
