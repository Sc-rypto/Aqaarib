/**
 * Core Stub: report.js
 * Stand-in for Person A's /core/report.js (Frozen API)
 * DO NOT MOVE TO /core - Keep in /dev/stubs until merge.
 */

/**
 * Creates a normalized result object for any game session.
 */
export function createReport(data = {}) {
  const players = Array.isArray(data.players) ? data.players : [];
  const scores = data.scores || {};
  const strikes = data.strikes || {};
  const events = Array.isArray(data.events) ? data.events : [];
  const evidence = Array.isArray(data.evidence) ? data.evidence : [];

  // Determine winner if not explicitly specified
  let winner = data.winner || null;
  if (!winner && players.length > 0) {
    let topScore = -Infinity;
    let topPlayer = null;
    players.forEach(p => {
      const score = scores[p.id] !== undefined ? scores[p.id] : 0;
      if (score > topScore) {
        topScore = score;
        topPlayer = { id: p.id, name: p.name, score };
      }
    });
    winner = topPlayer;
  }

  return {
    gameName: data.gameName || 'Kinship Motion Game',
    sessionTimestamp: data.sessionTimestamp || Date.now(),
    durationSec: Number((data.durationSec || 0).toFixed(1)),
    players,
    scores,
    strikes,
    events,
    evidence,
    winner,
    meta: {
      generatedBy: 'Person B Implementation',
      visionModel: 'MediaPipe Pose Landmarker + Human.js',
      ...(data.meta || {})
    }
  };
}

/**
 * Validates a game session result object against the frozen specification.
 * Returns { valid: boolean, errors: Array<string> }.
 */
export function validateReport(report) {
  const errors = [];

  if (!report || typeof report !== 'object') {
    return { valid: false, errors: ['Report must be an object'] };
  }

  if (typeof report.gameName !== 'string' || !report.gameName.trim()) {
    errors.push('gameName must be a non-empty string');
  }

  if (typeof report.sessionTimestamp !== 'number' && typeof report.sessionTimestamp !== 'string') {
    errors.push('sessionTimestamp must be a number or string');
  }

  if (typeof report.durationSec !== 'number' || report.durationSec < 0) {
    errors.push('durationSec must be a non-negative number');
  }

  if (!Array.isArray(report.players) || report.players.length === 0) {
    errors.push('players must be a non-empty array of player objects');
  } else {
    report.players.forEach((p, idx) => {
      if (!p || typeof p.id !== 'string' || !p.name) {
        errors.push(`players[${idx}] must contain valid id and name`);
      }
    });
  }

  if (typeof report.scores !== 'object' || report.scores === null) {
    errors.push('scores must be an object');
  } else {
    report.players.forEach(p => {
      if (report.scores[p.id] === undefined || typeof report.scores[p.id] !== 'number') {
        errors.push(`scores must contain a numeric entry for player ${p.id}`);
      }
    });
  }

  if (typeof report.strikes !== 'object' || report.strikes === null) {
    errors.push('strikes must be an object mapping player IDs to numbers');
  }

  if (!Array.isArray(report.events)) {
    errors.push('events must be an array');
  } else {
    report.events.forEach((ev, idx) => {
      if (!ev.reason || typeof ev.reason !== 'string') {
        errors.push(`events[${idx}] must contain a plain string reason`);
      }
    });
  }

  if (!Array.isArray(report.evidence)) {
    errors.push('evidence must be an array');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Initiates browser download of report as a JSON file.
 */
export function downloadReportJson(report, filename = 'game-result.json') {
  if (typeof document === 'undefined') return;
  const jsonStr = JSON.stringify(report, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
