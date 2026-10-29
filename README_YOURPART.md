# Person B: Shared Vision Layer & Family Motion Games

This repository contains **Person B's** complete deliverable for the hackathon: a shared vision layer, two motion-based family games (**Red Light** and **Hot Potato**), frozen API stubs in `/dev/stubs`, unit tests, standalone dev test runners, and an editorial **Kinship Family Operating Hub** design system.

---

## 1. Directory Structure & Ownership

```
├── dev/
│   ├── hot_potato.html          # Standalone dev runner for Hot Potato
│   ├── red_light.html           # Standalone dev runner for Red Light
│   ├── validateReport.js        # Node CLI validator for game result objects
│   └── stubs/                   # FROZEN API STAND-INS (Person A ownership)
│       ├── audio.js             # Web Audio API synthesizers, ticking, and TTS
│       ├── evidence.js          # Still frame capture, box annotations & gallery
│       ├── inputSource.js       # Live webcam & recorded video file management
│       ├── loop.js              # 15 FPS throttled game loop runner
│       └── report.js            # Standardized session result builder & validator
├── games/
│   ├── hot_potato.js            # Game 2 coordinator & judgeFrame implementation
│   ├── red_light.js             # Game 1 coordinator, lane tracking & MediaRecorder
│   └── logic/                   # Pure functions (Node testable, zero DOM dependencies)
│       ├── hotPotato.js         # Visibility, danger zone, scoring & tie-breaking
│       └── redLight.js          # Thresholds, lanes, 3-frame persistence, grace logic
├── vision/
│   ├── faceMatch.js             # Vladimir Mandic Human face enrollment & cosine matching
│   ├── motion.js                # Scale-invariant 8-joint motion & 6s calibration
│   └── poseTracker.js           # MediaPipe Pose Landmarker (Video & Image modes)
├── tests/
│   ├── hotPotato.test.js        # Unit tests for Hot Potato rules & scoring
│   ├── redLight.test.js         # Unit tests for Red Light thresholds, strikes & grace
│   ├── reportValidation.test.js # Unit tests for result schema validation
│   └── visionLayer.test.js      # Unit tests for scale invariance & vector similarity
├── css/
│   └── kinship.css              # Warm editorial tactile papercraft styling tokens
├── index.html                   # Kinship Family Hub launcher
├── package.json                 # Node test & validation scripts
└── README_YOURPART.md           # Specification, assumptions & thresholds
```

---

## 2. Shared Vision Layer (`/vision`)

Both games reuse the same underlying vision components:

### `poseTracker.js`
- Wraps MediaPipe Pose Landmarker (`@mediapipe/tasks-vision`, pinned version `0.10.14`).
- Supports both continuous stream mode (`runningMode: 'VIDEO'`) and single-snapshot mode (`runningMode: 'IMAGE'`).
- Tracks up to **4 people** simultaneously.
- Downscales camera frames to $360 \times 270$ on an offscreen canvas to guarantee stable $\sim 15$ FPS inference while keeping 60 FPS UI responsiveness.
- Switchable base URL (`MEDIAPIPE_CONFIG.wasmBaseUrl` and `modelAssetUrl`) allowing seamless redirection to local `/vendor` assets if CDN access is blocked.
- Standard output format:
  ```ts
  Array<{
    id: number,
    landmarks: Array<{ x: number, y: number, z: number, visibility?: number }>,
    torsoCenter: { x: number, y: number },
    boundingBox: { x: number, y: number, width: number, height: number },
    visibilityCount: number
  }>
  ```

### `motion.js`
- Scale-invariant motion scoring evaluated across 8 key joints:
  - Shoulders: 11, 12
  - Hips: 23, 24
  - Wrists: 15, 16
  - Ankles: 27, 28
- Normalized by **shoulder width** ($\|L_{11} - L_{12}\|$), ensuring movement scores remain consistent whether a player is 2 meters or 5 meters from the lens.
- Smoothed via a 4-frame rolling moving average to suppress tracking jitter.
- Interactive `calibrate()` routine:
  - 3 seconds standing still $\rightarrow$ Noise Floor ($N_f$)
  - 3 seconds walking normally $\rightarrow$ Walking Speed ($W_s$)

### `faceMatch.js`
- Wraps Vladimir Mandic's Human library (`@vladmandic/human@3.2.3`).
- `enroll(name, imageSource)`: extracts feature embedding vector into memory.
- `identify(imageSource)`: detects faces, calculates cosine similarity against enrolled roster, and returns `{ name, similarity, box }` or `{ name: null, ... }` if below threshold.

---

## 3. Game 1: Red Light

### Family Rules & Mechanics
- **Lanes**: 2 to 4 vertical bands dividing normalized width $[0, 1]$. Host lines players up with tape on the floor.
- **Traffic Light States**: Random light switching between Green, Yellow, and Red every 2 to 5 seconds with voice callouts.
- **Finish Line**: Evaluates mid-hip height ($(y_{23} + y_{24}) / 2 \ge \text{finishLineY}$). Default is 80% ($0.80$), adjustable by the host via slider.
- **Video Recording**: Built-in `MediaRecorder` captures canvas stream and offers instant download of the game session video at game over.

