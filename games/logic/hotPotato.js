/**
 * Aqaarib Motion Engine - Hot Potato Game Logic
 * Evaluates visibility and danger zone containment for snap-photo judgments.
 */

export const POTATO_MODES = {
  HIDE: 'HIDE',
  ZONE: 'ZONE'
};

export function generateRandomZone(options = {}) {
  const minW = options.minWidth || 0.28;
  const maxW = options.maxWidth || 0.44;
  const minH = options.minHeight || 0.38;
  const maxH = options.maxHeight || 0.58;

  const width = Number((minW + Math.random() * (maxW - minW)).toFixed(3));
  const height = Number((minH + Math.random() * (maxH - minH)).toFixed(3));

  const minX = 0.08;
  const maxX = 0.92 - width;
  const minY = 0.12;
  const maxY = 0.88 - height;

  const x = Number((minX + Math.random() * (maxX - minX)).toFixed(3));
  const y = Number((minY + Math.random() * (maxY - minY)).toFixed(3));

  return { x, y, width, height };
}

export function isPersonVisible(landmarks, hasFace = false, visibilityThreshold = 0.45) {
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

export function isPointInZone(point, zone) {
  if (!point || !zone) return false;
  return (
    point.x >= zone.x &&
    point.x <= zone.x + zone.width &&
    point.y >= zone.y &&
    point.y <= zone.y + zone.height
  );
}

export function distance2D(p1, p2) {
  const dx = (p1.x ?? 0) - (p2.x ?? 0);
  const dy = (p1.y ?? 0) - (p2.y ?? 0);
  return Math.hypot(dx, dy);
}

export function matchPeopleToPlayers(detectedPeople = [], detectedFaces = [], enrolledPlayers = []) {
  const matched = [];
  const unmatchedPeople = [];
  const usedPersonIndices = new Set();
  const usedPlayerIds = new Set();

  const facesWithCenter = detectedFaces.map(face => {
    const cx = face.box ? face.box.x + face.box.width / 2 : 0;
    const cy = face.box ? face.box.y + face.box.height / 2 : 0;
    return { ...face, center: { x: cx, y: cy } };
  });

  for (const face of facesWithCenter) {
    if (!face.name) continue;

    const player = enrolledPlayers.find(p => p.name.toLowerCase() === face.name.toLowerCase());
    if (!player || usedPlayerIds.has(player.id)) continue;

    let closestPersonIdx = -1;
    let closestDist = Infinity;

    detectedPeople.forEach((person, idx) => {
      if (usedPersonIndices.has(idx)) return;

      const headPos = person.landmarks?.[0] || person.torsoCenter || { x: 0.5, y: 0.5 };
      const dist = distance2D(face.center, headPos);

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

    // Auto-assign to available enrolled player or label as detected player
    const availablePlayer = enrolledPlayers.find(p => !finalAssignments.some(a => a.playerId === p.id));
    if (availablePlayer) {
      finalAssignments.push({
        playerId: availablePlayer.id,
        playerName: availablePlayer.name,
        person: un.person,
        face: un.suggestedFace,
        matchConfidence: 0.75,
        manual: false
      });
    } else {
      const fallbackName = `Player ${un.personIndex + 1}`;
      finalAssignments.push({
        playerId: `detected_${un.personIndex}`,
        playerName: fallbackName,
        person: un.person,
        face: un.suggestedFace,
        matchConfidence: 0.70,
        manual: false
      });
    }
  }

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
      isOut = visible;
    } else if (mode === POTATO_MODES.ZONE) {
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

  for (const player of enrolledPlayers) {
    if (!processedPlayerIds.has(player.id)) {
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
    needsHostAssignment: false
  };
}

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

  const sorted = Object.values(stats).sort((a, b) => {
    if (b.points !== a.points) {
      return b.points - a.points;
    }
    return a.catches - b.catches;
  });

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
