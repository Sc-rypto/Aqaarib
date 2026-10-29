/**
 * Game 2: Hot Potato
 * /games/hot_potato.js - Person B Implementation
 *
 * Connects vision layer (poseTracker, faceMatch), pure rule engine (hotPotato.js),
 * and core stubs (inputSource, evidence, audio, report).
 */

import { poseTracker } from '../vision/poseTracker.js';
import { faceMatcher } from '../vision/faceMatch.js';
import {
  POTATO_MODES,
  generateRandomZone,
  judgeFramePure,
  calculateHotPotatoTournamentScores,
  generateHotPotatoReason
} from './logic/hotPotato.js';
import { inputSource } from '../dev/stubs/inputSource.js';
import { captureStill, drawEvidenceAnnotations, saveEvidence, getEvidenceList, clearEvidence } from '../dev/stubs/evidence.js';
import { audio } from '../dev/stubs/audio.js';
import { createReport } from '../dev/stubs/report.js';

/**
 * Standard judgeFrame function as required by the specification:
 * Runs pose and face recognition on that one frame, evaluates visibility and zone,
 * and matches each person to an enrolled player.
 *
 * @param {HTMLImageElement|HTMLVideoElement|HTMLCanvasElement} image
 * @param {'HIDE'|'ZONE'} mode
 * @param {{ x, y, width, height }|null} zone
 * @param {Array<{ id: string, name: string }>} players
 * @param {Object} manualAssignments - Optional manual host assignments
 * @returns {Promise<Object>}
 */
export async function judgeFrame(image, mode, zone, players, manualAssignments = {}) {
  // 1. Ensure vision modules are ready in image mode
  await poseTracker.init();
  await poseTracker.setRunningMode('IMAGE');
  await faceMatcher.init();

  // 2. Run Pose Landmarker on the still frame
  const detectedPeople = poseTracker.detect(image, performance.now());

  // 3. Run Human Face Identification on the still frame
  const detectedFaces = await faceMatcher.identify(image);

  // 4. Run pure rule matching
  const verdict = judgeFramePure({
    mode,
    zone,
    detectedPeople,
    detectedFaces,
    enrolledPlayers: players,
    manualAssignments
  });

  return verdict;
}

export class HotPotatoGame {
  constructor(options = {}) {
    this.totalRounds = 3;
    this.currentRound = 0; // 0 = unstarted, 1, 2, 3
    this.players = options.players || [
      { id: 'p1', name: 'Omar' },
      { id: 'p2', name: 'Sara' },
      { id: 'p3', name: 'Leo' }
    ];

    this.roundResultsHistory = []; // Array of round results
    this.events = [];
    this.sessionStartTimeMs = 0;

    this.currentMode = POTATO_MODES.HIDE;
    this.currentZone = null;
    this.roundActive = false;
    this.isCountingDown = false;
    this.pendingJudgement = null; // Stored when "Who is this?" host modal is open

    // Input mode: 'CAMERA' or 'VIDEO_FILE'
    this.inputMode = options.inputMode || 'CAMERA';

    // Callbacks
    this.onStateChange = options.onStateChange || (() => {});
    this.onEvent = options.onEvent || (() => {});
    this.onEvidenceCaptured = options.onEvidenceCaptured || (() => {});
    this.onHostPickerNeeded = options.onHostPickerNeeded || (() => {});
  }

  async init() {
    await poseTracker.init();
    await faceMatcher.init();
  }

  setPlayers(playerList) {
    this.players = playerList.map((p, idx) => ({
      id: p.id || `p${idx + 1}`,
      name: p.name || `Player ${idx + 1}`
    }));
  }

  setInputMode(mode) {
    this.inputMode = mode;
  }

  /**
   * Enrolls a player's face photo into memory.
   */
  async enrollPlayer(playerObj, imageSource) {
    const res = await faceMatcher.enroll(playerObj.name, imageSource);
    return res;
  }

  /**
   * Starts a round: picks random mode (HIDE or ZONE), generates zone if needed,
   * announces mode, and in camera mode triggers the hidden accelerating timer.
   */
  startRound() {
    if (this.currentRound >= this.totalRounds) {
      this.resetTournament();
    }

    if (this.currentRound === 0) {
      this.sessionStartTimeMs = Date.now();
      clearEvidence();
      this.roundResultsHistory = [];
      this.events = [];
    }

    this.currentRound += 1;
    this.roundActive = true;

    // Pick random mode: HIDE or ZONE
    this.currentMode = Math.random() > 0.5 ? POTATO_MODES.HIDE : POTATO_MODES.ZONE;

    // In ZONE mode, generate and display random danger rectangle before timer starts
    if (this.currentMode === POTATO_MODES.ZONE) {
      this.currentZone = generateRandomZone();
      audio.speak(`Round ${this.currentRound}: Danger Zone mode! Avoid the red rectangle!`);
    } else {
      this.currentZone = null;
      audio.speak(`Round ${this.currentRound}: Hide mode! Anyone visible is out!`);
    }

    this.onStateChange(this.getState());

    if (this.inputMode === 'CAMERA') {
      this._startCameraRoundTimer();
    }
  }

  _startCameraRoundTimer() {
    this.isCountingDown = true;
    // Hidden timer between 10s and 30s
    const timerDurationMs = Math.round(10000 + Math.random() * 20000);

    audio.startAcceleratingBeeps({
      totalDurationMs: timerDurationMs,
      onTick: (msRemaining) => {
        this.onStateChange(this.getState({ msRemaining }));
      },
      onComplete: () => {
        this.isCountingDown = false;
        audio.speak('Snap! Photo taken!');
        this.captureAndJudgeLiveFrame();
      }
    });
  }

