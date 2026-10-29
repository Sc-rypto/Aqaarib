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

---

## 6. Majlis Video Referee & Rule Judge (`/python`)

### Architecture & Module Ownership
The offline Python referee is located in `/python` with reusable, modular components:
- **`common.py`**:
  - `VideoReader`: Streams frames with aspect-preserving resize to max width 960px and configurable frame stride (default 2) for smooth CPU execution on 1 to 2 minute clips.
  - `ColorTracker`: HSV filtering with Gaussian blur, morphological open and close, largest contour centroid extraction, and linear gap filling up to 10 frames.
  - `EvidenceCollector`: Collects decisive moments as 640px JPEG quality 70 base64 Data URIs, capped at 12 items.
  - `sign_report` and `verify_report`: Canonical JSON serialization signed with HMAC-SHA256 adhering to the contract.
  - `tamper_report`: Produces an anti-cheat demonstration file with modified score and unmodified HMAC.
- **`football.py`**:
  - YOLOv8n + ByteTrack tracking for players (class 0) and sports ball (class 32).
  - Upper-torso color sampling and 2-cluster KMeans majority voting per track to partition players into Team A and Team B, with `--swap-teams` manual override.
  - Ball tracking with gap interpolation up to 10 frames; automatically falls back to `ColorTracker` (`--ball-hsv`) if ball detection falls below 40%.
  - Possession tracking: nearest player within $0.8 \times \text{bbox height}$, confirmed across 3 consecutive frames.
  - Goal tracking: ball inside goal box for 3 consecutive frames after $\ge 1.0$s outside, with a 4.0s cooldown, crediting scoring team and last possessor.
  - Stats: possession percentages, seconds per player, ball detection rate, and MVP selection with tie-breakers.
- **`balloon.py`**:
  - Color clearance pre-check: analyzes opening frames and aborts with a clear friendly warning if background or clothing matches the balloon color.
  - Trajectory inflection hit detection: triggers when vertical motion switches from falling ($dy > 0$) to rising ($dy < 0$) with a $\ge 0.25$s debounce window.
  - Apex evaluation: valid hit if balloon rises above target line (`--target-y`), fault if it fails to clear.
  - Ground contact termination: ends round immediately when balloon reaches ground line (`--ground-y`) or disappears near it for $> 1.0$s.
  - Score: $\text{air seconds} + 1 \times \text{valid hits} - 1 \times \text{faults}$.
- **`cli.py` & `judge.py`**:
  - Commands: `pick`, `football`, `balloon`, `verify`, and `tamper`.
  - Supports `--key` flag and `MAJLIS_KEY` environment variable.
  - Emits quality summary banners with low-quality warnings on every run.

### Assumptions Made
1. **Camera Stability**: Video footage is assumed to be captured from a fixed, non-moving camera with the entire pitch or living room play area in clear view.
2. **Jersey Distinctions**: For football, the two teams wear solid shirts of distinct hues (e.g. blue vs. red or yellow vs. dark green) so torso KMeans clustering can converge reliably.
3. **Balloon Color Contrast**: The balloon color is distinct from walls, floors, and clothing. The opening color clearance check enforces this assumption before round evaluation starts.
4. **Coordinate Inputs**: Goal boxes and boundary lines can be provided either in normalized fractions $[0.0, 1.0]$ or raw pixel dimensions; the CLI auto-detects and scales accordingly.
5. **CPU Inference Budget**: Running at a frame stride of 2 (analyzing $\sim 15$ FPS out of 30 FPS) provides the ideal balance of accuracy and sub-minute execution on commodity CPU hardware without requiring dedicated GPUs.

### What Could Not Be Verified
1. **Live Camera Direct Feed in Headless Environment**: OpenCV GUI window display for the `pick` command requires a local display server (`DISPLAY` or native windowing); headless terminal testing was verified via non-GUI mock and programmatic tests.
2. **High-Density Professional Matches**: Tested on synthetic and simulated domestic clips with 4 to 6 simultaneous players. Real 22-player professional broadcast footage with heavy occlusion was not tested.
3. **Extreme Low-Light Conditions**: In severe underexposure, YOLO person detection and HSV color thresholds naturally degrade; the engine flags these situations via its built-in quality summary warnings.

### Verification Commands & Results
All 14 Python unit tests and all 36 Node unit tests pass cleanly:
```bash
# Python referee test suite (14 tests passed in 1.36s)
PYTHONPATH=python python/.venv/bin/pytest python/tests

# End-to-end sample clip generation & judging
python python/test_clips/generate_test_clips.py
python python/cli.py balloon python/test_clips/balloon_sample.mp4 --team A --hsv-lower 45,100,100 --hsv-upper 75,255,255 --key "demo_key" --out balloon_report.json
python python/cli.py verify balloon_report.json --key "demo_key"
python python/cli.py tamper balloon_report.json --out balloon_tampered.json
python python/cli.py verify balloon_tampered.json --key "demo_key"  # Fails as expected

# Node contract and web app test suite (36 tests passed)
npm test
npm run validate
```