### Judging Rules & Mathematical Thresholds
- **Red Limit**: $\max(3 \times N_f, 0.08 \times W_s)$
- **Yellow Cap**: $0.40 \times W_s$
- **Grace Period**: 500 ms ($0.5$s) immediately following every light switch. Motion during grace is strictly forgiven.
- **3-Frame Persistence**: Motion violations must persist for 3 consecutive frames to issue a strike.
- **Lost Detection Immunity**: If MediaPipe briefly loses landmark tracking for a frame, the consecutive strike counter resets. Players are never penalized for camera occlusion.
- **Lane Violation**: Torso center outside assigned lane for $> 0.4$s ($400$ms) triggers a strike. A 2% normalized safety buffer (`padding = 0.02`) prevents jitter at the boundary.
- **Strikes & Elimination**: 3 strikes $\rightarrow$ OUT for the round.
- **Scoring**:
  - Finishing order: 1st $\rightarrow 3$ pts, 2nd $\rightarrow 2$ pts, 3rd $\rightarrow 1$ pt, 4th $\rightarrow 0$ pts.
  - Strike penalty: $-1$ pt per strike: $\text{score} = \max(0, \text{finishPts} - \text{strikes})$.
- **Evidence**: Every strike and finish generates an annotated snapshot with bounding box, caption, and plain reason (e.g., *"Sara kept moving during Red, about 2.8 times over the limit"*).

---

## 4. Game 2: Hot Potato

### Family Rules & Mechanics
- **3 Rounds Total**: Each round features a hidden timer (10 to 30 seconds) that emits accelerating audio beeps.
- **Snap Evaluation**: At $t = 0$, the camera captures a still frame and executes `judgeFrame(image, mode, zone, players)`.
- **Modes**:
  - `HIDE`: Anyone visible in the frame is OUT.
  - `ZONE`: A random danger rectangle is displayed before the countdown begins. Anyone whose torso center is inside the rectangle at photo time is OUT. Remaining visible in the frame outside the zone is SAFE.
- **Inputs**:
  - Live webcam with accelerating beeps.
  - Recorded video file mode (`video_file`) with scrubber slider and `"Judge this frame"` button.
- **Scoring**:
  - Everyone not caught in a round receives 1 point.
  - Most points wins; fewest total catches breaks ties.

### Judging Rules & Mathematical Thresholds
- **Visibility Criterion**: $\ge 4$ of shoulders (11, 12) and hips (23, 24) have landmark visibility $\ge 0.5$, OR a face was detected by Human.js.
- **Zone Check**: 2D point-in-rectangle test on player torso center:
  $$x \in [Z_x, Z_x + Z_w] \quad \text{and} \quad y \in [Z_y, Z_y + Z_h]$$
- **Face Matching**: Matches recognized face to nearest person pose (distance $< 0.35$).
- **Host Override**: Any detected person lacking confident face recognition ($\text{sim} < 0.55$) routes to the `"Who is this?"` host modal rather than guessing.
- **Evidence**: Saves judged frame as evidence with color-coded boxes (Green = SAFE, Red = OUT) and plain text reasons.

---

## 5. Frozen Core API Stubs (`/dev/stubs`)

All Person A dependencies are cleanly isolated in `/dev/stubs`:
1. `inputSource.js`: `startCamera(constraints)`, `loadVideoFile(source)`, `getVideoElement()`, `stop()`.
2. `evidence.js`: `captureStill(source)`, `drawEvidenceAnnotations(canvas, options)`, `saveEvidence(record)`, `getEvidenceList()`.
3. `audio.js`: `beep(options)`, `speak(text)`, `startAcceleratingBeeps(options)`, `stopAll()`.
4. `loop.js`: `createLoop({ update, render, fps })`.
5. `report.js`: `createReport(data)`, `validateReport(report)`, `downloadReportJson(report)`.

---

## 6. Kinship Design System Integration

Following `/Users/bhavya/Downloads/stitch_kinship_family_operating_hub`:
- **Palette**: Alabaster Oat (`#fff8f4`), Espresso Ink (`#1e1b18`), Terracotta Accent (`#e06d53`), Muted Sage (`#536251`), Soft Ochre (`#dda74f`).
- **Typography**: Newsreader (editorial headlines), Hanken Grotesk (body ergonomics), Plus Jakarta Sans (status pills).
- **Papercraft & Tactility**: Dual hairline perimeters, pillowed ambient shadows, polaroid photo evidence framing with wide bottom margins, and floating capsule navigation dock.
- **Zero Cost / Zero Money**: 100% open-source client-side code, zero cloud billing.

---

## 7. Verification & Test Commands

All 22 unit tests run with Node's native test runner (zero external dependencies):

```bash
# Run full unit test suite
npm test

# Run result object schema validator
npm run validate
```

All 22 tests pass:
- `tests/redLight.test.js`: 9 tests (thresholds, lanes, finish line, scoring, grace period, 3-frame persistence, lost detection immunity, lane boundaries, 3 strikes).
- `tests/hotPotato.test.js`: 7 tests (4-joint visibility, 2D zone check, nearest face matching, HIDE mode, ZONE mode, host picker, tournament tie-breaking).
- `tests/reportValidation.test.js`: 3 tests (valid report creation, score checking, plain reason requirement).
- `tests/visionLayer.test.js`: 3 tests (scale-invariant shoulder normalization, moving average smoothing, cosine similarity).

---

## 8. Assumptions & Limitations

1. **Camera Alignment**: Assumes host aligns webcam horizontally with floor tape markings.
2. **Lighting**: MediaPipe and Human.js rely on standard indoor domestic lighting.
3. **Headless Environment**: WebGL/WebGPU acceleration and browser media devices are mocked in Node test environments and fully active in browser dev runners (`/dev/red_light.html`, `/dev/hot_potato.html`).
4. **CDN Fallback**: If internet connectivity is interrupted, `poseTracker.js` supports pointing `wasmBaseUrl` to local `/vendor/tasks-vision/wasm`.
