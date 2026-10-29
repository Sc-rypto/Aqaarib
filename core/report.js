/**
 * Result Contract and Signed Report Manager
 * /core/report.js
 *
 * Implements frozen Result Contract (schema: "majlis-result/1")
 * and HMAC SHA256 verification for Python judge reports.
 */

const ALLOWED_GAMES = ['red_light', 'hot_potato', 'bus_count', 'balloon', 'football'];

/**
 * Sanitizes referee text to guarantee:
 * - Friendly plain tone
 * - No emojis
 * - No dashes used as punctuation
 */
export function sanitizeRefereeText(text, fallback = 'Referee call completed.') {
  if (!text || typeof text !== 'string') return fallback;
  return text
    .replace(/[\u{1F300}-\u{1F9FF}|[\u{2600}-\u{26FF}]/gu, '')
    .replace(/[-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || fallback;
}

/**
 * Builds and validates a result object against schema "majlis-result/1".
 * Fills default values where appropriate.
 */
export function buildResult(partial = {}) {
  if (!partial || typeof partial !== 'object') {
    throw new Error('Result payload must be an object');
  }

  const game = partial.game;
  if (!ALLOWED_GAMES.includes(game)) {
    throw new Error(`Game must be one of: ${ALLOWED_GAMES.join(', ')}`);
  }

  const sessionId = String(
    partial.sessionId || `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  );

  const createdAt = partial.createdAt || new Date().toISOString();

  // Validate players
  const rawPlayers = Array.isArray(partial.players) ? partial.players : [];
  const players = rawPlayers.map((p, idx) => ({
    id: String(p.id || `p${idx + 1}`),
    name: String(p.name || `Player ${idx + 1}`),
    team: p.team === 'A' || p.team === 'B' ? p.team : null
  }));

  const rules = partial.rules && typeof partial.rules === 'object' ? { ...partial.rules } : {};

  // Validate events
  const rawEvents = Array.isArray(partial.events) ? partial.events : [];
  const events = rawEvents.map((ev) => ({
    t: Number((Number(ev.t) || 0).toFixed(1)),
    type: String(ev.type || 'SCORE'),
    player: ev.player ? String(ev.player) : null,
    team: ev.team === 'A' || ev.team === 'B' ? ev.team : null,
    points: Number(ev.points) || 0,
    reason: sanitizeRefereeText(ev.reason, 'Points awarded by referee.'),
    evidence: ev.evidence ? String(ev.evidence) : null
  }));

  // Build / validate scores
  const playerScores = {};
  players.forEach((p) => {
    playerScores[p.id] = 0;
  });

  const teamScores = { A: 0, B: 0 };

  if (partial.scores && typeof partial.scores === 'object') {
    if (partial.scores.players && typeof partial.scores.players === 'object') {
      Object.entries(partial.scores.players).forEach(([pid, val]) => {
        playerScores[pid] = Number(val) || 0;
      });
    }
    if (partial.scores.teams && typeof partial.scores.teams === 'object') {
      if (typeof partial.scores.teams.A === 'number') teamScores.A = partial.scores.teams.A;
      if (typeof partial.scores.teams.B === 'number') teamScores.B = partial.scores.teams.B;
    }
  } else {
    // Calculate from events if scores was not provided
    events.forEach((ev) => {
      if (ev.player && playerScores[ev.player] !== undefined) {
        playerScores[ev.player] += ev.points;
      }
      if (ev.team && (ev.team === 'A' || ev.team === 'B')) {
        teamScores[ev.team] += ev.points;
      }
    });
  }

  // Determine winner
  let winner = partial.winner;
  if (!winner || typeof winner !== 'object') {
    const hasTeams = players.some((p) => p.team !== null);
    if (hasTeams) {
      if (teamScores.A > teamScores.B) {
        winner = { kind: 'team', id: 'A', reason: 'Team A earned the highest score.' };
      } else if (teamScores.B > teamScores.A) {
        winner = { kind: 'team', id: 'B', reason: 'Team B earned the highest score.' };
      } else {
        winner = { kind: 'tie', id: null, reason: 'Both teams finished with equal points.' };
      }
    } else {
      let topScore = -Infinity;
      let topPlayer = null;
      let isTie = false;

      players.forEach((p) => {
        const score = playerScores[p.id] || 0;
        if (score > topScore) {
          topScore = score;
          topPlayer = p;
          isTie = false;
        } else if (score === topScore) {
          isTie = true;
        }
      });

      if (!topPlayer || isTie) {
        winner = { kind: 'tie', id: null, reason: 'The game ended in a tie.' };
      } else {
        winner = {
          kind: 'player',
          id: topPlayer.id,
          reason: `${topPlayer.name} won with ${topScore} points.`
        };
      }
    }
  } else {
    winner = {
      kind: winner.kind === 'team' || winner.kind === 'player' ? winner.kind : 'tie',
      id: winner.id ? String(winner.id) : null,
      reason: sanitizeRefereeText(winner.reason, 'Match concluded.')
    };
  }

  // Evidence validation (maximum 12 items, base64 data without prefix)
  const rawEvidence = Array.isArray(partial.evidence) ? partial.evidence : [];
  const evidence = rawEvidence.slice(0, 12).map((ev, idx) => {
    let dataStr = String(ev.data || '');
    if (ev.type === 'image') {
      dataStr = dataStr.replace(/^data:image\/[a-z]+;base64,/, '');
    }
    return {
      id: String(ev.id || `ev${idx + 1}`),
      t: Number((Number(ev.t) || 0).toFixed(1)),
      type: ev.type === 'text' ? 'text' : 'image',
      data: dataStr,
      caption: sanitizeRefereeText(ev.caption, 'Evidence snapshot')
    };
  });

  const stats = partial.stats && typeof partial.stats === 'object' ? { ...partial.stats } : {};

  return {
    schema: 'majlis-result/1',
    game,
    sessionId,
    createdAt,
    players,
    rules,
    events,
    scores: {
      players: playerScores,
      teams: teamScores
    },
    winner,
    evidence,
    stats
  };
}

/**
 * Computes HMAC SHA256 lowercase hex string.
 * Uses Web Crypto API in browser and Node.
 */
export async function computeHmacSha256(payloadText, secretKey) {
  const enc = new TextEncoder();
  const keyBytes = enc.encode(secretKey);
  const payloadBytes = enc.encode(payloadText);

  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, payloadBytes);
    return Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // Fallback for Node environments without global subtle
  const nodeCrypto = await import('node:crypto');
  return nodeCrypto.createHmac('sha256', secretKey).update(payloadText, 'utf8').digest('hex');
}

/**
 * Verifies a signed report file text.
 * Contract:
 * - A file with exactly two keys: { payload: string, hmac: string }.
 * - payload is JSON text of one result object.
 * - hmac is lowercase hex HMAC SHA256 of UTF-8 bytes of payload.
 * Returns Promise<{ ok: boolean, reason: string|null, result: object|null }>.
 */
export async function verifySignedReport(fileText, key) {
  if (!fileText || typeof fileText !== 'string') {
    return {
      ok: false,
      reason: 'Please provide a valid report file text.',
      result: null
    };
  }

  if (!key || typeof key !== 'string' || !key.trim()) {
    return {
      ok: false,
      reason: 'Please enter the referee secret key to verify the report.',
      result: null
    };
  }

  let envelope;
  try {
    envelope = JSON.parse(fileText);
  } catch (_) {
    return {
      ok: false,
      reason: 'The uploaded file is not valid JSON text.',
      result: null
    };
  }

  if (
    !envelope ||
    typeof envelope !== 'object' ||
    typeof envelope.payload !== 'string' ||
    typeof envelope.hmac !== 'string'
  ) {
    return {
      ok: false,
      reason: 'The file format does not match the signed report structure with payload and hmac.',
      result: null
    };
  }

  try {
    const expectedHmac = await computeHmacSha256(envelope.payload, key.trim());
    const receivedHmac = envelope.hmac.trim().toLowerCase();

    if (expectedHmac !== receivedHmac) {
      return {
        ok: false,
        reason: 'The report signature is invalid. The file was changed or the key was incorrect.',
        result: null
      };
    }

    const parsedPayload = JSON.parse(envelope.payload);
    const validatedResult = buildResult(parsedPayload);

    return {
      ok: true,
      reason: null,
      result: validatedResult
    };
  } catch (err) {
    return {
      ok: false,
      reason: `Could not verify report: ${err.message}`,
      result: null
    };
  }
}
