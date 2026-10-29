/**
 * Family AI Game Day - Main Application Controller
 * /app/main.js
 *
 * Implements the hosted web app where a human host runs family games
 * and an AI judge watches the play, applies the rules, keeps score,
 * and explains every ruling with evidence.
 */

import { GAME_CATALOG } from '../data/gameCatalog.js';
import { getGameModule } from './gameLoader.js';
import { createInputSource } from '../core/inputSource.js';
import { createEvidenceStore } from '../core/evidence.js';
import { beep, speak } from '../core/audio.js';
import { buildResult, sanitizeRefereeText } from '../core/report.js';

class GameDayApp {
  constructor() {
    this.currentView = 'LOBBY'; // LOBBY, RULES, ARENA, RESULTS
    this.selectedGameId = 'bus_count';
    this.selectedInputType = 'camera';
    this.selectedVideoFile = null;

    this.players = [
      { id: 'p1', name: 'Sara', team: 'A' },
      { id: 'p2', name: 'Omar', team: 'A' },
      { id: 'p3', name: 'Grandma', team: 'B' },
      { id: 'p4', name: 'Tariq', team: 'B' }
    ];

    this.ruleOverrides = {};
    this.activeGameInstance = null;
    this.activeInputSource = null;
    this.evidenceStore = null;

    this.sessionStartTime = 0;
    this.sessionEvents = [];
    this.finalResult = null;
    this.hostReversals = new Set();

    this.appRoot = document.getElementById('appMount');
  }

  init() {
    this.render();
  }

  render() {
    if (!this.appRoot) return;
    this.appRoot.innerHTML = '';

    switch (this.currentView) {
      case 'LOBBY':
        this.renderLobby();
        break;
      case 'RULES':
        this.renderRules();
        break;
      case 'ARENA':
        this.renderArena();
        break;
      case 'RESULTS':
        this.renderResults();
        break;
      default:
        this.renderLobby();
    }
  }

