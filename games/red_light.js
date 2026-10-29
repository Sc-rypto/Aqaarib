/**
 * Aqaarib Games - Red Light, Green Light
 * Manages game pacing, audio speech callouts, lane refereeing, and evidence recording.
 */

import { poseTracker } from '../vision/poseTracker.js';
import { MotionTracker, calibrate as runMotionCalibration } from '../vision/motion.js';
import {
  LIGHT_STATES,
  RedLightJudge,
  calculateThresholds,
  getLaneBoundaries
} from './logic/redLight.js';
import { inputSource } from '../dev/stubs/inputSource.js';
import { captureStill, drawEvidenceAnnotations, saveEvidence, getEvidenceList, clearEvidence } from '../dev/stubs/evidence.js';
import { audio } from '../dev/stubs/audio.js';
import { createLoop } from '../dev/stubs/loop.js';
import { createReport } from '../dev/stubs/report.js';

export class RedLightGame {
  constructor(options = {}) {
    this.numLanes = options.numLanes || 3;
    this.finishLineY = options.finishLineY !== undefined ? options.finishLineY : 0.80;
    this.players = options.players || [
      { id: 'p1', name: 'Player 1', lane: 1 },
      { id: 'p2', name: 'Player 2', lane: 2 },
      { id: 'p3', name: 'Player 3', lane: 3 }
    ];

    this.calibration = options.calibration || { noiseFloor: 0.02, walkingSpeed: 0.35 };
    this.thresholds = calculateThresholds(this.calibration);

    this.judge = null;
    this.motionTracker = new MotionTracker({ windowSize: 4 });
    this.gameLoop = null;

    this.currentLight = LIGHT_STATES.GREEN;
    this.lightChangeTimeMs = 0;
    this.nextLightChangeTimer = null;
    this.sessionStartTimeMs = 0;
    this.gameActive = false;

    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.recordedVideoBlob = null;

    this.onStateChange = options.onStateChange || (() => {});
    this.onEvent = options.onEvent || (() => {});
    this.onEvidenceCaptured = options.onEvidenceCaptured || (() => {});
  }

  async init(videoSourceElement = null) {
    await poseTracker.init();
    await poseTracker.setRunningMode('VIDEO');

    if (videoSourceElement) {
      this.videoElement = videoSourceElement;
    } else if (inputSource.isReady()) {
      this.videoElement = inputSource.getVideoElement();
    }
  }

  setNumLanes(count) {
    this.numLanes = Math.min(4, Math.max(2, count));
    if (this.judge) {
      this.judge.numLanes = this.numLanes;
    }
  }

  setFinishLine(y) {
    this.finishLineY = Math.max(0.5, Math.min(0.95, y));
    if (this.judge) {
      this.judge.finishLineY = this.finishLineY;
    }
  }

  setPlayers(playerList) {
    this.players = playerList.map((p, idx) => ({
      id: p.id || `p${idx + 1}`,
      name: p.name || `Player ${idx + 1}`,
      lane: idx + 1
    }));
  }

  async narrateRules(onStep = () => {}) {
    const steps = [
      { step: 1, text: "Welcome to Red Light, Green Light! Stand in your designated lane." },
      { step: 2, text: "When the light is Green, walk forward towards the finish line." },
      { step: 3, text: "On Yellow, move only in slow motion." },
      { step: 4, text: "When the light turns Red, freeze completely! Any movement triggers a strike." },
      { step: 5, text: "Stay within your lane. Three strikes and you are out. First across the finish line wins!" }
    ];

    for (const item of steps) {
      onStep(item);
      await audio.speak(item.text);
      await new Promise(r => setTimeout(r, 300));
    }
  }

  async calibrate(onProgress) {
    const video = this.videoElement || inputSource.getVideoElement();
    if (!video) throw new Error('Camera must be active to calibrate');

    const calibResult = await runMotionCalibration({
      getLandmarks: () => {
        const people = poseTracker.detect(video, performance.now());
        return people.length > 0 ? people[0].landmarks : null;
      },
      onProgress
    });

    this.calibration = calibResult;
    this.thresholds = calculateThresholds(this.calibration);
    return this.thresholds;
  }

