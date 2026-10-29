/**
 * Hot Potato - Pure Game Logic
 * Person B Implementation
 *
 * Rules:
 * - Hidden timer of 10 to 30 seconds ticks with beeps speeding up.
 * - Photo taken when timer ends.
 * - Two modes at random:
 *   - HIDE: anyone visible in photo is OUT for round.
 *   - ZONE: random danger rectangle shown before timer; anyone whose body center is inside it is OUT. Staying in frame outside zone is safe.
 * - 3 rounds.
 * - Everyone not caught in a round scores 1 point.
 * - Most points wins, fewest catches breaks ties.
 * - Visibility: at least 4 of shoulders & hips (11, 12, 23, 24) have visibility >= 0.5, OR face detected.
 * - Match each person to player through nearest face.
 * - Anyone seen but not matched goes to "who is this?" picker for host instead of guess.
 * - Plain reasons for events.
 */

export const POTATO_MODES = {
  HIDE: 'HIDE',
  ZONE: 'ZONE'
};

/**
 * Generates a random normalized danger zone for ZONE mode.
 * Kept well within frame bounds [0.1, 0.9] so players have room to avoid it.
 * @param {Object} options
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
export function generateRandomZone(options = {}) {
  const minW = options.minWidth || 0.25;
  const maxW = options.maxWidth || 0.45;
  const minH = options.minHeight || 0.35;
  const maxH = options.maxHeight || 0.60;

  const width = Number((minW + Math.random() * (maxW - minW)).toFixed(3));
  const height = Number((minH + Math.random() * (maxH - minH)).toFixed(3));

  const minX = 0.05;
  const maxX = 0.95 - width;
  const minY = 0.10;
  const maxY = 0.90 - height;

  const x = Number((minX + Math.random() * (maxX - minX)).toFixed(3));
  const y = Number((minY + Math.random() * (maxY - minY)).toFixed(3));

  return { x, y, width, height };
}

/**
 * Checks visibility for a person based on MediaPipe landmarks or face presence.
 * RULE: "Visible means at least 4 of the shoulder and hip landmarks are above the visibility limit, or a face was found."
 * Shoulders: 11 (left), 12 (right).
 * Hips: 23 (left), 24 (right).
 * @param {Array<{ x: number, y: number, visibility?: number }>} landmarks
 * @param {boolean} hasFace
 * @param {number} visibilityThreshold - default 0.5
 * @returns {boolean}
 */
export function isPersonVisible(landmarks, hasFace = false, visibilityThreshold = 0.5) {
  if (hasFace) return true;
  if (!landmarks || landmarks.length < 25) return false;

  const keyIndices = [11, 12, 23, 24];
  let visibleCount = 0;

  for (const idx of keyIndices) {
    const lm = landmarks[idx];
    if (lm && (lm.visibility === undefined || lm.visibility >= visibilityThreshold)) {
      visibleCount++;
    }
  }

  return visibleCount >= 4;
}

/**
 * Tests if a point (e.g. torso center) is inside a rectangle.
 * @param {{ x: number, y: number }} point
 * @param {{ x: number, y: number, width: number, height: number }} zone
 * @returns {boolean}
 */
export function isPointInZone(point, zone) {
  if (!point || !zone) return false;
  return (
    point.x >= zone.x &&
    point.x <= zone.x + zone.width &&
    point.y >= zone.y &&
    point.y <= zone.y + zone.height
  );
}

/**
 * Computes Euclidean distance between two 2D points.
 */
export function distance2D(p1, p2) {
  const dx = (p1.x ?? 0) - (p2.x ?? 0);
  const dy = (p1.y ?? 0) - (p2.y ?? 0);
  return Math.hypot(dx, dy);
}

/**
 * Matches detected people to detected faces.
 * For each detected face with a recognized enrolled identity, links to the closest person pose.
 * If a person has no recognized face or distance is too far (> 0.3 normalized), returns unmatched.
 *
 * @param {Array<Object>} detectedPeople - [{ id, torsoCenter, landmarks, boundingBox }, ...]
 * @param {Array<Object>} detectedFaces - [{ name, similarity, box: {x, y, width, height} }, ...]
 * @param {Array<Object>} enrolledPlayers - [{ id, name }, ...]
 * @returns {{ matched: Array, unmatchedPeople: Array }}
 */
