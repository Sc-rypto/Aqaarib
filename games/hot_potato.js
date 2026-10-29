/**
 * Aqaarib Games - Hot Potato (Photo Freeze)
 * Manages accelerating countdown, snap photo capture, and visual highlighting.
 */

import { poseTracker } from '../vision/poseTracker.js';
import { faceMatcher } from '../vision/faceMatch.js';
import {
  POTATO_MODES,
  generateRandomZone,
  judgeFramePure,
  calculateHotPotatoTournamentScores
} from './logic/hotPotato.js';
import { inputSource } from '../dev/stubs/inputSource.js';
import { captureStill, drawEvidenceAnnotations, saveEvidence, getEvidenceList, clearEvidence } from '../dev/stubs/evidence.js';
import { audio } from '../dev/stubs/audio.js';
import { createReport } from '../dev/stubs/report.js';

export async function judgeFrame(image, mode, zone, players, manualAssignments = {}) {
  await poseTracker.init();
  await poseTracker.setRunningMode('IMAGE');
  await faceMatcher.init();

  const detectedPeople = poseTracker.detect(image, performance.now());
  const detectedFaces = await faceMatcher.identify(image);

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
    this.currentRound = 0;
    this.players = options.players || [
      { id: 'p1', name: 'Omar' },
      { id: 'p2', name: 'Sara' },
      { id: 'p3', name: 'Leo' }
    ];

    this.roundResultsHistory = [];
    this.events = [];
    this.sessionStartTimeMs = 0;

    this.currentMode = POTATO_MODES.HIDE;
    this.currentZone = null;
    this.roundActive = false;
    this.isCountingDown = false;
    this.lastJudgedImageUri = null;

    this.inputMode = options.inputMode || 'CAMERA';

    this.onStateChange = options.onStateChange || (() => {});
    this.onEvent = options.onEvent || (() => {});
    this.onEvidenceCaptured = options.onEvidenceCaptured || (() => {});
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

  async enrollPlayer(playerObj, imageSource) {
    const res = await faceMatcher.enroll(playerObj.name, imageSource);
    return res;
  }

  async narrateRules(onStep = () => {}) {
    const steps = [
      { step: 1, text: "Welcome to Hot Potato! Each round has a secret, accelerating timer." },
      { step: 2, text: "Listen carefully to the beeps as they speed up!" },
      { step: 3, text: "When the buzzer fires, the camera immediately snaps a freeze photo." },
      { step: 4, text: "In Hide Mode, make sure no one is visible. In Zone Mode, avoid the red danger box!" },
      { step: 5, text: "Anyone caught in the frame is out for the round. Survive to score points!" }
    ];

    for (const item of steps) {
      onStep(item);
      await audio.speak(item.text);
      await new Promise(r => setTimeout(r, 300));
    }
  }

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

    this.currentMode = Math.random() > 0.5 ? POTATO_MODES.HIDE : POTATO_MODES.ZONE;

    if (this.currentMode === POTATO_MODES.ZONE) {
      this.currentZone = generateRandomZone();
      audio.speak(`Round ${this.currentRound}: Danger Zone mode! Avoid the red box!`);
    } else {
      this.currentZone = null;
      audio.speak(`Round ${this.currentRound}: Hide mode! Get out of sight!`);
    }

    this.onStateChange(this.getState());

    if (this.inputMode === 'CAMERA') {
      this._startCameraRoundTimer();
    }
  }

  _startCameraRoundTimer() {
    this.isCountingDown = true;
    // Faster timer: 5 to 9 seconds with rapid acceleration
    const timerDurationMs = Math.round(5000 + Math.random() * 4000);

    audio.startAcceleratingBeeps({
      totalDurationMs: timerDurationMs,
      onTick: (msRemaining) => {
        this.onStateChange(this.getState({ msRemaining }));
      },
      onComplete: () => {
        this.isCountingDown = false;
        audio.speak('Snap! Photo captured!');
        this.captureAndJudgeLiveFrame();
      }
    });
  }

  async captureAndJudgeLiveFrame() {
    const video = inputSource.getVideoElement();
    if (!video) return;

    const stillCanvas = captureStill(video, { width: 640, height: 480 });
    await this.processJudgement(stillCanvas);
  }

  async judgeSpecificFrame(videoOrCanvas) {
    const stillCanvas = captureStill(videoOrCanvas, { width: 640, height: 480 });
    await this.processJudgement(stillCanvas);
  }

  async processJudgement(stillCanvas) {
    const verdict = await judgeFrame(
      stillCanvas,
      this.currentMode,
      this.currentZone,
      this.players
    );

    this.roundResultsHistory.push(verdict.results);

    // Draw prominent highlight rectangles over detected people
    const annotatedCanvas = captureStill(stillCanvas, { width: 640, height: 480 });
    drawEvidenceAnnotations(annotatedCanvas, {
      dangerZone: this.currentZone,
      boxes: verdict.results.map(r => ({
        ...(r.box || { x: 0.35, y: 0.2, width: 0.3, height: 0.6 }),
        label: r.playerName,
        isOut: r.isOut,
        reason: r.reason
      })),
      watermarkText: `Aqaarib Hot Potato • Round ${this.currentRound} (${this.currentMode})`
    });

    const dataUri = annotatedCanvas.toDataURL('image/jpeg', 0.90);
    this.lastJudgedImageUri = dataUri;

    // Check who was caught vs safe
    const caughtPlayers = verdict.results.filter(r => r.isOut);
    const safePlayers = verdict.results.filter(r => !r.isOut);

    if (caughtPlayers.length > 0) {
      const names = caughtPlayers.map(p => p.playerName).join(', ');
      audio.speak(`${names} caught out!`);
    } else {
      audio.speak('Everyone survived this round!');
    }

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

    this.onEvidenceCaptured({
      ...verdict,
      imageUri: dataUri,
      caughtPlayers,
      safePlayers
    });
    this.roundActive = false;

    if (this.currentRound >= this.totalRounds) {
      this._handleTournamentOver();
    } else {
      audio.speak(`Round ${this.currentRound} complete.`);
    }

    this.onStateChange(this.getState({ lastJudgedImageUri: dataUri, verdict }));
  }

  _handleTournamentOver() {
    const scores = calculateHotPotatoTournamentScores(this.roundResultsHistory, this.players);
    const winner = scores[0];

    audio.speak(`Game over! The winner is ${winner.name} with ${winner.points} points!`);
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
    this.lastJudgedImageUri = null;
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
      lastJudgedImageUri: this.lastJudgedImageUri,
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
