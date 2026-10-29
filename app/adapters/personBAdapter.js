/**
 * Motion Game Adapter
 * /app/adapters/personBAdapter.js
 *
 * Integrates RedLightGame and HotPotatoGame into the browser game interface.
 *
 * Full compatibility with core/report.js (majlis-result/1).
 */

import { RedLightGame } from '../../games/red_light.js';
import { HotPotatoGame } from '../../games/hot_potato.js';
import { buildResult, sanitizeRefereeText } from '../../core/report.js';

export const redLightModule = {
  id: 'red_light',
  title: 'Red Light Green Light',
  mode: 'individual',
  minPlayers: 2,
  maxPlayers: 4,
  rulesText: [
    'Line up in your assigned floor lane.',
    'Walk forward when the light is green.',
    'Freeze completely when the light turns red.',
    'Three strikes for moving on red will set you out.',
    'The first player to reach the finish line wins.'
  ],
  defaultRules: {
    numLanes: 3,
    finishLineY: 0.80
  },
  inputs: ['camera', 'video_file'],

  create(ctx) {
    const playersWithLanes = (ctx.players || []).map((p, idx) => ({
      ...p,
      lane: idx + 1
    }));

    let gameInstance = null;
    let containerEl = null;

    function renderDOM() {
      const root = ctx.root;
      if (!root) return;
      root.innerHTML = '';

      containerEl = document.createElement('div');
      containerEl.className = 'red-light-view';
      containerEl.style.cssText = 'position: relative; width: 100%; height: 100%; min-height: 460px; background: #1e1b18; border-radius: 1rem; overflow: hidden; display: flex; flex-direction: column;';

      // Traffic header
      const header = document.createElement('div');
      header.style.cssText = 'padding: 0.75rem 1rem; background: rgba(0,0,0,0.6); display: flex; justify-content: space-between; align-items: center; z-index: 10;';
      header.innerHTML = `
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <div style="display: flex; gap: 0.4rem; background: #12100e; padding: 0.3rem 0.6rem; border-radius: 9999px; border: 1px solid #3e3832;">
            <div id="rlBulbRed" style="width: 14px; height: 14px; border-radius: 50%; background: #441111;"></div>
            <div id="rlBulbYellow" style="width: 14px; height: 14px; border-radius: 50%; background: #443311;"></div>
            <div id="rlBulbGreen" style="width: 14px; height: 14px; border-radius: 50%; background: #2e7d32; box-shadow: 0 0 8px #2e7d32;"></div>
          </div>
          <span id="rlLightLabel" style="color: #fff; font-weight: 700; font-size: 0.9rem; text-transform: uppercase;">
            GREEN LIGHT
          </span>
        </div>
        <div id="rlStrikesStrip" style="display: flex; gap: 0.5rem;"></div>
      `;
      containerEl.appendChild(header);

      // Viewport
      const viewportWrap = document.createElement('div');
      viewportWrap.style.cssText = 'position: relative; flex: 1; width: 100%; overflow: hidden; display: flex; justify-content: center; align-items: center;';

      if (ctx.source && ctx.source.video) {
        const vid = ctx.source.video;
        vid.style.cssText = 'position: absolute; width: 100%; height: 100%; object-fit: cover;';
        viewportWrap.appendChild(vid);
      }

      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      canvas.style.cssText = 'position: absolute; width: 100%; height: 100%; object-fit: fill; z-index: 2;';
      viewportWrap.appendChild(canvas);

      containerEl.appendChild(viewportWrap);
      root.appendChild(containerEl);

      return { canvas, header };
    }

    return {
      async start() {
        const dom = renderDOM();
        if (ctx.source) {
          try {
            await ctx.source.start();
          } catch (_) {}
        }

        gameInstance = new RedLightGame({
          players: playersWithLanes,
          numLanes: ctx.rules?.numLanes || Math.min(4, Math.max(2, playersWithLanes.length)),
          finishLineY: ctx.rules?.finishLineY || 0.80,
          onStateChange: (state) => {
            if (!containerEl) return;
            const rBulb = containerEl.querySelector('#rlBulbRed');
            const yBulb = containerEl.querySelector('#rlBulbYellow');
            const gBulb = containerEl.querySelector('#rlBulbGreen');
            const label = containerEl.querySelector('#rlLightLabel');

            if (rBulb && yBulb && gBulb && label) {
              rBulb.style.background = state.currentLight === 'RED' ? '#ba1a1a' : '#441111';
              rBulb.style.boxShadow = state.currentLight === 'RED' ? '0 0 10px #ba1a1a' : 'none';

              yBulb.style.background = state.currentLight === 'YELLOW' ? '#dda74f' : '#443311';
              yBulb.style.boxShadow = state.currentLight === 'YELLOW' ? '0 0 10px #dda74f' : 'none';

              gBulb.style.background = state.currentLight === 'GREEN' ? '#2e7d32' : '#113311';
              gBulb.style.boxShadow = state.currentLight === 'GREEN' ? '0 0 10px #2e7d32' : 'none';

              label.textContent = `${state.currentLight} LIGHT`;
            }

            // Forward strike/finish events if any
            if (state.judge && Array.isArray(state.judge.events)) {
              const latest = state.judge.events[state.judge.events.length - 1];
              if (latest && latest._forwarded !== true) {
                latest._forwarded = true;
                const p = playersWithLanes.find((item) => item.id === latest.playerId);
                const evItem = {
                  t: ctx.now ? ctx.now() : 0,
                  type: latest.type,
                  player: latest.playerId,
                  team: p?.team || null,
                  points: latest.type === 'FINISH' ? 2 : (latest.type === 'STRIKE' ? -1 : 0),
                  reason: sanitizeRefereeText(latest.reason, 'Referee motion ruling.'),
                  evidence: null
                };
                if (ctx.emit) ctx.emit(evItem);
                if (ctx.speak && latest.reason) ctx.speak(latest.reason);
                if (ctx.beep) ctx.beep(latest.type === 'FINISH' ? 580 : 260, 200);
              }
            }
          }
        });

        if (ctx.speak) {
          ctx.speak('Red light green light is starting. Walk on green, freeze on red.');
        }

        gameInstance.start();
      },

      stop() {
        if (gameInstance) {
          gameInstance.stop();
        }
      },

      getResult() {
        const rawReport = gameInstance ? gameInstance.exportResult() : {};
        const events = (rawReport.events || []).map((ev) => {
          const p = playersWithLanes.find((item) => item.id === ev.playerId);
          return {
            t: Number(ev.timestampSec || 0),
            type: ev.type || 'STRIKE',
            player: ev.playerId || null,
            team: p?.team || null,
            points: ev.type === 'FINISH' ? 2 : (ev.type === 'STRIKE' ? -1 : 0),
            reason: sanitizeRefereeText(ev.reason, 'Red light ruling.'),
            evidence: null
          };
        });

        return buildResult({
          game: 'red_light',
          players: playersWithLanes,
          rules: ctx.rules || {},
          events,
          scores: {
            players: rawReport.scores || {},
            teams: { A: 0, B: 0 }
          },
          evidence: ctx.evidence ? ctx.evidence.list() : [],
          stats: {
            strikes: rawReport.strikes || {},
            lanes: ctx.rules?.numLanes || 3
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
        if (ctx.root) {
          ctx.root.innerHTML = '';
        }
      }
    };
  }
};

export const hotPotatoModule = {
  id: 'hot_potato',
  title: 'Hot Potato Photo Freeze',
  mode: 'individual',
  minPlayers: 2,
  maxPlayers: 8,
  rulesText: [
    'Listen to the accelerating audio beeps.',
    'In hide mode hide completely out of camera view.',
    'In zone mode stay clear of the danger rectangle.',
    'Each player safe from the photo catch earns one point.',
    'The player with the most points after three rounds wins.'
  ],
  defaultRules: {
    totalRounds: 3
  },
  inputs: ['camera', 'video_file'],

  create(ctx) {
    const players = ctx.players || [];
    let gameInstance = null;
    let containerEl = null;

    function renderDOM() {
      const root = ctx.root;
      if (!root) return;
      root.innerHTML = '';

      containerEl = document.createElement('div');
      containerEl.className = 'hot-potato-view';
      containerEl.style.cssText = 'position: relative; width: 100%; height: 100%; min-height: 460px; background: #1e1b18; border-radius: 1rem; overflow: hidden; display: flex; flex-direction: column;';

      const header = document.createElement('div');
      header.style.cssText = 'padding: 0.75rem 1rem; background: rgba(0,0,0,0.6); display: flex; justify-content: space-between; align-items: center; z-index: 10;';
      header.innerHTML = `
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <span id="hpRoundBadge" style="background: #e06d53; color: white; padding: 0.3rem 0.8rem; border-radius: 9999px; font-weight: 700; font-size: 0.85rem;">
            Round 1 / 3
          </span>
          <span id="hpModeBadge" style="background: #2e7d32; color: white; padding: 0.3rem 0.8rem; border-radius: 9999px; font-weight: 700; font-size: 0.85rem; text-transform: uppercase;">
            HIDE MODE
          </span>
        </div>
        <button id="hpNextRoundBtn" style="background: #3e3832; color: white; border: 1px solid #536251; padding: 0.35rem 0.8rem; border-radius: 0.4rem; font-size: 0.8rem; cursor: pointer;">
          Trigger Next Round
        </button>
      `;
      containerEl.appendChild(header);

      const viewportWrap = document.createElement('div');
      viewportWrap.style.cssText = 'position: relative; flex: 1; width: 100%; overflow: hidden; display: flex; justify-content: center; align-items: center;';

      if (ctx.source && ctx.source.video) {
        const vid = ctx.source.video;
        vid.style.cssText = 'position: absolute; width: 100%; height: 100%; object-fit: cover;';
        viewportWrap.appendChild(vid);
      }

      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      canvas.style.cssText = 'position: absolute; width: 100%; height: 100%; object-fit: fill; z-index: 2;';
      viewportWrap.appendChild(canvas);

      containerEl.appendChild(viewportWrap);
      root.appendChild(containerEl);

      const nextBtn = header.querySelector('#hpNextRoundBtn');
      nextBtn.addEventListener('click', () => {
        if (gameInstance) {
          gameInstance.startRound();
        }
      });
    }

    return {
      async start() {
        renderDOM();
        if (ctx.source) {
          try {
            await ctx.source.start();
          } catch (_) {}
        }

        gameInstance = new HotPotatoGame({
          totalRounds: ctx.rules?.totalRounds || 3,
          onStateChange: (state) => {
            if (!containerEl) return;
            const roundBadge = containerEl.querySelector('#hpRoundBadge');
            const modeBadge = containerEl.querySelector('#hpModeBadge');
            if (roundBadge) roundBadge.textContent = `Round ${state.currentRound} / ${state.totalRounds}`;
            if (modeBadge) {
              modeBadge.textContent = `${state.currentMode} MODE`;
              modeBadge.style.background = state.currentMode === 'ZONE' ? '#ba1a1a' : '#2e7d32';
            }
          },
          onEvent: (ev) => {
            const evItem = {
              t: ctx.now ? ctx.now() : 0,
              type: ev.type || 'PHOTO_SNAP',
              player: ev.playerId || null,
              team: null,
              points: ev.points || 0,
              reason: sanitizeRefereeText(ev.reason, 'Hot potato snap verdict.'),
              evidence: ev.evidenceId || null
            };
            if (ctx.emit) ctx.emit(evItem);
            if (ctx.speak && ev.reason) ctx.speak(ev.reason);
          }
        });

        gameInstance.setPlayers(players);
        try {
          await gameInstance.init();
        } catch (_) {}

        if (ctx.speak) {
          ctx.speak('Hot potato photo freeze is starting. Listen for the accelerating beeps.');
        }

        gameInstance.startRound();
      },

      stop() {
        if (gameInstance) {
          gameInstance.stop();
        }
      },

      getResult() {
        const rawReport = gameInstance ? gameInstance.exportResult() : {};
        const events = (rawReport.events || []).map((ev) => ({
          t: Number(ev.timestampSec || 0),
          type: ev.type || 'PHOTO_CATCH',
          player: ev.playerId || null,
          team: null,
          points: Number(ev.points || 0),
          reason: sanitizeRefereeText(ev.reason, 'Hot potato photo call.'),
          evidence: ev.evidenceId || null
        }));

        return buildResult({
          game: 'hot_potato',
          players,
          rules: ctx.rules || {},
          events,
          scores: {
            players: rawReport.scores || {},
            teams: { A: 0, B: 0 }
          },
          evidence: ctx.evidence ? ctx.evidence.list() : [],
          stats: {
            catches: rawReport.strikes || {}
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
        if (ctx.root) {
          ctx.root.innerHTML = '';
        }
      }
    };
  }
};