export function matchPeopleToPlayers(detectedPeople = [], detectedFaces = [], enrolledPlayers = []) {
  const matched = [];
  const unmatchedPeople = [];
  const usedPersonIndices = new Set();
  const usedPlayerIds = new Set();

  // Calculate face center points
  const facesWithCenter = detectedFaces.map(face => {
    const cx = face.box ? face.box.x + face.box.width / 2 : 0;
    const cy = face.box ? face.box.y + face.box.height / 2 : 0;
    return { ...face, center: { x: cx, y: cy } };
  });

  // Attempt to match enrolled faces to closest detected person
  for (const face of facesWithCenter) {
    if (!face.name) continue; // Face unrecognized

    const player = enrolledPlayers.find(p => p.name.toLowerCase() === face.name.toLowerCase());
    if (!player || usedPlayerIds.has(player.id)) continue;

    let closestPersonIdx = -1;
    let closestDist = Infinity;

    detectedPeople.forEach((person, idx) => {
      if (usedPersonIndices.has(idx)) return;

      // Distance from face center to person's nose (landmark 0) or torso center
      const headPos = person.landmarks?.[0] || person.torsoCenter || { x: 0.5, y: 0.5 };
      const dist = distance2D(face.center, headPos);

      // Max normalized distance threshold between head and face bounding box
      if (dist < closestDist && dist < 0.35) {
        closestDist = dist;
        closestPersonIdx = idx;
      }
    });

    if (closestPersonIdx !== -1) {
      usedPersonIndices.add(closestPersonIdx);
      usedPlayerIds.add(player.id);
      matched.push({
        playerId: player.id,
        playerName: player.name,
        person: detectedPeople[closestPersonIdx],
        face,
        matchConfidence: face.similarity || 1.0,
        manual: false
      });
    }
  }

  // Any detected people that were not matched
  detectedPeople.forEach((person, idx) => {
    if (!usedPersonIndices.has(idx)) {
      unmatchedPeople.push({
        personIndex: idx,
        person,
        suggestedFace: facesWithCenter.find(f => {
          const headPos = person.landmarks?.[0] || person.torsoCenter || { x: 0.5, y: 0.5 };
          return distance2D(f.center, headPos) < 0.4;
        }) || null
      });
    }
  });

  return {
    matched,
    unmatchedPeople
  };
}

/**
 * Generates plain humanized reason string for Hot Potato verdicts.
 */
export function generateHotPotatoReason({ playerName, mode, isOut, inZone, isVisible }) {
  if (mode === POTATO_MODES.HIDE) {
    if (isOut) {
      return `${playerName} was caught visible when the photo was taken`;
    }
    return `${playerName} successfully stayed hidden!`;
  }

  if (mode === POTATO_MODES.ZONE) {
    if (isOut) {
      return `${playerName} was in the danger zone when the photo was taken`;
    }
    if (isVisible) {
      return `${playerName} was safely outside the danger zone`;
    }
    return `${playerName} was completely clear of the danger zone`;
  }

  return `${playerName} completed round`;
}

/**
 * Pure frame evaluation function for Hot Potato.
 * @param {Object} params
 *   - mode: 'HIDE' | 'ZONE'
 *   - zone: { x, y, width, height } (used if mode is 'ZONE')
 *   - detectedPeople: Array<{ id, torsoCenter, landmarks, boundingBox }>
 *   - detectedFaces: Array<{ name, similarity, box }>
 *   - enrolledPlayers: Array<{ id, name }>
 *   - manualAssignments: Object mapping unmatched personIndex -> playerId (from host picker)
 * @returns {Object}
 *   - results: Array<{ playerId, playerName, isOut, reason, isVisible, inZone, box }>
 *   - unmatchedPeople: Array (unmatched people needing host picker)
 *   - needsHostAssignment: boolean
 */