  start() {
    this.stop();
    clearEvidence();

    this.judge = new RedLightJudge({
      numLanes: this.numLanes,
      finishLineY: this.finishLineY,
      calibration: this.calibration
    });

    this.motionTracker = new MotionTracker({ windowSize: 4 });
    this.gameActive = true;
    this.sessionStartTimeMs = Date.now();
    this.lightChangeTimeMs = performance.now();
    this.currentLight = LIGHT_STATES.GREEN;

    this._startRecording();

    audio.speak('Green light! Advance forward!');
    audio.beep({ frequency: 523.25, duration: 0.2 });

    this._scheduleNextLight();

    this.gameLoop = createLoop({
      fps: 15,
      update: (now) => this._tickVision(now),
      render: (now) => this._renderOverlay(now)
    });
    this.gameLoop.start();

    this.onStateChange(this.getState());
  }

  _scheduleNextLight() {
    if (!this.gameActive) return;
    if (this.nextLightChangeTimer) {
      clearTimeout(this.nextLightChangeTimer);
    }

    const delayMs = Math.round(2200 + Math.random() * 2800);

    this.nextLightChangeTimer = setTimeout(() => {
      if (!this.gameActive) return;
      this._changeLight();
      this._scheduleNextLight();
    }, delayMs);
  }

  _changeLight() {
    let nextLight = LIGHT_STATES.GREEN;
    if (this.currentLight === LIGHT_STATES.GREEN) {
      nextLight = Math.random() > 0.5 ? LIGHT_STATES.YELLOW : LIGHT_STATES.RED;
    } else if (this.currentLight === LIGHT_STATES.YELLOW) {
      nextLight = LIGHT_STATES.RED;
    } else {
      nextLight = LIGHT_STATES.GREEN;
    }

    this.currentLight = nextLight;
    this.lightChangeTimeMs = performance.now();

    if (nextLight === LIGHT_STATES.GREEN) {
      audio.speak('Green light!');
      audio.beep({ frequency: 587.33, duration: 0.15, type: 'triangle' });
    } else if (nextLight === LIGHT_STATES.YELLOW) {
      audio.speak('Yellow light! Slow motion!');
      audio.beep({ frequency: 440.0, duration: 0.25, type: 'sine' });
    } else if (nextLight === LIGHT_STATES.RED) {
      audio.speak('Red light! Freeze!');
      audio.beep({ frequency: 329.63, duration: 0.4, type: 'sawtooth' });
    }

    this.onStateChange(this.getState());
  }

  _tickVision(timestampMs) {
    if (!this.gameActive || !this.videoElement) return;

    const detectedPeople = poseTracker.detect(this.videoElement, timestampMs);
    this.lastDetectedPeople = detectedPeople;
    const laneBounds = getLaneBoundaries(this.numLanes);

    // Track which detected person is assigned to avoid duplicate mapping
    const assignedPersonIndices = new Set();

    const playerInputs = this.players.map((player, pIdx) => {
      const assignedLane = player.lane;
      const targetLaneObj = laneBounds.find(l => l.index === assignedLane);
      const targetCenterX = targetLaneObj ? targetLaneObj.centerX : 0.5;

      let bestPerson = null;
      let bestIndex = -1;
      let minDistance = Infinity;

      // In single detected person mode, map directly to the player in that lane or player 1
      if (detectedPeople.length === 1 && (pIdx === 0 || Math.abs(detectedPeople[0].torsoCenter.x - targetCenterX) < 0.35)) {
        bestPerson = detectedPeople[0];
        bestIndex = 0;
      } else {
        detectedPeople.forEach((p, idx) => {
          if (assignedPersonIndices.has(idx)) return;
          const dist = Math.abs(p.torsoCenter.x - targetCenterX);
          if (dist < minDistance && dist < 0.45) {
            minDistance = dist;
            bestPerson = p;
            bestIndex = idx;
          }
        });
      }

      if (bestPerson) {
        if (bestIndex !== -1) assignedPersonIndices.add(bestIndex);
        const motion = this.motionTracker.update(player.id, bestPerson.landmarks);
        return {
          id: player.id,
          name: player.name,
          assignedLane,
          isDetected: true,
          landmarks: bestPerson.landmarks,
          torsoCenter: bestPerson.torsoCenter,
          boundingBox: bestPerson.boundingBox,
          motion
        };
      }

      return {
        id: player.id,
        name: player.name,
        assignedLane,
        isDetected: false,
        landmarks: [],
        torsoCenter: null,
        boundingBox: null,
        motion: 0
      };
    });

    const verdict = this.judge.evaluateFrame({
      timestampMs,
      currentLight: this.currentLight,
      lightChangeTimeMs: this.lightChangeTimeMs,
      players: playerInputs
    });

    verdict.newStrikes.forEach(strike => {
      this._captureEvidenceForStrike(strike, playerInputs);
      audio.beep({ frequency: 180, duration: 0.45, type: 'sawtooth' });
      audio.speak(`${strike.playerName}! Freeze! Caught moving on red!`);
      this.lastCatchEvent = {
        playerId: strike.playerId,
        playerName: strike.playerName,
        timestampMs: performance.now(),
        reason: strike.reason,
        strikes: strike.strikes
      };
      this.onEvent({
        type: 'STRIKE',
        isCatch: true,
        ...strike
      });
    });

    verdict.newFinishes.forEach(fin => {
      this._captureEvidenceForFinish(fin, playerInputs);
      audio.beep({ frequency: 880, duration: 0.35, type: 'sine' });
      audio.speak(`${fin.playerName} crossed the finish line! Rank ${fin.rank}!`);
      this.lastWinnerEvent = {
        playerId: fin.playerId,
        playerName: fin.playerName,
        rank: fin.rank,
        timestampMs: performance.now(),
        reason: fin.reason
      };
      this.onEvent({
        type: 'FINISH',
        isWinner: fin.rank === 1,
        ...fin
      });
    });

    // Check game over: only evaluate players who were actually present in front of camera
    const seenPlayers = this.players.filter(p => {
      const state = this.judge.playerStates[p.id];
      return state && state.lastSeenTimeMs;
    });

    const activeRemaining = (seenPlayers.length > 0 ? seenPlayers : this.players).filter(p => {
      const state = this.judge.playerStates[p.id];
      return state && !state.isOut && !state.hasFinished;
    });

    if (activeRemaining.length === 0 && (seenPlayers.length > 0 || this.judge.finishOrder.length > 0)) {
      this._handleGameOver(verdict.newFinishes[0] || this.lastWinnerEvent);
    }

    this.onStateChange(this.getState(playerInputs));
  }