  /**
   * Captures the current live frame from camera and judges it.
   */
  async captureAndJudgeLiveFrame() {
    const video = inputSource.getVideoElement();
    if (!video) {
      console.warn('No active camera video element found to capture');
      return;
    }

    const stillCanvas = captureStill(video, { width: 640, height: 480 });
    await this.processJudgement(stillCanvas);
  }

  /**
   * For video_file mode: judges a specific frame from recorded video.
   */
  async judgeSpecificFrame(videoOrCanvas) {
    const stillCanvas = captureStill(videoOrCanvas, { width: 640, height: 480 });
    await this.processJudgement(stillCanvas);
  }

  /**
   * Processes still frame judgment, handles host assignment if needed,
   * annotates evidence, and records scores.
   */
  async processJudgement(stillCanvas, manualAssignments = {}) {
    const verdict = await judgeFrame(
      stillCanvas,
      this.currentMode,
      this.currentZone,
      this.players,
      manualAssignments
    );

    // If there are people seen but faces not recognized, pause for host picker
    if (verdict.needsHostAssignment) {
      this.pendingJudgement = {
        stillCanvas,
        verdict
      };
      this.onHostPickerNeeded({
        stillCanvas,
        unmatchedPeople: verdict.unmatchedPeople,
        enrolledPlayers: this.players
      });
      return;
    }

    // All players resolved for this round
    this.pendingJudgement = null;
    this.roundResultsHistory.push(verdict.results);

    // Generate evidence snapshot with annotations
    const annotatedCanvas = captureStill(stillCanvas, { width: 640, height: 480 });
    drawEvidenceAnnotations(annotatedCanvas, {
      dangerZone: this.currentZone,
      boxes: verdict.results.map(r => ({
        ...(r.box || { x: 0.4, y: 0.2, width: 0.2, height: 0.6 }),
        label: r.playerName,
        isOut: r.isOut,
        reason: r.reason
      })),
      watermarkText: `Hot Potato R${this.currentRound} [${this.currentMode}]`
    });

    const dataUri = annotatedCanvas.toDataURL('image/jpeg', 0.85);

    // Save evidence card
    verdict.results.forEach(res => {
      const evItem = saveEvidence({
        title: `Round ${this.currentRound}: ${res.playerName}`,
        reason: res.reason,
        imageUri: dataUri,
        player: res.playerName,
        verdict: res.isOut ? 'CAUGHT' : 'SAFE',
        meta: { round: this.currentRound, mode: this.currentMode }
      });
      this.events.push({
        type: res.isOut ? 'CAUGHT' : 'SAFE',
        playerId: res.playerId,
        playerName: res.playerName,
        round: this.currentRound,
        mode: this.currentMode,
        reason: res.reason,
        timestampMs: Date.now()
      });
      this.onEvent(evItem);
    });

    this.onEvidenceCaptured(verdict);
    this.roundActive = false;

    // Check if tournament is over (3 rounds)
    if (this.currentRound >= this.totalRounds) {
      this._handleTournamentOver();
    } else {
      audio.speak(`Round ${this.currentRound} complete! Ready for next round.`);
    }

    this.onStateChange(this.getState());
  }

  /**
   * Resolves host manual picker and resumes judgment.
   */
  async resolveHostPicker(manualAssignments) {
    if (!this.pendingJudgement) return;
    const { stillCanvas } = this.pendingJudgement;
    await this.processJudgement(stillCanvas, manualAssignments);
  }

  _handleTournamentOver() {
    const scores = calculateHotPotatoTournamentScores(this.roundResultsHistory, this.players);
    const winner = scores[0];

    audio.speak(`Tournament complete! The winner is ${winner.name} with ${winner.points} points!`);
    audio.beep({ frequency: 783.99, duration: 0.5 });

    const finalReport = this.exportResult();
    this.onEvent({ type: 'TOURNAMENT_OVER', report: finalReport });
  }

  resetTournament() {
    this.currentRound = 0;
    this.roundResultsHistory = [];
    this.events = [];
    this.roundActive = false;
    this.isCountingDown = false;
    this.pendingJudgement = null;
    clearEvidence();
  }

  getState(extra = {}) {
    const standings = calculateHotPotatoTournamentScores(this.roundResultsHistory, this.players);
    return {
      currentRound: this.currentRound,
      totalRounds: this.totalRounds,
      currentMode: this.currentMode,
      currentZone: this.currentZone,
      roundActive: this.roundActive,
      isCountingDown: this.isCountingDown,
      inputMode: this.inputMode,
      players: this.players,
      standings,
      history: this.roundResultsHistory,
      needsHostAssignment: Boolean(this.pendingJudgement),
      ...extra
    };
  }

  exportResult() {
    const durationSec = (Date.now() - this.sessionStartTimeMs) / 1000;
    const standings = calculateHotPotatoTournamentScores(this.roundResultsHistory, this.players);

    const scoresMap = {};
    const strikesMap = {};
    standings.forEach(s => {
      scoresMap[s.playerId] = s.points;
      strikesMap[s.playerId] = s.catches;
    });

    return createReport({
      gameName: 'Hot Potato',
      sessionTimestamp: this.sessionStartTimeMs,
      durationSec,
      players: this.players,
      scores: scoresMap,
      strikes: strikesMap,
      events: this.events,
      evidence: getEvidenceList(),
      winner: standings[0] ? { id: standings[0].playerId, name: standings[0].name, score: standings[0].points } : null
    });
  }

  stop() {
    audio.stopTicking();
    this.roundActive = false;
    this.isCountingDown = false;
  }
}