export function judgeFramePure({
  mode = POTATO_MODES.HIDE,
  zone = null,
  detectedPeople = [],
  detectedFaces = [],
  enrolledPlayers = [],
  manualAssignments = {}
}) {
  const { matched, unmatchedPeople } = matchPeopleToPlayers(
    detectedPeople,
    detectedFaces,
    enrolledPlayers
  );

  // Apply host manual assignments if provided
  const finalAssignments = [...matched];
  const remainingUnmatched = [];

  for (const un of unmatchedPeople) {
    const assignedPlayerId = manualAssignments[un.personIndex];
    if (assignedPlayerId) {
      const player = enrolledPlayers.find(p => p.id === assignedPlayerId);
      if (player) {
        finalAssignments.push({
          playerId: player.id,
          playerName: player.name,
          person: un.person,
          face: un.suggestedFace,
          matchConfidence: 1.0,
          manual: true
        });
        continue;
      }
    }
    remainingUnmatched.push(un);
  }

  // If there are still unmatched detected people, we pause automated verdict
  // so the host can identify them via the "who is this?" picker.
  const needsHostAssignment = remainingUnmatched.length > 0;

  // Build per-player judgment
  const results = [];
  const processedPlayerIds = new Set();

  for (const assignment of finalAssignments) {
    const { playerId, playerName, person, face } = assignment;
    processedPlayerIds.add(playerId);

    const hasFace = Boolean(face);
    const visible = isPersonVisible(person.landmarks, hasFace);
    const inZone = mode === POTATO_MODES.ZONE && zone
      ? isPointInZone(person.torsoCenter, zone)
      : false;

    let isOut = false;
    if (mode === POTATO_MODES.HIDE) {
      // HIDE mode: anyone visible is OUT
      isOut = visible;
    } else if (mode === POTATO_MODES.ZONE) {
      // ZONE mode: anyone inside danger rectangle is OUT
      isOut = inZone;
    }

    const reason = generateHotPotatoReason({
      playerName,
      mode,
      isOut,
      inZone,
      isVisible: visible
    });

    results.push({
      playerId,
      playerName,
      isOut,
      reason,
      isVisible: visible,
      inZone,
      box: person.boundingBox || face?.box || null,
      torsoCenter: person.torsoCenter,
      manual: assignment.manual
    });
  }

  // Any enrolled player NOT detected in the photo at all:
  for (const player of enrolledPlayers) {
    if (!processedPlayerIds.has(player.id)) {
      // Player was not seen in photo
      let isOut = false; // in HIDE: not visible is SAFE! In ZONE: not in zone is SAFE!
      const reason = generateHotPotatoReason({
        playerName: player.name,
        mode,
        isOut: false,
        inZone: false,
        isVisible: false
      });

      results.push({
        playerId: player.id,
        playerName: player.name,
        isOut: false,
        reason,
        isVisible: false,
        inZone: false,
        box: null,
        torsoCenter: null,
        manual: false
      });
    }
  }

  return {
    mode,
    zone,
    results,
    unmatchedPeople: remainingUnmatched,
    needsHostAssignment
  };
}

/**
 * Calculates cumulative scores and tie-breaking across 3 rounds.
 * Scoring:
 * - Everyone NOT caught in a round scores 1 point.
 * - Most points wins.
 * - Fewest catches breaks ties.
 *
 * @param {Array<Array<{ playerId: string, isOut: boolean }>>} roundResultsList - Array of 3 round results
 * @param {Array<{ id: string, name: string }>} players - Roster of players
 * @returns {Array<{ playerId: string, name: string, points: number, catches: number, rank: number }>}
 */
export function calculateHotPotatoTournamentScores(roundResultsList = [], players = []) {
  const stats = {};

  players.forEach(p => {
    stats[p.id] = {
      playerId: p.id,
      name: p.name,
      points: 0,
      catches: 0
    };
  });

  for (const round of roundResultsList) {
    for (const res of round) {
      if (!stats[res.playerId]) continue;
      if (res.isOut) {
        stats[res.playerId].catches += 1;
      } else {
        stats[res.playerId].points += 1;
      }
    }
  }

  // Sort: highest points first; tie-breaker: fewest catches first
  const sorted = Object.values(stats).sort((a, b) => {
    if (b.points !== a.points) {
      return b.points - a.points;
    }
    return a.catches - b.catches;
  });

  // Assign ranks
  let currentRank = 1;
  sorted.forEach((p, idx) => {
    if (idx > 0) {
      const prev = sorted[idx - 1];
      if (p.points === prev.points && p.catches === prev.catches) {
        p.rank = prev.rank;
      } else {
        p.rank = idx + 1;
      }
    } else {
      p.rank = 1;
    }
  });

  return sorted;
}