  /* -------------------------------------------------------------
   * 1. LOBBY VIEW
   * ------------------------------------------------------------- */
  renderLobby() {
    const wrap = document.createElement('div');

    wrap.innerHTML = `
      <section class="hero-card">
        <div style="display: flex; gap: 0.5rem; margin-bottom: 0.75rem;">
          <span class="pill-tag green">Zero Cloud Cost</span>
          <span class="pill-tag ochre">Edge Vision Referee</span>
          <span class="pill-tag terracotta">100% Privacy</span>
        </div>
        <h1 class="hero-title">Family AI Game Day</h1>
        <p class="hero-description">
          A hosted family parlor where the referee watches each round, applies the rules fairly,
          keeps score, and explains every call with photo evidence.
        </p>
      </section>

      <div class="paper-card elevated">
        <h2 class="section-headline">1. Choose Your Family Game</h2>
        <p class="section-subhead">Select one of five referee assisted party games.</p>

        <div class="game-selector-grid" id="gameGrid"></div>
      </div>

      <div class="paper-card elevated">
        <h2 class="section-headline">2. Family Roster and Teams</h2>
        <p class="section-subhead">Add players and assign them to Team A, Team B, or Individual.</p>

        <div class="roster-grid" id="rosterGrid"></div>

        <div style="display: flex; gap: 0.5rem; margin-top: 1rem; flex-wrap: wrap;">
          <input type="text" id="newPlayerName" placeholder="Enter player name" style="padding: 0.55rem 0.85rem; border: 1px solid var(--border-strong); border-radius: 9999px; font-size: 0.88rem; outline: none;" />
          <select id="newPlayerTeam" style="padding: 0.55rem 0.85rem; border: 1px solid var(--border-strong); border-radius: 9999px; font-size: 0.88rem; background: #fff;">
            <option value="A">Team A</option>
            <option value="B">Team B</option>
            <option value="null">Individual</option>
          </select>
          <button id="btnAddPlayer" class="btn-referee-secondary btn-referee-small">
            Add Player
          </button>
        </div>
      </div>

      <div class="paper-card elevated">
        <h2 class="section-headline">3. Match Input Source</h2>
        <p class="section-subhead">Select how the referee will observe the round.</p>

        <div style="display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: center;" id="inputSelectorRow">
          <label style="display: flex; align-items: center; gap: 0.4rem; cursor: pointer; font-size: 0.9rem;">
            <input type="radio" name="inputType" value="camera" ${this.selectedInputType === 'camera' ? 'checked' : ''} />
            Live Camera
          </label>
          <label style="display: flex; align-items: center; gap: 0.4rem; cursor: pointer; font-size: 0.9rem;">
            <input type="radio" name="inputType" value="video_file" ${this.selectedInputType === 'video_file' ? 'checked' : ''} />
            Video File
          </label>
          <label style="display: flex; align-items: center; gap: 0.4rem; cursor: pointer; font-size: 0.9rem;">
            <input type="radio" name="inputType" value="report_file" ${this.selectedInputType === 'report_file' ? 'checked' : ''} />
            Signed Match Report
          </label>
        </div>

        <div id="videoFileRow" style="margin-top: 1rem; display: ${this.selectedInputType === 'video_file' ? 'block' : 'none'};">
          <input type="file" id="videoFileInput" accept="video/*" style="font-size: 0.85rem;" />
        </div>
      </div>

      <div style="display: flex; justify-content: flex-end; margin-top: 1.5rem;">
        <button id="btnProceedToRules" class="btn-referee-primary">
          Review Rules and Tune
        </button>
      </div>
    `;

    this.appRoot.appendChild(wrap);

    // Populate game cards
    const gameGrid = wrap.querySelector('#gameGrid');
    GAME_CATALOG.forEach((game) => {
      const card = document.createElement('div');
      card.className = `game-select-card ${game.id === this.selectedGameId ? 'active' : ''}`;
      card.innerHTML = `
        <div>
          <h3 class="game-card-title">${game.title}</h3>
          <p class="game-card-tagline">${game.tagline}</p>
        </div>
        <div class="game-card-meta">
          <span class="pill-tag ochre">${game.minPlayers} to ${game.maxPlayers} Players</span>
          <span class="pill-tag ${game.mode === 'team' ? 'sage' : 'terracotta'}">${game.mode} Mode</span>
        </div>
      `;
      card.addEventListener('click', () => {
        this.selectedGameId = game.id;
        if (game.inputs.includes('report_file') && !game.inputs.includes('camera')) {
          this.selectedInputType = 'report_file';
        } else if (!game.inputs.includes(this.selectedInputType)) {
          this.selectedInputType = game.inputs[0];
        }
        this.render();
      });
      gameGrid.appendChild(card);
    });

    // Populate roster
    const rosterGrid = wrap.querySelector('#rosterGrid');
    this.players.forEach((p, idx) => {
      const chip = document.createElement('div');
      chip.className = 'player-chip';
      chip.innerHTML = `
        <span class="player-chip-name">${p.name}</span>
        <div style="display: flex; gap: 0.4rem; align-items: center;">
          <span class="pill-tag ${p.team === 'A' ? 'terracotta' : p.team === 'B' ? 'sage' : ''}">
            ${p.team ? `Team ${p.team}` : 'Solo'}
          </span>
          <button data-remove="${idx}" style="background: none; border: none; color: #a49e96; cursor: pointer; font-size: 1rem; padding: 0 0.3rem;">✕</button>
        </div>
      `;
      chip.querySelector('[data-remove]').addEventListener('click', (e) => {
        const removeIdx = Number(e.target.dataset.remove);
        this.players.splice(removeIdx, 1);
        this.render();
      });
      rosterGrid.appendChild(chip);
    });

    // Add player button
    wrap.querySelector('#btnAddPlayer').addEventListener('click', () => {
      const nameInput = wrap.querySelector('#newPlayerName');
      const teamInput = wrap.querySelector('#newPlayerTeam');
      const name = nameInput.value.trim();
      if (!name) return;
      const teamVal = teamInput.value === 'null' ? null : teamInput.value;
      this.players.push({
        id: `p${this.players.length + 1}`,
        name,
        team: teamVal
      });
      this.render();
    });

    // Input type radio buttons
    wrap.querySelectorAll('input[name="inputType"]').forEach((radio) => {
      radio.addEventListener('change', (e) => {
        this.selectedInputType = e.target.value;
        const fileRow = wrap.querySelector('#videoFileRow');
        if (fileRow) fileRow.style.display = this.selectedInputType === 'video_file' ? 'block' : 'none';
      });
    });

    const fileInput = wrap.querySelector('#videoFileInput');
    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        this.selectedVideoFile = e.target.files[0] || null;
      });
    }

    // Proceed to Rules
    wrap.querySelector('#btnProceedToRules').addEventListener('click', () => {
      if (this.players.length === 0) {
        alert('Please add at least one player to join the game.');
        return;
      }
      this.currentView = 'RULES';
      this.render();
    });
  }

  /* -------------------------------------------------------------
   * 2. RULES & CALIBRATION VIEW
   * ------------------------------------------------------------- */
  renderRules() {
    const game = GAME_CATALOG.find((g) => g.id === this.selectedGameId);
    const wrap = document.createElement('div');

    const rulesList = (game?.rulesText || [])
      .map((r, i) => `<li style="margin-bottom: 0.6rem; font-size: 0.95rem; line-height: 1.5;">${r}</li>`)
      .join('');

    wrap.innerHTML = `
      <div class="paper-card elevated">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
          <div>
            <h2 class="section-headline">${game?.title} Rules</h2>
            <p class="section-subhead">Official family rules explained in plain language.</p>
          </div>
          <span class="pill-tag terracotta">${game?.mode} Mode</span>
        </div>

        <ol style="padding-left: 1.25rem; color: var(--text-main);">
          ${rulesList}
        </ol>

        <div style="margin-top: 1.5rem; padding: 1.25rem; background: var(--bg-surface-elevated); border: 1px solid var(--border-hairline); border-radius: 0.75rem;">
          <h3 style="margin: 0 0 0.5rem 0; font-family: var(--font-label); font-size: 0.85rem; font-weight: 700; text-transform: uppercase;">
            Referee Guarantee
          </h3>
          <p style="margin: 0; font-size: 0.85rem; color: var(--text-muted); line-height: 1.5;">
            Every single AI decision includes an explanation and photo evidence.
            As human host, you retain absolute authority to reverse any decision before results are confirmed.
          </p>
        </div>

        <div style="display: flex; justify-content: space-between; margin-top: 2rem;">
          <button id="btnBackToLobby" class="btn-referee-secondary">
            Back to Setup
          </button>
          <button id="btnStartGame" class="btn-referee-primary">
            Start Match
          </button>
        </div>
      </div>
    `;

    this.appRoot.appendChild(wrap);

    wrap.querySelector('#btnBackToLobby').addEventListener('click', () => {
      this.currentView = 'LOBBY';
      this.render();
    });

    wrap.querySelector('#btnStartGame').addEventListener('click', () => {
      this.startGame();
    });
  }

  /* -------------------------------------------------------------
   * 3. START GAME & ARENA VIEW
   * ------------------------------------------------------------- */
  async startGame() {
    this.sessionStartTime = Date.now();
    this.sessionEvents = [];
    this.hostReversals.clear();
    this.evidenceStore = createEvidenceStore();

    // Create Input Source
    try {
      this.activeInputSource = createInputSource({
        type: this.selectedInputType === 'video_file' ? 'video_file' : 'camera',
        file: this.selectedVideoFile,
        audio: false
      });
    } catch (err) {
      alert(`Could not start media: ${err.message}`);
      return;
    }

    this.currentView = 'ARENA';
    this.render();
  }

  renderArena() {
    const game = GAME_CATALOG.find((g) => g.id === this.selectedGameId);
    const wrap = document.createElement('div');

    wrap.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem;">
        <div>
          <h2 class="section-headline" style="margin-bottom: 0.2rem;">${game?.title}</h2>
          <span class="pill-tag green" id="refereeStatusPill">Referee Watching Live</span>
        </div>
        <div style="display: flex; gap: 0.5rem;">
          <button id="btnEndMatch" class="btn-referee-primary">
            End Match and Tally Results
          </button>
        </div>
      </div>

      <div class="arena-grid">
        <!-- Main Game Mount Canvas/Viewport -->
        <div>
          <div class="paper-card" style="padding: 0.75rem; margin-bottom: 1rem;">
            <div id="gameViewportMount" style="width: 100%; min-height: 440px; border-radius: 0.75rem; overflow: hidden;"></div>

            <!-- Live Score Strip -->
            <div class="live-score-strip" id="liveScoreStrip"></div>
          </div>
        </div>

        <!-- Live Referee Call Feed -->
        <div>
          <div class="paper-card" style="padding: 1.25rem; height: calc(100% - 2.5rem);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
              <h3 style="margin: 0; font-family: var(--font-label); font-size: 0.85rem; font-weight: 700; text-transform: uppercase;">
                Referee Decision Feed
              </h3>
              <span id="callCountBadge" class="pill-tag ochre">0 Calls</span>
            </div>

            <div class="event-feed" id="eventFeed">
              <div style="font-size: 0.82rem; color: var(--text-subtle); text-align: center; padding: 2rem 0;">
                Awaiting first play event...
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.appRoot.appendChild(wrap);

    this.renderScores();

    wrap.querySelector('#btnEndMatch').addEventListener('click', () => {
      this.finishGame();
    });

    // Mount game instance
    const gameModule = getGameModule(this.selectedGameId);
    if (!gameModule) {
      alert('Selected game module is not loaded.');
      return;
    }

    const mountEl = wrap.querySelector('#gameViewportMount');

    const ctx = {
      players: this.players,
      rules: this.ruleOverrides,
      source: this.activeInputSource,
      root: mountEl,
      evidence: this.evidenceStore,
      speak: (text, lang) => speak(text, lang),
      beep: (freq, ms) => beep(freq, ms),
      now: () => Number(((Date.now() - this.sessionStartTime) / 1000).toFixed(1)),
      emit: (ev) => {
        this.handleGameEvent(ev);
      }
    };

    try {
      this.activeGameInstance = gameModule.create(ctx);
      this.activeGameInstance.start();
    } catch (err) {
      console.error('Error starting game instance:', err);
    }
  }

  handleGameEvent(ev) {
    const sanitizedReason = sanitizeRefereeText(ev.reason, 'Points awarded.');
    const eventItem = {
      ...ev,
      t: Number((Number(ev.t) || (Date.now() - this.sessionStartTime) / 1000).toFixed(1)),
      reason: sanitizedReason,
      eventId: `event_${this.sessionEvents.length + 1}`
    };

    this.sessionEvents.push(eventItem);
    this.renderScores();
    this.renderEventFeed();
  }

  renderScores() {
    const strip = document.getElementById('liveScoreStrip');
    if (!strip) return;
    strip.innerHTML = '';

    // Calculate current live points
    const pScores = {};
    const tScores = { A: 0, B: 0 };
    this.players.forEach((p) => (pScores[p.id] = 0));

    this.sessionEvents.forEach((ev) => {
      if (this.hostReversals.has(ev.eventId)) return;
      const pts = Number(ev.points) || 0;
      if (ev.player && pScores[ev.player] !== undefined) {
        pScores[ev.player] += pts;
      }
      if (ev.team && (ev.team === 'A' || ev.team === 'B')) {
        tScores[ev.team] += pts;
      }
    });

    // Team scores
    if (this.players.some((p) => p.team !== null)) {
      const cellA = document.createElement('div');
      cellA.className = 'score-cell';
      cellA.innerHTML = `<span class="score-cell-label" style="color: var(--accent-terracotta);">Team A</span><span class="score-cell-value">${tScores.A}</span>`;
      strip.appendChild(cellA);

      const cellB = document.createElement('div');
      cellB.className = 'score-cell';
      cellB.innerHTML = `<span class="score-cell-label" style="color: var(--accent-sage);">Team B</span><span class="score-cell-value">${tScores.B}</span>`;
      strip.appendChild(cellB);
    }

    // Player scores
    this.players.forEach((p) => {
      const cell = document.createElement('div');
      cell.className = 'score-cell';
      cell.innerHTML = `
        <span class="score-cell-label">${p.name}</span>
        <span class="score-cell-value">${pScores[p.id] || 0}</span>
      `;
      strip.appendChild(cell);
    });
  }

  renderEventFeed() {
    const feed = document.getElementById('eventFeed');
    const badge = document.getElementById('callCountBadge');
    if (!feed) return;

    if (badge) badge.textContent = `${this.sessionEvents.length} Calls`;
    feed.innerHTML = '';

    [...this.sessionEvents].reverse().forEach((ev) => {
      const isReversed = this.hostReversals.has(ev.eventId);
      const p = this.players.find((item) => item.id === ev.player);
      const item = document.createElement('div');
      item.className = `event-item ${isReversed ? 'reversed' : ''}`;

      item.innerHTML = `
        <div class="event-header">
          <span>${p ? p.name : 'Match Event'} • ${ev.t}s</span>
          <span style="font-weight: 700; color: ${ev.points >= 0 ? '#2e7d32' : '#ba1a1a'};">
            ${isReversed ? 'REVERSED' : (ev.points > 0 ? `+${ev.points}` : ev.points)}
          </span>
        </div>
        <div class="event-reason">${ev.reason}</div>
        <div class="event-actions">
          <button class="btn-referee-secondary btn-referee-small" data-reverse-id="${ev.eventId}">
            ${isReversed ? 'Restore Call' : 'Reverse Call'}
          </button>
        </div>
      `;

      item.querySelector('[data-reverse-id]').addEventListener('click', () => {
        this.toggleReversal(ev.eventId);
      });

      feed.appendChild(item);
    });
  }

  toggleReversal(eventId) {
    if (this.hostReversals.has(eventId)) {
      this.hostReversals.delete(eventId);
      speak('Host restored the call.');
    } else {
      this.hostReversals.add(eventId);
      speak('Host reversed the decision.');
    }
    this.renderScores();
    this.renderEventFeed();
  }

  /* -------------------------------------------------------------
   * 4. FINISH GAME & RESULTS VIEW
   * ------------------------------------------------------------- */
  finishGame() {
    if (this.activeGameInstance) {
      try {
        const rawRes = this.activeGameInstance.getResult();
        this.finalResult = rawRes;
      } catch (err) {
        console.error('Error getting result from instance:', err);
      }
      try {
        this.activeGameInstance.destroy();
      } catch (_) {}
      this.activeGameInstance = null;
    }

    if (this.activeInputSource) {
      try {
        this.activeInputSource.stop();
      } catch (_) {}
      this.activeInputSource = null;
    }

    // Merge sessionEvents and compute scores factoring in host reversals
    const pScores = {};
    const tScores = { A: 0, B: 0 };
    this.players.forEach((p) => (pScores[p.id] = 0));

    const finalEvents = [];
    const allEvents = (this.finalResult?.events && this.finalResult.events.length > 0)
      ? this.finalResult.events
      : this.sessionEvents;

    allEvents.forEach((ev, idx) => {
      const eid = ev.eventId || `event_${idx + 1}`;
      const isReversed = this.hostReversals.has(eid);
      const points = isReversed ? 0 : Number(ev.points) || 0;
      const reason = isReversed
        ? `${sanitizeRefereeText(ev.reason)} Call reversed by host.`
        : sanitizeRefereeText(ev.reason);

      if (ev.player && pScores[ev.player] !== undefined) {
        pScores[ev.player] += points;
      }
      if (ev.team && (ev.team === 'A' || ev.team === 'B')) {
        tScores[ev.team] += points;
      }

      finalEvents.push({
        ...ev,
        points,
        reason,
        eventId: eid
      });
    });

    // Ensure non-negative scores
    Object.keys(pScores).forEach((k) => {
      if (pScores[k] < 0) pScores[k] = 0;
    });
    if (tScores.A < 0) tScores.A = 0;
    if (tScores.B < 0) tScores.B = 0;

    // Determine winner
    let winner;
    const hasTeams = this.players.some((p) => p.team !== null);
    if (hasTeams) {
      if (tScores.A > tScores.B) {
        winner = { kind: 'team', id: 'A', reason: `Team A won with ${tScores.A} points.` };
      } else if (tScores.B > tScores.A) {
        winner = { kind: 'team', id: 'B', reason: `Team B won with ${tScores.B} points.` };
      } else {
        winner = { kind: 'tie', id: null, reason: 'Both teams finished with equal points.' };
      }
    } else {
      let topScore = -1;
      let topPlayer = null;
      let isTie = false;

      this.players.forEach((p) => {
        const s = pScores[p.id] || 0;
        if (s > topScore) {
          topScore = s;
          topPlayer = p;
          isTie = false;
        } else if (s === topScore) {
          isTie = true;
        }
      });

      if (!topPlayer || isTie) {
        winner = { kind: 'tie', id: null, reason: 'The match ended in a tie.' };
      } else {
        winner = { kind: 'player', id: topPlayer.id, reason: `${topPlayer.name} won with ${topScore} points.` };
      }
    }

    const evidenceList = this.evidenceStore ? this.evidenceStore.list() : (this.finalResult?.evidence || []);

    this.finalResult = buildResult({
      game: this.selectedGameId,
      players: this.players,
      events: finalEvents,
      scores: {
        players: pScores,
        teams: tScores
      },
      winner,
      evidence: evidenceList,
      stats: {
        totalCalls: finalEvents.length,
        hostReversals: this.hostReversals.size
      }
    });

    speak(`Game over. ${winner.reason}`);
    this.currentView = 'RESULTS';
    this.render();
  }

  renderResults() {
    const res = this.finalResult;
    if (!res) {
      this.currentView = 'LOBBY';
      this.render();
      return;
    }

    const wrap = document.createElement('div');

    // Build evidence cards
    const evidenceCards = (res.evidence || [])
      .map((ev) => {
        if (ev.type === 'image' && ev.data) {
          return `
            <div class="polaroid-card">
              <img src="data:image/jpeg;base64,${ev.data}" class="polaroid-photo" alt="${ev.caption}" />
              <div class="polaroid-caption">${ev.caption}</div>
              <div class="polaroid-meta">Photo Evidence • ${ev.t}s</div>
            </div>
          `;
        } else {
          return `
            <div class="polaroid-card">
              <div style="background: #f4eee6; padding: 1.5rem 1rem; border-radius: 4px; font-size: 0.88rem; line-height: 1.45;">
                ${ev.data}
              </div>
              <div class="polaroid-caption">${ev.caption}</div>
              <div class="polaroid-meta">Text Log • ${ev.t}s</div>
            </div>
          `;
        }
      })
      .join('');

    // Build scores list
    const playerScoresList = res.players
      .map((p) => `
        <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--border-hairline);">
          <span><strong>${p.name}</strong> ${p.team ? `(Team ${p.team})` : ''}</span>
          <span style="font-weight: 700;">${res.scores.players[p.id] || 0} pts</span>
        </div>
      `)
      .join('');

    wrap.innerHTML = `
      <section class="hero-card" style="text-align: center; padding: 2.5rem 1.5rem;">
        <span class="pill-tag green" style="margin-bottom: 0.75rem;">Match Concluded</span>
        <h1 class="hero-title" style="font-size: 2.2rem; margin-bottom: 0.5rem;">
          ${res.winner.reason}
        </h1>
        <p style="font-size: 1rem; color: var(--text-muted); margin: 0;">
          All rulings verified. Every call documented below with photographic evidence.
        </p>
      </section>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 1.75rem;">
        <!-- Final Standings -->
        <div class="paper-card elevated">
          <h2 class="section-headline">Final Standings</h2>
          <div style="margin-top: 1rem;">
            ${res.players.some((p) => p.team) ? `
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.25rem;">
                <div style="background: var(--accent-terracotta-soft); padding: 1rem; border-radius: 0.75rem; text-align: center;">
                  <div style="font-size: 0.75rem; font-weight: 700; text-transform: uppercase; color: var(--accent-terracotta);">Team A</div>
                  <div style="font-family: var(--font-serif); font-size: 2rem; font-weight: 700;">${res.scores.teams.A}</div>
                </div>
                <div style="background: var(--accent-sage-soft); padding: 1rem; border-radius: 0.75rem; text-align: center;">
                  <div style="font-size: 0.75rem; font-weight: 700; text-transform: uppercase; color: var(--accent-sage);">Team B</div>
                  <div style="font-family: var(--font-serif); font-size: 2rem; font-weight: 700;">${res.scores.teams.B}</div>
                </div>
              </div>
            ` : ''}
            <div>${playerScoresList}</div>
          </div>
        </div>

        <!-- Match Actions & Download -->
        <div class="paper-card elevated" style="display: flex; flex-direction: column; justify-content: space-between;">
          <div>
            <h2 class="section-headline">Export Match Report</h2>
            <p class="section-subhead">
              Frozen Schema Version 1 result object ready for archive or Cloudflare static distribution.
            </p>
            <div style="background: var(--bg-surface-elevated); padding: 0.9rem; border-radius: 0.5rem; font-size: 0.8rem; font-family: monospace; color: var(--text-muted);">
              Schema: ${res.schema}<br/>
              Session ID: ${res.sessionId}<br/>
              Events: ${res.events.length} • Evidence Items: ${res.evidence.length}
            </div>
          </div>

          <div style="display: flex; gap: 0.75rem; margin-top: 1.5rem;">
            <button id="btnDownloadJson" class="btn-referee-primary" style="flex: 1;">
              Download Result JSON
            </button>
            <button id="btnPlayAgain" class="btn-referee-secondary">
              Play Next Game
            </button>
          </div>
        </div>
      </div>

      <!-- Evidence Gallery -->
      <div class="paper-card elevated">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
          <h2 class="section-headline">Photographic Evidence Gallery</h2>
          <span class="pill-tag terracotta">${res.evidence.length} Snapshots</span>
        </div>
        <p class="section-subhead">Visual proof generated by the referee camera.</p>

        <div class="evidence-gallery">
          ${evidenceCards || '<p style="color: var(--text-subtle); font-size: 0.9rem;">No snapshots recorded for this match.</p>'}
        </div>
      </div>
    `;

    this.appRoot.appendChild(wrap);

    wrap.querySelector('#btnDownloadJson').addEventListener('click', () => {
      this.downloadResultJson();
    });

    wrap.querySelector('#btnPlayAgain').addEventListener('click', () => {
      this.currentView = 'LOBBY';
      this.render();
    });
  }

  downloadResultJson() {
    if (!this.finalResult) return;
    const jsonStr = JSON.stringify(this.finalResult, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `result_${this.finalResult.game}_${this.finalResult.sessionId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

// Bootstrap application on page load
window.addEventListener('DOMContentLoaded', () => {
  const app = new GameDayApp();
  app.init();
});
