/**
 * Game: Bus Count
 * A family game where players board the bus on green and avoid boarding fouls on red.
 */

import {
  BUS_SIGNALS,
  isPointInBusZone,
  evaluateBoardingStep,
  calculateBusTournamentScores
} from './logic/busCount.js';
import { runLoop } from '../core/loop.js';
import { buildResult } from '../core/report.js';
import { poseTracker } from '../vision/poseTracker.js';

export default {
  id: 'bus_count',
  title: 'Bus Count',
  mode: 'both',
  minPlayers: 2,
  maxPlayers: 8,
  rulesText: [
    'Step across the door line when the bus signal is green.',
    'Do not cross into the bus after the horn blows and doors close.',
    'Every passenger safely on board scores one point for their team.',
    'The team or player with the most safe passengers wins the ride.'
  ],
  defaultRules: {
    roundDurationSec: 25,
    doorLineX: 0.35,
    busZone: { x: 0.35, y: 0.15, w: 0.60, h: 0.75 },
    greenDurationSec: 6,
    redDurationSec: 4
  },
  inputs: ['camera', 'video_file'],

  create(ctx) {
    const players = ctx.players || [
      { id: 'p1', name: 'Player 1', team: 'A' },
      { id: 'p2', name: 'Player 2', team: 'B' }
    ];

    const rules = {
      roundDurationSec: 25,
      doorLineX: 0.35,
      busZone: { x: 0.35, y: 0.15, w: 0.60, h: 0.75 },
      greenDurationSec: 6,
      redDurationSec: 4,
      ...(ctx.rules || {})
    };

    const root = ctx.root;
    const events = [];
    const playerPositions = {};
    const onboardPlayers = new Set();

    let currentSignal = BUS_SIGNALS.GREEN;
    let nextSignalSwitchSec = rules.greenDurationSec;
    let stopLoop = null;
    let isActive = false;
    let canvas = null;
    let overlayCtx = null;
    let containerEl = null;

    // Initialize tracking state
    players.forEach((p, idx) => {
      // Default starting positions outside the bus on the left platform
      playerPositions[p.id] = {
        prevX: 0.15 + idx * 0.05,
        currentX: 0.15 + idx * 0.05,
        y: 0.50
      };
    });

    function setupDOM() {
      root.innerHTML = '';
      containerEl = document.createElement('div');
      containerEl.className = 'bus-game-container';
      containerEl.style.cssText = 'position: relative; width: 100%; height: 100%; min-height: 440px; background: #2b2520; border-radius: 1rem; overflow: hidden; display: flex; flex-direction: column;';

      // Header status bar
      const statusBar = document.createElement('div');
      statusBar.style.cssText = 'padding: 0.75rem 1rem; background: rgba(0,0,0,0.6); display: flex; justify-content: space-between; align-items: center; z-index: 10;';
      statusBar.innerHTML = `
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <span id="busSignalBadge" style="background: #2e7d32; color: white; padding: 0.3rem 0.8rem; border-radius: 9999px; font-weight: 700; font-size: 0.85rem; text-transform: uppercase;">
            BOARDING OPEN
          </span>
          <span id="busTimerBadge" style="color: #fff; font-family: monospace; font-size: 0.9rem;">
            Time: 0s / ${rules.roundDurationSec}s
          </span>
        </div>
        <div id="busHeadcount" style="color: #dda74f; font-weight: 600; font-size: 0.85rem;">
          Passengers on Board: 0
        </div>
      `;
      containerEl.appendChild(statusBar);

      // Main stage wrap
      const stageWrap = document.createElement('div');
      stageWrap.style.cssText = 'position: relative; flex: 1; width: 100%; display: flex; justify-content: center; align-items: center; overflow: hidden;';

      if (ctx.source && ctx.source.video) {
        const vid = ctx.source.video;
        vid.style.cssText = 'position: absolute; width: 100%; height: 100%; object-fit: cover; opacity: 0.85;';
        stageWrap.appendChild(vid);
      }

      canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      canvas.style.cssText = 'position: absolute; width: 100%; height: 100%; object-fit: fill; z-index: 2;';
      stageWrap.appendChild(canvas);
      overlayCtx = canvas.getContext('2d');

      containerEl.appendChild(stageWrap);

      // Quick host action bar for tactile override
      const hostBar = document.createElement('div');
      hostBar.style.cssText = 'padding: 0.5rem 1rem; background: rgba(30,27,24,0.9); display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; z-index: 10; border-top: 1px solid rgba(255,255,255,0.1);';
      hostBar.innerHTML = `<span style="font-size: 0.75rem; color: #a49e96; text-transform: uppercase; font-weight: 700; margin-right: 0.25rem;">Board Passenger:</span>`;

      players.forEach((p) => {
        const btn = document.createElement('button');
        btn.style.cssText = 'background: #3e3832; color: #fff; border: 1px solid #536251; border-radius: 9999px; padding: 0.25rem 0.65rem; font-size: 0.75rem; cursor: pointer;';
        btn.textContent = p.name;
        btn.addEventListener('click', () => {
          triggerBoardingAction(p);
        });
        hostBar.appendChild(btn);
      });

      containerEl.appendChild(hostBar);
      root.appendChild(containerEl);
    }

    function triggerBoardingAction(player) {
      if (!isActive) return;
      const t = ctx.now();
      const name = player.name;

      if (currentSignal === BUS_SIGNALS.GREEN) {
        onboardPlayers.add(player.id);
        const evId = ctx.evidence ? ctx.evidence.capture(ctx.source?.video || canvas, {
          t,
          caption: `${name} boarded the bus safely`,
          boxes: [{ x: rules.doorLineX + 0.05, y: 0.4, w: 0.2, h: 0.4, label: name }]
        }) : null;

        const eventItem = {
          t,
          type: 'BOARD_SAFE',
          player: player.id,
          team: player.team,
          points: 1,
          reason: `${name} boarded the bus on time. One point scored.`,
          evidence: evId
        };
        events.push(eventItem);
        if (ctx.emit) ctx.emit(eventItem);
        if (ctx.beep) ctx.beep(580, 180);
        if (ctx.speak) ctx.speak(`${name} is safely on board.`);
      } else {
        const evId = ctx.evidence ? ctx.evidence.capture(ctx.source?.video || canvas, {
          t,
          caption: `Boarding foul on ${name}`,
          boxes: [{ x: rules.doorLineX - 0.05, y: 0.4, w: 0.2, h: 0.4, label: `${name} Foul` }]
        }) : null;

        const eventItem = {
          t,
          type: 'BOARD_FOUL',
          player: player.id,
          team: player.team,
          points: -1,
          reason: `${name} crossed after the doors closed. Boarding foul called.`,
          evidence: evId
        };
        events.push(eventItem);
        if (ctx.emit) ctx.emit(eventItem);
        if (ctx.beep) ctx.beep(220, 320);
        if (ctx.speak) ctx.speak(`Boarding foul on ${name}.`);
      }

      updateUIHeader(t);
    }

    function updateUIHeader(elapsedSec) {
      const badge = root.querySelector('#busSignalBadge');
      const timer = root.querySelector('#busTimerBadge');
      const headcount = root.querySelector('#busHeadcount');

      if (badge) {
        if (currentSignal === BUS_SIGNALS.GREEN) {
          badge.textContent = 'BOARDING OPEN';
          badge.style.background = '#2e7d32';
        } else {
          badge.textContent = 'DOORS CLOSED';
          badge.style.background = '#ba1a1a';
        }
      }

      if (timer) {
        timer.textContent = `Time: ${Math.floor(elapsedSec)}s / ${rules.roundDurationSec}s`;
      }

      if (headcount) {
        headcount.textContent = `Passengers on Board: ${onboardPlayers.size}`;
      }
    }

    function drawStage(elapsedSec) {
      if (!overlayCtx || !canvas) return;
      const w = canvas.width;
      const h = canvas.height;
      overlayCtx.clearRect(0, 0, w, h);

      // Draw Station Platform (Left of doorLine)
      const doorPx = rules.doorLineX * w;
      overlayCtx.save();
      overlayCtx.fillStyle = 'rgba(40, 35, 30, 0.45)';
      overlayCtx.fillRect(0, 0, doorPx, h);

      // Draw Door Threshold Line
      overlayCtx.strokeStyle = currentSignal === BUS_SIGNALS.GREEN ? '#2e7d32' : '#ba1a1a';
      overlayCtx.lineWidth = 4;
      overlayCtx.setLineDash([10, 8]);
      overlayCtx.beginPath();
      overlayCtx.moveTo(doorPx, 0);
      overlayCtx.lineTo(doorPx, h);
      overlayCtx.stroke();

      overlayCtx.fillStyle = overlayCtx.strokeStyle;
      overlayCtx.font = 'bold 12px sans-serif';
      overlayCtx.fillText('BUS DOOR THRESHOLD', doorPx + 10, 24);
      overlayCtx.restore();

      // Draw Bus Interior Passenger Zone
      const bz = rules.busZone;
      const bzx = bz.x * w;
      const bzy = bz.y * h;
      const bzw = bz.w * w;
      const bzh = bz.h * h;

      overlayCtx.save();
      overlayCtx.strokeStyle = 'rgba(221, 167, 79, 0.6)';
      overlayCtx.lineWidth = 2;
      overlayCtx.strokeRect(bzx, bzy, bzw, bzh);

      overlayCtx.fillStyle = 'rgba(221, 167, 79, 0.12)';
      overlayCtx.fillRect(bzx, bzy, bzw, bzh);

      overlayCtx.fillStyle = '#dda74f';
      overlayCtx.font = 'bold 13px sans-serif';
      overlayCtx.fillText('BUS PASSENGER CABIN', bzx + 12, bzy + 24);
      overlayCtx.restore();

      // Draw Onboard Passenger Tokens
      Array.from(onboardPlayers).forEach((pid, idx) => {
        const p = players.find((item) => item.id === pid);
        if (!p) return;
        const seatX = bzx + 40 + (idx % 3) * 80;
        const seatY = bzy + 70 + Math.floor(idx / 3) * 70;

        overlayCtx.save();
        overlayCtx.fillStyle = p.team === 'B' ? '#536251' : '#e06d53';
        overlayCtx.beginPath();
        overlayCtx.arc(seatX, seatY, 18, 0, Math.PI * 2);
        overlayCtx.fill();

        overlayCtx.fillStyle = '#fff';
        overlayCtx.font = 'bold 11px sans-serif';
        overlayCtx.textAlign = 'center';
        overlayCtx.fillText(p.name.slice(0, 4), seatX, seatY + 4);
        overlayCtx.restore();
      });
    }

    async function evaluateVisionFrame(timestampSec) {
      if (!ctx.source || !ctx.source.video || !poseTracker) return;
      const vid = ctx.source.video;
      if (vid.readyState < 2) return;

      try {
        const detected = poseTracker.detect(vid, performance.now());
        if (Array.isArray(detected)) {
          detected.forEach((person, idx) => {
            const player = players[idx];
            if (!player) return;
            const center = person.torsoCenter || { x: person.x, y: person.y };
            const pos = playerPositions[player.id];
            if (!pos) return;

            pos.prevX = pos.currentX;
            pos.currentX = center.x;
            pos.y = center.y;

            // Check if player just stepped over door line
            if (!onboardPlayers.has(player.id)) {
              const verdict = evaluateBoardingStep({
                player,
                prevX: pos.prevX,
                currentX: pos.currentX,
                doorLineX: rules.doorLineX,
                signal: currentSignal,
                timestampSec
              });

              if (verdict.eventType === 'BOARD_SAFE') {
                onboardPlayers.add(player.id);
                triggerBoardingAction(player);
              } else if (verdict.eventType === 'BOARD_FOUL') {
                triggerBoardingAction(player);
              }
            }
          });
        }
      } catch (_) {
        // Vision tracking error is non-fatal; host manual controls remain active
      }
    }

    return {
      async start() {
        if (isActive) return;
        isActive = true;
        setupDOM();

        if (ctx.source) {
          try {
            await ctx.source.start();
          } catch (_) {}
        }

        try {
          await poseTracker.init();
        } catch (_) {}

        if (ctx.speak) {
          ctx.speak('All aboard the family bus. Board on green.');
        }

        stopLoop = runLoop((t) => {
          if (!isActive) return;

          // Check round time limit
          if (t >= rules.roundDurationSec) {
            this.stop();
            if (ctx.speak) ctx.speak('The bus ride is complete.');
            return;
          }

          // Handle signal switching cadence
          if (t >= nextSignalSwitchSec) {
            if (currentSignal === BUS_SIGNALS.GREEN) {
              currentSignal = BUS_SIGNALS.RED;
              nextSignalSwitchSec = t + rules.redDurationSec;
              if (ctx.beep) ctx.beep(330, 250);
              if (ctx.speak) ctx.speak('Horn blown. Doors closed.');
            } else {
              currentSignal = BUS_SIGNALS.GREEN;
              nextSignalSwitchSec = t + rules.greenDurationSec;
              if (ctx.beep) ctx.beep(520, 200);
              if (ctx.speak) ctx.speak('Doors open. Boarding now.');
            }
          }

          updateUIHeader(t);
          drawStage(t);
          evaluateVisionFrame(t);
        }, 15);
      },

      stop() {
        isActive = false;
        if (stopLoop) {
          stopLoop();
          stopLoop = null;
        }
      },

      getResult() {
        const scoresResult = calculateBusTournamentScores({
          events,
          players,
          mode: ctx.mode || 'both'
        });

        return buildResult({
          game: 'bus_count',
          players,
          rules,
          events,
          scores: {
            players: scoresResult.playerScores,
            teams: scoresResult.teamScores
          },
          winner: scoresResult.winner,
          evidence: ctx.evidence ? ctx.evidence.list() : [],
          stats: {
            totalPassengersOnBoard: onboardPlayers.size,
            totalBoardingFouls: events.filter((e) => e.type === 'BOARD_FOUL').length
          }
        });
      },

      destroy() {
        this.stop();
        if (ctx.source) {
          try {
            ctx.source.stop();
          } catch (_) {}
        }
        if (root) {
          root.innerHTML = '';
        }
      }
    };
  }
};