  _captureEvidenceForStrike(strike, playerInputs) {
    if (!this.videoElement) return;
    const playerInput = playerInputs.find(p => p.id === strike.playerId);

    const canvas = captureStill(this.videoElement, { width: 640, height: 480 });
    drawEvidenceAnnotations(canvas, {
      lanes: getLaneBoundaries(this.numLanes),
      boxes: playerInput?.boundingBox ? [{
        ...playerInput.boundingBox,
        label: strike.playerName,
        isOut: true,
        reason: strike.reason
      }] : [],
      watermarkText: `STRIKE: ${strike.reason}`
    });

    const dataUri = canvas.toDataURL('image/jpeg', 0.88);
    const evRecord = saveEvidence({
      title: `Strike on ${strike.playerName}`,
      reason: strike.reason,
      imageUri: dataUri,
      player: strike.playerName,
      verdict: 'STRIKE',
      meta: { strikeCount: strike.strikes, light: this.currentLight }
    });

    this.onEvidenceCaptured(evRecord);
  }

  _captureEvidenceForFinish(fin, playerInputs) {
    if (!this.videoElement) return;
    const playerInput = playerInputs.find(p => p.id === fin.playerId);

    const canvas = captureStill(this.videoElement, { width: 640, height: 480 });
    drawEvidenceAnnotations(canvas, {
      lanes: getLaneBoundaries(this.numLanes),
      boxes: playerInput?.boundingBox ? [{
        ...playerInput.boundingBox,
        label: `${fin.playerName} (Rank #${fin.rank})`,
        isOut: false,
        reason: `Finished Rank #${fin.rank}`
      }] : [],
      watermarkText: `FINISH: ${fin.playerName} #${fin.rank}`
    });

    const dataUri = canvas.toDataURL('image/jpeg', 0.88);
    const evRecord = saveEvidence({
      title: `Finish: ${fin.playerName} (Rank ${fin.rank})`,
      reason: fin.reason,
      imageUri: dataUri,
      player: fin.playerName,
      verdict: 'FINISH',
      meta: { rank: fin.rank }
    });

    this.onEvidenceCaptured(evRecord);
  }

