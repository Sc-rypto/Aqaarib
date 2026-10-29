/**
 * Pure Game Logic: Bus Count
 *
 * All judging logic in pure functions.
 */

export const BUS_SIGNALS = {
  GREEN: 'GREEN', // Boarding Open
  RED: 'RED'      // Doors Closed
};

/**
 * Checks if a normalized point { x, y } is within the bus passenger zone.
 */
export function isPointInBusZone(point, busZone) {
  if (!point || !busZone) return false;
  const px = Number(point.x);
  const py = Number(point.y);
  const minX = Number(busZone.x);
  const maxX = minX + Number(busZone.w);
  const minY = Number(busZone.y);
  const maxY = minY + Number(busZone.h);

  return px >= minX && px <= maxX && py >= minY && py <= maxY;
}

/**
 * Evaluates whether a player crossed the door line into the bus zone.
 */
export function evaluateBoardingStep({
  player,
  prevX,
  currentX,
  doorLineX = 0.35,
  signal = BUS_SIGNALS.GREEN,
  timestampSec = 0
}) {
  if (!player || prevX === undefined || currentX === undefined) {
    return { eventType: 'NONE', points: 0, reason: '' };
  }

  const crossedIntoBus = prevX < doorLineX && currentX >= doorLineX;
  if (!crossedIntoBus) {
    return { eventType: 'NONE', points: 0, reason: '' };
  }

  const name = player.name || 'A player';

  if (signal === BUS_SIGNALS.GREEN) {
    return {
      eventType: 'BOARD_SAFE',
      points: 1,
      reason: `${name} boarded the bus on time. One point scored.`
    };
  } else {
    return {
      eventType: 'BOARD_FOUL',
      points: -1,
      reason: `${name} crossed after the doors closed. Boarding foul called.`
    };
  }
}

/**
 * Counts and matches people currently seated or standing inside the bus zone.
 */
export function evaluatePassengerHeadcount({
  detectedPeople = [],
  busZone,
  players = []
}) {
  if (!busZone) {
    return { count: 0, passengerIds: [] };
  }

  const insidePeople = detectedPeople.filter((p) => {
    const center = p.torsoCenter || { x: p.x, y: p.y };
    return isPointInBusZone(center, busZone);
  });

  // Map to player IDs if matched or index based
  const passengerIds = [];
  insidePeople.forEach((p, idx) => {
    if (p.playerId) {
      passengerIds.push(p.playerId);
    } else if (players[idx]) {
      passengerIds.push(players[idx].id);
    }
  });

  return {
    count: insidePeople.length,
    passengerIds
  };
}

/**
 * Computes scores and determines winner for Bus Count.
 */
export function calculateBusTournamentScores({
  events = [],
  players = [],
  mode = 'team'
}) {
  const playerScores = {};
  const teamScores = { A: 0, B: 0 };

  players.forEach((p) => {
    playerScores[p.id] = 0;
  });

  events.forEach((ev) => {
    const pts = Number(ev.points) || 0;
    if (ev.player && playerScores[ev.player] !== undefined) {
      playerScores[ev.player] += pts;
    }
    if (ev.team && (ev.team === 'A' || ev.team === 'B')) {
      teamScores[ev.team] += pts;
    }
  });

  // Keep individual scores non-negative
  Object.keys(playerScores).forEach((pid) => {
    if (playerScores[pid] < 0) playerScores[pid] = 0;
  });
  if (teamScores.A < 0) teamScores.A = 0;
  if (teamScores.B < 0) teamScores.B = 0;

  const hasTeams = players.some((p) => p.team === 'A' || p.team === 'B');

  let winner;
  if (hasTeams && mode !== 'individual') {
    if (teamScores.A > teamScores.B) {
      winner = {
        kind: 'team',
        id: 'A',
        reason: `Team A safely boarded the most passengers with ${teamScores.A} points.`
      };
    } else if (teamScores.B > teamScores.A) {
      winner = {
        kind: 'team',
        id: 'B',
        reason: `Team B safely boarded the most passengers with ${teamScores.B} points.`
      };
    } else {
      winner = {
        kind: 'tie',
        id: null,
        reason: 'Both teams finished with equal points on the bus.'
      };
    }
  } else {
    let topScore = -1;
    let topPlayer = null;
    let tie = false;

    players.forEach((p) => {
      const s = playerScores[p.id];
      if (s > topScore) {
        topScore = s;
        topPlayer = p;
        tie = false;
      } else if (s === topScore) {
        tie = true;
      }
    });

    if (!topPlayer || tie) {
      winner = {
        kind: 'tie',
        id: null,
        reason: 'The bus count ended in a tie.'
      };
    } else {
      winner = {
        kind: 'player',
        id: topPlayer.id,
        reason: `${topPlayer.name} won the bus count with ${topScore} points.`
      };
    }
  }

  return {
    playerScores,
    teamScores,
    winner
  };
}
