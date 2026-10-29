# Aqaarib Motion Engine - Technical Specifications & Assumptions

Technical design, mathematical formulas, data schemas, and engineering assumptions for the Aqaarib Family Motion Gaming platform.

---

## 1. Directory Structure

```
├── index.html                   # Main living room hub portal
├── red_light.html               # Red Light Green Light arena
├── hot_potato.html              # Hot Potato Photo Freeze arena
├── app/                         # Application controller and game loader
│   ├── main.js                  # Lobby, live arena, results, and host reversals
│   ├── gameLoader.js            # Unified game registry for all games
│   └── adapters/
│       └── personBAdapter.js    # Motion game module adapter
├── core/                        # Core system services
│   ├── config.js                # Verified pinned CDN URLs for dependencies
│   ├── inputSource.js           # Live camera and scrubbed video file manager
│   ├── evidence.js              # 640px JPEG base64 evidence store
│   ├── audio.js                 # Web Audio synthesis and referee speech voice
│   ├── loop.js                  # Throttled 15 FPS requestAnimationFrame runner
│   └── report.js                # Schema majlis-result/1 builder & HMAC verifier
├── styles/                      # Kinship editorial papercraft styling
│   └── app.css                  # Alabaster Oat, Terracotta, Muted Sage, Soft Ochre
├── css/
│   └── kinship.css              # Typography, layout tokens, and component classes
├── data/                        # Family presets and game catalog
│   ├── defaultPlayers.json      # Sample family rosters
│   └── gameCatalog.js           # Official referee rules and default configurations
├── fixtures/                    # Test fixtures for match verification
│   ├── balloon_signed_report.json
│   ├── football_signed_report.json
│   ├── tampered_signed_report.json
│   └── README.md
├── games/                       # Game modules implementing Browser Game Module Interface
│   ├── bus_count.js             # Bus Count game coordinator
│   ├── report_games.js          # Signed report match judge
│   ├── red_light.js             # Red Light coordinator
│   ├── hot_potato.js            # Hot Potato coordinator
│   └── logic/
│       ├── busCount.js          # Pure Bus Count functions
│       ├── redLight.js          # Pure Red Light functions
│       └── hotPotato.js         # Pure Hot Potato functions
├── python/                      # Offline Match Referee CLI
│   └── judge.py                 # Signs majlis-result/1 reports with HMAC SHA256
├── vision/                      # Edge vision pipeline
│   ├── poseTracker.js           # MediaPipe Pose Landmarker (0.10.14)
│   ├── motion.js                # Scale-invariant 8-joint displacement
│   └── faceMatch.js             # Human face identification (3.2.2)
├── js/
│   └── background.js            # Ambient dot-matrix canvas with cursor proximity illumination
├── dev/                         # Standalone dev runners and stubs
└── tests/                       # Complete Node unit test suite
```

---

## 2. Engineering Principles

1. **Client-Side Privacy**
   - Vision models and inference run locally on the user's device.
   - Offline referee uses Python standard library (`hmac`, `hashlib`, `json`).

2. **Standard Web Standards**
   - Plain HTML, CSS, and native ES modules.
   - Zero build step or bundler dependencies.

3. **Pinned Third-Party Dependencies (`core/config.js`)**
   - Verified dependency URLs:
     - MediaPipe Tasks Vision Bundle: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs`
     - MediaPipe Wasm Base: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm`
     - MediaPipe Pose Model: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`
     - Vladimir Mandic Human ESM: `https://cdn.jsdelivr.net/npm/@vladmandic/human@3.2.2/dist/human.esm.js`
     - Vladimir Mandic Human Models: `https://cdn.jsdelivr.net/npm/@vladmandic/human@3.2.2/models`

4. **Friendly Human Referee Voice**
   - Rules, rulings, reasons, and error notifications sound like a warm, supportive referee.
   - Short and plain language with zero technical jargon.
   - Zero emojis anywhere in referee dialogue.
   - Zero dash characters (`-`, `–`, `—`) used as punctuation in referee text.

5. **Host Absolute Reversal**
   - Every AI ruling includes an option for host review in the live feed and results screen.
   - Host reversals adjust points, update scores in real time, and re-evaluate winner standings.

---

## 3. Data Contracts

### Result Contract (Version 1: `majlis-result/1`)
```json
{
  "schema": "majlis-result/1",
  "game": "red_light" | "hot_potato" | "bus_count" | "balloon" | "football",
  "sessionId": "string",
  "createdAt": "ISO string",
  "players": [{ "id": "p1", "name": "string", "team": "A" | "B" | null }],
  "rules": {},
  "events": [
    {
      "t": 3.4,
      "type": "string",
      "player": "id or null",
      "team": "A" | "B" | null,
      "points": 1,
      "reason": "string (friendly referee voice, no emojis, no dash punctuation)",
      "evidence": "ev1 or null"
    }
  ],
  "scores": {
    "players": { "p1": 2 },
    "teams": { "A": 2, "B": 1 }
  },
  "winner": {
    "kind": "player" | "team" | "tie",
    "id": "p1 or A or null",
    "reason": "string"
  },
  "evidence": [
    {
      "id": "ev1",
      "t": 3.4,
      "type": "image" | "text",
      "data": "base64 JPEG without data URL prefix (max width 640px, quality ~0.7)",
      "caption": "string"
    }
  ],
  "stats": {}
}
```

### Cryptographic Signed Match Report
- Envelope format with exactly two keys: `{ "payload": string, "hmac": string }`.
- `payload` is the verbatim JSON string of one result object.
- `hmac` is lowercase hex HMAC SHA256 of the UTF-8 bytes of `payload` with the secret key typed by the host.
- Verified in `core/report.js` via Web Crypto API (`crypto.subtle`) without canonicalization.

---

## 4. Pure Game Logic & Rules

### Game 1: Red Light Green Light (`games/logic/redLight.js`)
- **Lanes**: 2 to 4 vertical bands dividing normalized width $[0, 1]$.
- **Red Limit**: $\max(3 \times N_f, 0.08 \times W_s)$
- **Grace Period**: 500 ms ($0.5$s) immediately following every light switch.
- **3-Frame Persistence**: Motion violations must persist for 3 consecutive frames to count.
- **Finish Line**: Hip height $(y_{23} + y_{24}) / 2 \ge \text{finishLineY}$ (default $0.80$).

### Game 2: Hot Potato Photo Freeze (`games/logic/hotPotato.js`)
- **Timer**: 5 to 9 second rapid accelerating countdown with sound cues.
- **Modes**: Random selection between HIDE mode (all visible are out) and ZONE mode (danger rectangle).
- **Visibility Criterion**: $\ge 4$ of shoulders and hips have landmark visibility $\ge 0.45$.

### Game 3: Bus Count (`games/logic/busCount.js`)
- **Boarding Threshold**: Door threshold line at normalized $X = 0.35$.
- **Green Signal (Doors Open)**: Players crossing door line into passenger cabin receive $+1$ boarding point.
- **Red Signal (Doors Closed)**: Players crossing after the horn receive $-1$ boarding foul.
- **Headcount**: Counts seated/standing passengers in passenger zone at the terminal station.

### Games 4 & 5: Balloon Keep Up & Football Penalty Shootout (`games/report_games.js`)
- Offline match judging conducted via Python referee (`python/judge.py`).
- Cryptographic verification in browser before results and evidence snapshots are displayed.

---

## 5. Test Suite Verification

```bash
# Run all unit tests
npm test

# Run result object schema validator
npm run validate

# Test Python judge signing and verification
python3 python/judge.py verify fixtures/balloon_signed_report.json --key referee-secret-2026
```
