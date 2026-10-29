# Aqaarib - AI Family Operating Hub & Motion Games

> **ADU Hackathon 2026**
> Tactile, anti-slop domestic operating hearth synthesizing shared household coordination and camera-driven motion games with zero cloud billing and 100% privacy-preserving edge inference.

---

## 🌟 Interactive Vision Games (Person B Deliverable)

Two interactive motion games running on a unified, high-performance browser vision layer:

1. **Red Light, Green Light** (`/dev/red_light.html`)
   - 2 to 4 vertical lanes with floor-tape alignment.
   - Paced traffic light transitions (2–5s random cadence).
   - Real-time 8-joint motion judging, 0.5s grace period, 3-frame persistence filter, and hip-height finish line.
   - Automatic session recording and video download via browser `MediaRecorder`.

2. **Hot Potato** (`/dev/hot_potato.html`)
   - Accelerating hidden timer (10–30s) with synthesized audio ticks.
   - Random mode per round: **HIDE** mode (anyone visible is out) or **ZONE** mode (random danger rectangle).
   - Vladimir Mandic Human face identification with interactive "Who is this?" host fallback picker.
   - Dual inputs: live camera or recorded video file with frame scrubber.

3. **Kinship Family Hub** (`index.html`)
   - Editorial warm papercraft aesthetic with Terracotta (`#e06d53`), Muted Sage (`#536251`), and Soft Ochre (`#dda74f`).
   - Newsreader serif headlines, Hanken Grotesk body, and Plus Jakarta Sans labels.

---

## 🔬 Shared Vision Architecture (`/vision`)

- **`/vision/poseTracker.js`**: MediaPipe Tasks Vision Pose Landmarker (`0.10.14`) in continuous video (~15 FPS downscaled offscreen canvas) and still image modes for up to 4 players.
- **`/vision/motion.js`**: Scale-invariant displacement evaluated across shoulders, hips, wrists, and ankles normalized by shoulder width ($\|L_{11} - L_{12}\|$), smoothed with a moving average, plus 6-second calibration.
- **`/vision/faceMatch.js`**: Human.js face enrollment and cosine similarity identification.

---

## 📦 Core Stubs (`/dev/stubs`)

All Person A core modules are isolated as frozen API stand-ins in `/dev/stubs`:
- `inputSource.js`
- `evidence.js`
- `audio.js`
- `loop.js`
- `report.js`

*Note: As per team protocol, zero files are placed in `/core` until the official merge.*

---

## 🧪 Testing & Validation

```bash
# Run all unit tests
npm test

# Run result object validator
npm run validate
```

For full details on thresholds, mathematical formulas, frozen contracts, and engineering assumptions, please see **[README_YOURPART.md](README_YOURPART.md)**.
