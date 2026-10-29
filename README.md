# Aqaarib (أقارب) - Living Room Motion Gaming Hub

A static web motion gaming hub where families gather to play interactive party games. The application runs edge vision directly in the browser to track players, apply fair rules, keep score, and explain rulings with photo evidence.

---

## Game Suite

1. **Red Light Green Light** (`red_light`)
   - Multi-lane camera tracking with real-time lane boundaries.
   - Dynamic light pacing (Green, Yellow slow-motion cap, Red freeze).
   - Speed thresholds calibrated to each player's movement.
   - Adjustable finish line detection and instant strike evidence replays.
   - Built-in session video recording and download.

2. **Hot Potato Photo Freeze** (`hot_potato`)
   - Fast, accelerating audio countdown (5 to 9 seconds) keeping players on edge.
   - Alternating modes: **HIDE** (clear the frame) and **ZONE** (stay out of the danger rectangle).
   - High-speed snap freeze capture that highlights detected players in red/green bounding boxes.
   - One-click photo download to preserve fun family moments.

3. **Bus Count** (`bus_count`)
   - Interactive transit boarding game.
   - Tracks passengers crossing the door threshold on green while avoiding fouls on red.

4. **Cryptographic Match Reports**
   - Verification of match session reports signed with HMAC SHA256.
   - Ensures tamper-evident scoring and verifiable match outcomes.

---

## Core Architecture

```
├── index.html                   # Main living room hub portal
├── red_light.html               # Red Light Green Light arena
├── hot_potato.html              # Hot Potato Photo Freeze arena
├── app/                         # Application controller and game loader
│   ├── main.js                  # Lobby, live arena, results, and host overrides
│   ├── gameLoader.js            # Unified game registry
│   └── adapters/
│       └── personBAdapter.js    # Motion game module integration
├── core/                        # Core system services
│   ├── config.js                # Verified pinned CDN assets
│   ├── inputSource.js           # Live camera and video file manager
│   ├── evidence.js              # Evidence snapshot store
│   ├── audio.js                 # Web Audio synthesis and speech narration
│   ├── loop.js                  # Throttled 15 FPS animation runner
│   └── report.js                # Schema majlis-result/1 builder & HMAC verifier
├── vision/                      # Edge vision pipeline
│   ├── poseTracker.js           # MediaPipe Pose Landmarker with silhouette fallback
│   ├── motion.js                # Scale-invariant 8-joint displacement & calibration
│   └── faceMatch.js             # Face identification & descriptor matching
├── games/                       # Game coordinators and pure logic engines
│   ├── red_light.js             # Red Light game coordinator
│   ├── hot_potato.js            # Hot Potato game coordinator
│   ├── bus_count.js             # Bus Count game coordinator
│   ├── report_games.js          # Signed report match coordinator
│   └── logic/
│       ├── redLight.js          # Pure Red Light adjudication rules
│       ├── hotPotato.js         # Pure Hot Potato photo analysis
│       └── busCount.js          # Pure Bus Count door rules
├── js/
│   └── background.js            # Ambient dot-matrix canvas with cursor proximity illumination
├── css/
│   └── kinship.css              # Warm editorial papercraft design tokens
├── styles/
│   └── app.css                  # Hub presentation stylesheet
├── data/                        # Family presets and catalogs
├── fixtures/                    # Test fixtures for match verification
├── dev/                         # Standalone game test runners and dev harnesses
└── tests/                       # Automated test suite
```

---

## Testing & Quality Assurance

Run the test suite:

```bash
# Run unit tests across vision, rules, and core services
npm test

# Run result schema validation
npm run validate
```