  _handleGameOver(winnerFinish = null) {
    this.gameActive = false;
    this.stopRecording();
    if (this.nextLightChangeTimer) {
      clearTimeout(this.nextLightChangeTimer);
      this.nextLightChangeTimer = null;
    }
    if (this.gameLoop) {
      this.gameLoop.stop();
      this.gameLoop = null;
    }

    const winnerName = winnerFinish?.playerName || (this.judge?.finishOrder[0] ? this.players.find(p => p.id === this.judge.finishOrder[0])?.name : null);
    if (winnerName) {
      audio.speak(`Winner! ${winnerName} has won the match! Excellent game!`);
    } else {
      audio.speak('Round complete! All player positions recorded.');
    }

    // Play fanfare
    audio.beep({ frequency: 523.25, duration: 0.15 });
    setTimeout(() => audio.beep({ frequency: 659.25, duration: 0.15 }), 160);
    setTimeout(() => audio.beep({ frequency: 783.99, duration: 0.35 }), 320);

    const finalReport = this.exportResult();
    this.onEvent({
      type: 'GAME_OVER',
      winner: winnerName,
      winnerRank: 1,
      report: finalReport
    });
    this.onStateChange(this.getState());
  }

  _startRecording() {
    if (typeof MediaRecorder === 'undefined' || !this.videoElement) return;
    try {
      let stream = null;
      if (this.videoElement.captureStream) {
        stream = this.videoElement.captureStream(25);
      } else if (this.videoElement.srcObject) {
        stream = this.videoElement.srcObject;
      }
      if (!stream) return;

      this.recordedChunks = [];
      this.mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.recordedChunks.push(e.data);
        }
      };
      this.mediaRecorder.onstop = () => {
        this.recordedVideoBlob = new Blob(this.recordedChunks, { type: 'video/webm' });
      };
      this.mediaRecorder.start(1000);
    } catch (e) {}
  }

  stopRecording() {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch (e) {}
    }
  }

  downloadRecordedVideo(filename = 'red-light-session.webm') {
    if (!this.recordedVideoBlob) return;
    const url = URL.createObjectURL(this.recordedVideoBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  _renderOverlay(now) {}

  getState(playerInputs = []) {
    return {
      gameActive: this.gameActive,
      currentLight: this.currentLight,
      numLanes: this.numLanes,
      finishLineY: this.finishLineY,
      lanes: getLaneBoundaries(this.numLanes),
      thresholds: this.thresholds,
      players: this.players.map(p => {
        const state = this.judge?.playerStates[p.id];
        const input = playerInputs.find(i => i.id === p.id);
        return {
          id: p.id,
          name: p.name,
          lane: p.lane,
          strikes: state?.strikes || 0,
          isOut: Boolean(state?.isOut),
          hasFinished: Boolean(state?.hasFinished),
          finishRank: state?.finishRank || null,
          motion: input?.motion || 0,
          isDetected: Boolean(input?.isDetected),
          torsoCenter: input?.torsoCenter || null,
          boundingBox: input?.boundingBox || null
        };
      }),
      finishOrder: this.judge?.finishOrder || [],
      lastCatch: this.lastCatchEvent && (performance.now() - this.lastCatchEvent.timestampMs < 2500) ? this.lastCatchEvent : null,
      lastWinner: this.lastWinnerEvent || null,
      detectedPeople: this.lastDetectedPeople || [],
      scores: this.judge ? this.judge.evaluateFrame({
        timestampMs: performance.now(),
        currentLight: this.currentLight,
        lightChangeTimeMs: this.lightChangeTimeMs,
        players: []
      }).scores : {},
      hasRecordedVideo: Boolean(this.recordedVideoBlob)
    };
  }

  exportResult() {
    const durationSec = (Date.now() - this.sessionStartTimeMs) / 1000;
    const strikesMap = {};
    const scores = this.judge ? this.judge.evaluateFrame({
      timestampMs: performance.now(),
      currentLight: this.currentLight,
      lightChangeTimeMs: this.lightChangeTimeMs,
      players: []
    }).scores : {};

    this.players.forEach(p => {
      strikesMap[p.id] = this.judge?.playerStates[p.id]?.strikes || 0;
    });

    return createReport({
      gameName: 'Red Light',
      sessionTimestamp: this.sessionStartTimeMs,
      durationSec,
      players: this.players,
      scores,
      strikes: strikesMap,
      events: this.judge?.events || [],
      evidence: getEvidenceList()
    });
  }

  stop() {
    this.gameActive = false;
    if (this.nextLightChangeTimer) {
      clearTimeout(this.nextLightChangeTimer);
      this.nextLightChangeTimer = null;
    }
    if (this.gameLoop) {
      this.gameLoop.stop();
      this.gameLoop = null;
    }
    this.stopRecording();
  }
}
