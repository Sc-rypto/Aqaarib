/**
 * Game Module: Signed Match Report Games (Balloon / Football)
 * Verifies and loads HMAC-SHA256 signed reports created by the referee.
 */

import { verifySignedReport, buildResult } from '../core/report.js';

export default {
  id: 'report_games',
  title: 'Match Report Judge',
  mode: 'both',
  minPlayers: 1,
  maxPlayers: 12,
  rulesText: [
    'Select a match report file signed by the referee.',
    'Type the secret key to verify the signature.',
    'The referee verifies that the file was not changed.',
    'Review all rulings and evidence snapshots before confirming.'
  ],
  defaultRules: {
    judgeKey: '',
    targetGame: 'balloon'
  },
  inputs: ['report_file'],

  create(ctx) {
    const root = ctx.root;
    let verifiedResult = null;
    let currentKey = (ctx.rules && ctx.rules.judgeKey) || '';
    let uploadedFileText = '';

    function renderUI() {
      if (!root) return;
      root.innerHTML = '';

      const wrap = document.createElement('div');
      wrap.style.cssText = 'padding: 1.5rem; background: var(--surface-container, #fdfbf7); border: 1px solid var(--border-color, #e6ded6); border-radius: 1rem; display: flex; flex-direction: column; gap: 1.25rem;';

      wrap.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
          <div>
            <h3 style="margin: 0; font-family: var(--font-serif, serif); font-size: 1.4rem; color: var(--on-surface, #1e1b18);">
              Signed Match Report Verification
            </h3>
            <p style="margin: 0.25rem 0 0; font-size: 0.85rem; color: var(--on-surface-variant, #6b635b);">
              Upload the payload and hmac file created by the Python referee.
            </p>
          </div>
          <span id="reportStatusBadge" style="background: #a49e96; color: white; padding: 0.35rem 0.8rem; border-radius: 9999px; font-size: 0.8rem; font-weight: 600;">
            Awaiting File
          </span>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
          <div>
            <label style="display: block; font-size: 0.82rem; font-weight: 600; margin-bottom: 0.35rem; color: var(--on-surface, #1e1b18);">
              Referee Secret Key
            </label>
            <input type="password" id="inputJudgeKey" placeholder="Type referee secret key" value="${currentKey}" style="width: 100%; box-sizing: border-box; padding: 0.6rem 0.8rem; border: 1px solid #ccc; border-radius: 0.5rem; font-size: 0.9rem;" />
          </div>

          <div>
            <label style="display: block; font-size: 0.82rem; font-weight: 600; margin-bottom: 0.35rem; color: var(--on-surface, #1e1b18);">
              Signed Report File (.json)
            </label>
            <input type="file" id="inputReportFile" accept=".json,application/json" style="width: 100%; box-sizing: border-box; padding: 0.5rem; font-size: 0.85rem;" />
          </div>
        </div>

        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center;">
          <span style="font-size: 0.78rem; color: var(--on-surface-variant, #6b635b);">Quick Demo Fixtures:</span>
          <button id="btnLoadBalloonFixture" style="background: #f0ebe4; border: 1px solid #d4c8bd; padding: 0.3rem 0.7rem; border-radius: 0.4rem; font-size: 0.78rem; cursor: pointer;">
            Load Balloon Fixture
          </button>
          <button id="btnLoadFootballFixture" style="background: #f0ebe4; border: 1px solid #d4c8bd; padding: 0.3rem 0.7rem; border-radius: 0.4rem; font-size: 0.78rem; cursor: pointer;">
            Load Football Fixture
          </button>
          <button id="btnLoadTamperedFixture" style="background: #fbeae5; border: 1px solid #e06d53; color: #ba1a1a; padding: 0.3rem 0.7rem; border-radius: 0.4rem; font-size: 0.78rem; cursor: pointer;">
            Load Tampered File Test
          </button>
        </div>

        <div id="verificationMessage" style="font-size: 0.85rem; padding: 0.75rem; border-radius: 0.5rem; display: none;"></div>

        <div id="verifiedPreview" style="display: none; flex-direction: column; gap: 0.75rem; background: #fff; padding: 1rem; border-radius: 0.75rem; border: 1px solid #e6ded6;"></div>
      `;

      root.appendChild(wrap);

      const keyInput = wrap.querySelector('#inputJudgeKey');
      const fileInput = wrap.querySelector('#inputReportFile');
      const btnBalloon = wrap.querySelector('#btnLoadBalloonFixture');
      const btnFootball = wrap.querySelector('#btnLoadFootballFixture');
      const btnTampered = wrap.querySelector('#btnLoadTamperedFixture');

      keyInput.addEventListener('input', (e) => {
        currentKey = e.target.value;
        if (uploadedFileText) {
          runVerification();
        }
      });

      fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          uploadedFileText = ev.target.result;
          runVerification();
        };
        reader.readAsText(file);
      });

      btnBalloon.addEventListener('click', async () => {
        keyInput.value = 'referee-secret-2026';
        currentKey = 'referee-secret-2026';
        try {
          const res = await fetch('fixtures/balloon_signed_report.json');
          uploadedFileText = await res.text();
          runVerification();
        } catch (_) {
          showStatus(false, 'Could not load fixture file.');
        }
      });

      btnFootball.addEventListener('click', async () => {
        keyInput.value = 'referee-secret-2026';
        currentKey = 'referee-secret-2026';
        try {
          const res = await fetch('fixtures/football_signed_report.json');
          uploadedFileText = await res.text();
          runVerification();
        } catch (_) {
          showStatus(false, 'Could not load fixture file.');
        }
      });

      btnTampered.addEventListener('click', async () => {
        keyInput.value = 'referee-secret-2026';
        currentKey = 'referee-secret-2026';
        try {
          const res = await fetch('fixtures/tampered_signed_report.json');
          uploadedFileText = await res.text();
          runVerification();
        } catch (_) {
          showStatus(false, 'Could not load fixture file.');
        }
      });
    }

    async function runVerification() {
      const msgEl = root.querySelector('#verificationMessage');
      const previewEl = root.querySelector('#verifiedPreview');
      const badgeEl = root.querySelector('#reportStatusBadge');

      if (!uploadedFileText) {
        showStatus(false, 'Please select a report file first.');
        return;
      }

      if (!currentKey.trim()) {
        showStatus(false, 'Please enter the referee secret key.');
        return;
      }

      const res = await verifySignedReport(uploadedFileText, currentKey.trim());

      if (res.ok) {
        verifiedResult = res.result;
        badgeEl.textContent = 'Verified Valid';
        badgeEl.style.background = '#2e7d32';

        msgEl.style.display = 'block';
        msgEl.style.background = '#e8f5e9';
        msgEl.style.color = '#1b5e20';
        msgEl.textContent = 'Signature matches. Match report verified successfully.';

        if (ctx.beep) ctx.beep(640, 200);
        if (ctx.speak) ctx.speak('Match report verified. Rulings and evidence are ready.');

        // Emit events into ctx
        if (ctx.emit && Array.isArray(verifiedResult.events)) {
          verifiedResult.events.forEach((ev) => ctx.emit(ev));
        }

        // Render preview
        previewEl.style.display = 'flex';
        previewEl.innerHTML = `
          <div style="font-weight: 700; font-size: 1rem; color: #1e1b18;">
            Game: ${verifiedResult.game.toUpperCase()} • Session: ${verifiedResult.sessionId}
          </div>
          <div style="font-size: 0.85rem; color: #536251;">
            Winner: ${verifiedResult.winner.reason}
          </div>
          <div style="font-size: 0.8rem; color: #6b635b;">
            Events Logged: ${verifiedResult.events.length} • Evidence Items: ${verifiedResult.evidence.length}
          </div>
        `;
      } else {
        verifiedResult = null;
        badgeEl.textContent = 'Refused Changed';
        badgeEl.style.background = '#ba1a1a';

        msgEl.style.display = 'block';
        msgEl.style.background = '#ffebee';
        msgEl.style.color = '#b71c1c';
        msgEl.textContent = res.reason;

        if (ctx.beep) ctx.beep(220, 350);
        if (ctx.speak) ctx.speak('Report signature is invalid. The file was changed.');

        previewEl.style.display = 'none';
      }
    }

    function showStatus(ok, text) {
      const msgEl = root.querySelector('#verificationMessage');
      if (!msgEl) return;
      msgEl.style.display = 'block';
      msgEl.style.background = ok ? '#e8f5e9' : '#fff3e0';
      msgEl.style.color = ok ? '#1b5e20' : '#e65100';
      msgEl.textContent = text;
    }

    return {
      start() {
        renderUI();
      },

      stop() {},

      getResult() {
        if (!verifiedResult) {
          // Fallback minimal valid report if host finishes before uploading
          return buildResult({
            game: (ctx.rules && ctx.rules.targetGame) || 'balloon',
            players: ctx.players || [{ id: 'p1', name: 'Player 1', team: null }],
            events: [],
            stats: { note: 'No signed report loaded' }
          });
        }
        return verifiedResult;
      },

      destroy() {
        if (root) root.innerHTML = '';
      }
    };
  }
};
